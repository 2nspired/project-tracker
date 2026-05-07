#!/usr/bin/env -S npx tsx
/**
 * Backfill: TokenUsageEvent.cardId for v6.0+ historical rows (#270).
 *
 * Walks rows where `cardId IS NULL` AND `recordedAt >= --since`, reconstructs
 * the In-Progress set at each row's `recordedAt` by replaying `Activity` move
 * events backwards from the card's current column, then calls the existing
 * `attribute()` function from `@/lib/services/attribution.ts` (#268). Only
 * applies attributions whose `confidence >= --confidence` (default `medium`)
 * — `medium-low` and `low` (`session-commit`, etc.) stay null per #267's
 * "wrong > empty" gate.
 *
 * Idempotent — the `WHERE cardId IS NULL` filter naturally re-runs as a
 * no-op once a row has been attributed.
 *
 * Scope notes:
 *   - Backfills `signal` + `signalConfidence` alongside `cardId` (the columns
 *     #269 added). Without those, the unattributed-gap counter would still
 *     classify the row as `preEngine`.
 *   - Tail signals 3 (`session-recent-touch`) and 4 (`session-commit`) are
 *     deferred to #272 — they require sessionId on Activity / GitLink. The
 *     snapshot here only populates `inProgressCardIds`, so attribution falls
 *     through to `unattributed` on multi/no-In-Progress sessions rather than
 *     guessing.
 *   - `Column.role` is read at the *current* schema state (we don't have a
 *     column-role activity log). For Pigeon Dev this is benign since column
 *     roles haven't churned post-v6.0.
 *
 * Usage:
 *   npx tsx scripts/backfill-attribution.ts --dry-run
 *   npx tsx scripts/backfill-attribution.ts --since=2026-04-30 --confidence=medium
 *   npx tsx scripts/backfill-attribution.ts            # writes with default flags
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
	type AttributionConfidence,
	type AttributionResult,
	attribute,
} from "@/lib/services/attribution";
import { PrismaClient } from "../prisma/generated/client";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const TRACKER_ROOT = resolve(SCRIPT_DIR, "..");
const DB_URL = `file:${resolve(TRACKER_ROOT, "data", "tracker.db")}`;

// ─── CLI parsing ────────────────────────────────────────────────────

export type CliFlags = {
	since: Date;
	dryRun: boolean;
	confidence: AttributionConfidence;
};

const DEFAULT_SINCE = "2025-09-01"; // safe v6.0 lower bound (see #270 plan)
const CONFIDENCE_RANK: Record<AttributionConfidence, number> = {
	"medium-low": 1,
	medium: 2,
	high: 3,
};

export function parseFlags(argv: readonly string[]): CliFlags {
	let sinceStr = DEFAULT_SINCE;
	let dryRun = false;
	let confidence: AttributionConfidence = "medium";

	for (const arg of argv) {
		if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg.startsWith("--since=")) {
			sinceStr = arg.slice("--since=".length);
		} else if (arg.startsWith("--confidence=")) {
			const value = arg.slice("--confidence=".length);
			if (value !== "medium" && value !== "high" && value !== "medium-low") {
				throw new Error(
					`--confidence must be one of: medium-low, medium, high (got "${value}")`
				);
			}
			confidence = value;
		} else if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else {
			throw new Error(`Unknown flag: ${arg}`);
		}
	}

	const since = new Date(`${sinceStr}T00:00:00Z`);
	if (Number.isNaN(since.getTime())) {
		throw new Error(`--since must be YYYY-MM-DD (got "${sinceStr}")`);
	}

	return { since, dryRun, confidence };
}

function printUsage() {
	console.log(`
Backfill TokenUsageEvent.cardId for v6.0+ historical rows (#270).

Usage:
  npx tsx scripts/backfill-attribution.ts [flags]

Flags:
  --since=YYYY-MM-DD     Lower bound on recordedAt. Default: ${DEFAULT_SINCE}
  --dry-run              Print proposed attributions, don't write.
  --confidence=LEVEL     Apply threshold: medium-low | medium | high.
                         Default: medium. Lower-confidence rows stay null.
  -h, --help             Show this message.
`);
}

/** Attribution meets the apply threshold. Pure — exported for tests. */
export function meetsThreshold(
	result: AttributionResult,
	threshold: AttributionConfidence
): boolean {
	if (!result.cardId || !result.confidence) return false;
	return CONFIDENCE_RANK[result.confidence] >= CONFIDENCE_RANK[threshold];
}

// ─── Activity replay (pure) ─────────────────────────────────────────

export type CardSnapshot = {
	cardId: string;
	currentColumnId: string;
};

export type MoveEvent = {
	cardId: string;
	createdAt: Date;
	/** "Moved from \"From\" to \"To\"" */
	details: string | null;
};

export type ColumnInfo = {
	id: string;
	name: string;
	role: string | null;
};

/**
 * Replay move activities backwards to find which column each card sat in at
 * `at`. For each card we walk its move history newest-first; the first move
 * with `createdAt > at` tells us where the card moved AWAY from at that
 * point — i.e. its column at `at` is the move's "from" column. If no such
 * move exists, the card was in its current column at `at` already.
 *
 * Pure — no Prisma. Caller fetches the activity history. Exported for the
 * test suite to pin replay correctness on a hand-built fixture.
 */
export function replayColumnAt(
	at: Date,
	cards: readonly CardSnapshot[],
	columnsByName: ReadonlyMap<string, ColumnInfo>,
	movesByCard: ReadonlyMap<string, readonly MoveEvent[]>
): Map<string, string | null> {
	const result = new Map<string, string | null>();

	for (const card of cards) {
		const moves = (movesByCard.get(card.cardId) ?? [])
			.slice()
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // newest first

		// Walk newest → oldest. The first move with createdAt > at is the
		// move OUT of the column the card occupied at `at`. Earlier moves
		// (createdAt <= at) are in the past and don't affect the snapshot.
		let columnIdAt: string | null = card.currentColumnId;
		for (const move of moves) {
			if (move.createdAt.getTime() <= at.getTime()) break;
			const fromName = parseFromColumn(move.details);
			if (fromName === null) {
				// Malformed details — fall back to current column. A future
				// move may still revise this if its details parse cleanly.
				continue;
			}
			const fromColumn = columnsByName.get(fromName);
			columnIdAt = fromColumn?.id ?? null;
		}
		result.set(card.cardId, columnIdAt);
	}

	return result;
}

const MOVE_DETAILS_RE = /^Moved from "(.+?)" to "(.+?)"$/;

export function parseFromColumn(details: string | null): string | null {
	if (!details) return null;
	const match = details.match(MOVE_DETAILS_RE);
	return match ? match[1] : null;
}

// ─── Reporter helpers ──────────────────────────────────────────────

type ProposedAttribution = {
	rowId: string;
	recordedAt: Date;
	projectId: string;
	sessionId: string;
	result: AttributionResult;
	apply: boolean;
};

type SignalCounts = Record<string, number>;

function emptySignalCounts(): SignalCounts {
	return {
		"single-in-progress": 0,
		"session-recent-touch": 0,
		"session-commit": 0,
		unattributed: 0,
	};
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
	const flags = parseFlags(process.argv.slice(2));

	const adapter = new PrismaBetterSqlite3({ url: DB_URL });
	const db = new PrismaClient({ adapter, log: ["error"] });

	console.log("");
	console.log("attribution backfill (#270)");
	console.log("───────────────────────────");
	console.log(`  Since:           ${flags.since.toISOString()}`);
	console.log(`  Apply threshold: confidence >= ${flags.confidence}`);
	console.log(`  Mode:            ${flags.dryRun ? "DRY-RUN (no writes)" : "WRITE"}`);
	console.log("");

	try {
		// Baseline gap stats so we can report the delta.
		const totalRows = await db.tokenUsageEvent.count();
		const nullBefore = await db.tokenUsageEvent.count({ where: { cardId: null } });
		const candidateRows = await db.tokenUsageEvent.findMany({
			where: { cardId: null, recordedAt: { gte: flags.since } },
			select: {
				id: true,
				projectId: true,
				sessionId: true,
				recordedAt: true,
			},
			orderBy: { recordedAt: "asc" },
		});

		console.log(`  Total rows:               ${totalRows}`);
		console.log(`  Rows NULL cardId:         ${nullBefore}`);
		console.log(`  Rows in --since window:   ${candidateRows.length}`);
		console.log("");

		if (candidateRows.length === 0) {
			console.log("  Nothing to backfill in the window. Exiting.");
			return;
		}

		// Group candidates by projectId — each project's snapshot is independent,
		// and a single project query for cards/columns/activities lets us replay
		// in-memory without N+1 round trips.
		const byProject = new Map<string, typeof candidateRows>();
		for (const row of candidateRows) {
			const list = byProject.get(row.projectId) ?? [];
			list.push(row);
			byProject.set(row.projectId, list);
		}

		const proposed: ProposedAttribution[] = [];
		const signalCounts: SignalCounts = emptySignalCounts();
		let appliedCount = 0;

		for (const [projectId, rows] of byProject) {
			// Per-project snapshots: cards (+ current column), columns by name,
			// move-activity history per card.
			const cards = await db.card.findMany({
				where: { projectId },
				select: { id: true, columnId: true },
			});
			const cardSnapshots: CardSnapshot[] = cards.map((c) => ({
				cardId: c.id,
				currentColumnId: c.columnId,
			}));

			const columns = await db.column.findMany({
				where: { board: { projectId } },
				select: { id: true, name: true, role: true },
			});
			const columnsByName = new Map<string, ColumnInfo>();
			for (const col of columns) columnsByName.set(col.name, col);
			const columnById = new Map<string, ColumnInfo>();
			for (const col of columns) columnById.set(col.id, col);

			// Move activities for any card in the project. A project with thousands
			// of activities is still cheap to load — Activity is a thin row.
			const cardIds = cards.map((c) => c.id);
			const moves = await db.activity.findMany({
				where: { cardId: { in: cardIds }, action: "moved" },
				select: { cardId: true, createdAt: true, details: true },
			});
			const movesByCard = new Map<string, MoveEvent[]>();
			for (const mv of moves) {
				const list = movesByCard.get(mv.cardId) ?? [];
				list.push({ cardId: mv.cardId, createdAt: mv.createdAt, details: mv.details });
				movesByCard.set(mv.cardId, list);
			}

			for (const row of rows) {
				const columnAt = replayColumnAt(row.recordedAt, cardSnapshots, columnsByName, movesByCard);

				const inProgressCardIds: string[] = [];
				for (const [cardId, columnId] of columnAt) {
					if (!columnId) continue;
					const col = columnById.get(columnId);
					if (col?.role === "active") inProgressCardIds.push(cardId);
				}

				const result = attribute(
					{},
					{
						inProgressCardIds,
						sessionTouchedCards: [],
						sessionCommits: [],
					}
				);

				const apply = meetsThreshold(result, flags.confidence);
				signalCounts[result.signal] = (signalCounts[result.signal] ?? 0) + 1;
				if (apply) appliedCount++;

				proposed.push({
					rowId: row.id,
					recordedAt: row.recordedAt,
					projectId: row.projectId,
					sessionId: row.sessionId,
					result,
					apply,
				});
			}
		}

		// ── Report ─────────────────────────────────────────────────────
		console.log("Proposed attributions (signal breakdown):");
		for (const sig of Object.keys(signalCounts).sort()) {
			console.log(`  ${sig.padEnd(22)} ${signalCounts[sig]}`);
		}
		console.log("");
		console.log(`  Apply candidates (>= ${flags.confidence}): ${appliedCount}`);
		console.log("");

		// Sample line per project to give the operator something to eyeball.
		const sampleByProject = new Map<string, ProposedAttribution>();
		for (const p of proposed) {
			if (p.apply && !sampleByProject.has(p.projectId)) sampleByProject.set(p.projectId, p);
		}
		if (sampleByProject.size > 0) {
			console.log("Sample (one per project that has any apply candidate):");
			for (const sample of sampleByProject.values()) {
				console.log(
					`  [${sample.recordedAt.toISOString()}] project=${sample.projectId.slice(0, 8)}` +
						` session=${sample.sessionId.slice(0, 8)}` +
						` -> card=${sample.result.cardId?.slice(0, 8) ?? "(null)"}` +
						` (${sample.result.signal}/${sample.result.confidence})`
				);
			}
			console.log("");
		}

		if (flags.dryRun) {
			const projectedNullAfter = nullBefore - appliedCount;
			const gapBefore = totalRows === 0 ? 0 : (nullBefore / totalRows) * 100;
			const gapAfter = totalRows === 0 ? 0 : (projectedNullAfter / totalRows) * 100;
			console.log("Gap delta (projected — DRY-RUN, no writes performed):");
			console.log(`  Before: ${nullBefore}/${totalRows} (${gapBefore.toFixed(1)}%)`);
			console.log(`  After:  ${projectedNullAfter}/${totalRows} (${gapAfter.toFixed(1)}%)`);
			console.log("");
			console.log("Done (dry-run). Re-run without --dry-run to apply.");
			return;
		}

		// ── Apply ──────────────────────────────────────────────────────
		let written = 0;
		for (const p of proposed) {
			if (!p.apply || !p.result.cardId || !p.result.confidence) continue;
			await db.tokenUsageEvent.update({
				where: { id: p.rowId },
				data: {
					cardId: p.result.cardId,
					signal: p.result.signal,
					signalConfidence: p.result.confidence,
				},
			});
			written++;
		}

		const nullAfter = await db.tokenUsageEvent.count({ where: { cardId: null } });
		const gapBefore = totalRows === 0 ? 0 : (nullBefore / totalRows) * 100;
		const gapAfter = totalRows === 0 ? 0 : (nullAfter / totalRows) * 100;

		console.log("Gap delta:");
		console.log(`  Before: ${nullBefore}/${totalRows} (${gapBefore.toFixed(1)}%)`);
		console.log(`  After:  ${nullAfter}/${totalRows} (${gapAfter.toFixed(1)}%)`);
		console.log(`  Wrote:  ${written} row(s)`);
		console.log("");
		console.log("Done.");
	} finally {
		await db.$disconnect();
	}
}

// Only run main when executed directly via tsx — guard so the module is
// import-safe in tests.
const isDirectRun = (() => {
	if (!process.argv[1]) return false;
	const invoked = resolve(process.argv[1]);
	const self = fileURLToPath(import.meta.url);
	return invoked === self;
})();

if (isDirectRun) {
	main().catch((error) => {
		console.error("Backfill failed:", error);
		process.exit(1);
	});
}
