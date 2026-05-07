// @vitest-environment node
/**
 * Tests for the historical attribution backfill (#270).
 *
 * Three behaviors pinned here:
 *   1. Activity-replay correctness — given a card's current column and a
 *      sequence of "moved" activities, `replayColumnAt` reconstructs the
 *      column the card occupied at any past timestamp.
 *   2. Confidence filtering — `meetsThreshold` honors the documented
 *      ranking (high > medium > medium-low) and refuses to apply when
 *      `cardId` or `confidence` is missing.
 *   3. Idempotency — re-running the replay against the same fixture is
 *      stable; the column-at-time output doesn't drift between calls
 *      (the script's outer idempotency comes from `WHERE cardId IS NULL`,
 *      which is a SQL contract — pinning the pure-function determinism
 *      here is the meaningful part).
 *
 * No DB. The script's `main()` is end-to-end glue; the load-bearing logic
 * is the two pure functions below.
 */

import { describe, expect, it } from "vitest";
import {
	type CardSnapshot,
	type ColumnInfo,
	type MoveEvent,
	meetsThreshold,
	parseFlags,
	parseFromColumn,
	replayColumnAt,
} from "../backfill-attribution";

// ─── Fixture helpers ───────────────────────────────────────────────

const T = (iso: string) => new Date(iso);

const COLS: ColumnInfo[] = [
	{ id: "col-backlog", name: "Backlog", role: "backlog" },
	{ id: "col-active", name: "In Progress", role: "active" },
	{ id: "col-done", name: "Done", role: "done" },
];

const COLS_BY_NAME = new Map(COLS.map((c) => [c.name, c]));

function move(cardId: string, at: string, from: string, to: string): MoveEvent {
	return { cardId, createdAt: T(at), details: `Moved from "${from}" to "${to}"` };
}

// ─── Activity-replay correctness ───────────────────────────────────

describe("replayColumnAt", () => {
	it("returns the current column when the card never moved", () => {
		const cards: CardSnapshot[] = [{ cardId: "card-a", currentColumnId: "col-active" }];
		const movesByCard = new Map<string, MoveEvent[]>();

		const result = replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, movesByCard);

		expect(result.get("card-a")).toBe("col-active");
	});

	it("walks one move backwards: card now in Done, asked about pre-move time → returns In Progress", () => {
		const cards: CardSnapshot[] = [{ cardId: "card-a", currentColumnId: "col-done" }];
		const movesByCard = new Map<string, MoveEvent[]>([
			["card-a", [move("card-a", "2026-04-20T12:00:00Z", "In Progress", "Done")]],
		]);

		// Right before the move: was in In Progress.
		const before = replayColumnAt(T("2026-04-20T11:00:00Z"), cards, COLS_BY_NAME, movesByCard);
		expect(before.get("card-a")).toBe("col-active");

		// Right after the move: was already in Done.
		const after = replayColumnAt(T("2026-04-20T13:00:00Z"), cards, COLS_BY_NAME, movesByCard);
		expect(after.get("card-a")).toBe("col-done");
	});

	it("walks multiple moves backwards in correct chronological order", () => {
		// Card history: Backlog → In Progress (2026-04-10) → Done (2026-04-20)
		// Current state: Done.
		const cards: CardSnapshot[] = [{ cardId: "card-a", currentColumnId: "col-done" }];
		const movesByCard = new Map<string, MoveEvent[]>([
			[
				"card-a",
				[
					move("card-a", "2026-04-10T00:00:00Z", "Backlog", "In Progress"),
					move("card-a", "2026-04-20T00:00:00Z", "In Progress", "Done"),
				],
			],
		]);

		expect(
			replayColumnAt(T("2026-04-05T00:00:00Z"), cards, COLS_BY_NAME, movesByCard).get("card-a")
		).toBe("col-backlog");
		expect(
			replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, movesByCard).get("card-a")
		).toBe("col-active");
		expect(
			replayColumnAt(T("2026-04-25T00:00:00Z"), cards, COLS_BY_NAME, movesByCard).get("card-a")
		).toBe("col-done");
	});

	it("is order-insensitive on input — moves can be passed unsorted", () => {
		const cards: CardSnapshot[] = [{ cardId: "card-a", currentColumnId: "col-done" }];
		const moves = [
			move("card-a", "2026-04-20T00:00:00Z", "In Progress", "Done"),
			move("card-a", "2026-04-10T00:00:00Z", "Backlog", "In Progress"),
		];
		const sorted = new Map<string, MoveEvent[]>([["card-a", moves]]);
		const reversed = new Map<string, MoveEvent[]>([["card-a", [...moves].reverse()]]);

		expect(replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, sorted).get("card-a")).toBe(
			replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, reversed).get("card-a")
		);
	});

	it("identifies the In-Progress set at a past time across multiple cards", () => {
		// At 2026-04-15:
		//   card-a: just moved Backlog → In Progress on 04-10
		//   card-b: still in Backlog (move to In Progress happens later, on 04-20)
		//   card-c: in Done already (moved on 04-12)
		// → Expect only card-a to be in role=active at 2026-04-15.
		const cards: CardSnapshot[] = [
			{ cardId: "card-a", currentColumnId: "col-active" },
			{ cardId: "card-b", currentColumnId: "col-active" },
			{ cardId: "card-c", currentColumnId: "col-done" },
		];
		const movesByCard = new Map<string, MoveEvent[]>([
			["card-a", [move("card-a", "2026-04-10T00:00:00Z", "Backlog", "In Progress")]],
			["card-b", [move("card-b", "2026-04-20T00:00:00Z", "Backlog", "In Progress")]],
			["card-c", [move("card-c", "2026-04-12T00:00:00Z", "In Progress", "Done")]],
		]);

		const result = replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, movesByCard);

		const inProgressIds = [...result.entries()]
			.filter(([_, colId]) => colId === "col-active")
			.map(([cardId]) => cardId)
			.sort();

		expect(inProgressIds).toEqual(["card-a"]);
	});

	it("idempotent — re-running against the same fixture yields the same map", () => {
		// Stability gate: a second invocation must not mutate state. The
		// outer `WHERE cardId IS NULL` filter takes care of SQL idempotency;
		// this test pins that the pure function doesn't pollute its inputs.
		const cards: CardSnapshot[] = [{ cardId: "card-a", currentColumnId: "col-done" }];
		const movesByCard = new Map<string, MoveEvent[]>([
			["card-a", [move("card-a", "2026-04-20T00:00:00Z", "In Progress", "Done")]],
		]);

		const first = replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, movesByCard);
		const second = replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, movesByCard);

		expect([...first.entries()]).toEqual([...second.entries()]);
		// And the source `movesByCard` array wasn't mutated in place.
		expect(movesByCard.get("card-a")).toHaveLength(1);
	});

	it("falls back to current column when a move's details are malformed", () => {
		// Belt-and-braces: if a row in `Activity` ever has a non-canonical
		// details string we don't crash — we ignore that entry and the card
		// stays in its current column for the snapshot.
		const cards: CardSnapshot[] = [{ cardId: "card-a", currentColumnId: "col-active" }];
		const movesByCard = new Map<string, MoveEvent[]>([
			["card-a", [{ cardId: "card-a", createdAt: T("2026-04-20T00:00:00Z"), details: "garbage" }]],
		]);

		const result = replayColumnAt(T("2026-04-15T00:00:00Z"), cards, COLS_BY_NAME, movesByCard);

		expect(result.get("card-a")).toBe("col-active");
	});
});

describe("parseFromColumn", () => {
	it("extracts the From column from a canonical details string", () => {
		expect(parseFromColumn('Moved from "Backlog" to "In Progress"')).toBe("Backlog");
	});

	it("returns null on a malformed string", () => {
		expect(parseFromColumn("garbage")).toBeNull();
	});

	it("returns null on a null input", () => {
		expect(parseFromColumn(null)).toBeNull();
	});
});

// ─── Confidence filtering ──────────────────────────────────────────

describe("meetsThreshold", () => {
	it("applies high attributions at a medium threshold", () => {
		expect(
			meetsThreshold(
				{ cardId: "card-a", confidence: "high", signal: "single-in-progress" },
				"medium"
			)
		).toBe(true);
	});

	it("applies medium attributions at a medium threshold", () => {
		expect(
			meetsThreshold(
				{ cardId: "card-a", confidence: "medium", signal: "session-recent-touch" },
				"medium"
			)
		).toBe(true);
	});

	it("rejects medium-low attributions at a medium threshold", () => {
		expect(
			meetsThreshold(
				{ cardId: "card-a", confidence: "medium-low", signal: "session-commit" },
				"medium"
			)
		).toBe(false);
	});

	it("rejects medium attributions at a high threshold", () => {
		expect(
			meetsThreshold(
				{ cardId: "card-a", confidence: "medium", signal: "session-recent-touch" },
				"high"
			)
		).toBe(false);
	});

	it("rejects unattributed (cardId=null) regardless of threshold", () => {
		expect(
			meetsThreshold({ cardId: null, confidence: null, signal: "unattributed" }, "medium-low")
		).toBe(false);
	});
});

// ─── CLI flag parsing ──────────────────────────────────────────────

describe("parseFlags", () => {
	it("defaults to since=2025-09-01, dryRun=false, confidence=medium", () => {
		const flags = parseFlags([]);
		expect(flags.since.toISOString()).toBe("2025-09-01T00:00:00.000Z");
		expect(flags.dryRun).toBe(false);
		expect(flags.confidence).toBe("medium");
	});

	it("--dry-run flips dryRun to true", () => {
		expect(parseFlags(["--dry-run"]).dryRun).toBe(true);
	});

	it("--since=YYYY-MM-DD overrides the default lower bound", () => {
		const flags = parseFlags(["--since=2026-04-30"]);
		expect(flags.since.toISOString()).toBe("2026-04-30T00:00:00.000Z");
	});

	it("--confidence=high overrides the default threshold", () => {
		expect(parseFlags(["--confidence=high"]).confidence).toBe("high");
	});

	it("rejects an invalid --confidence value", () => {
		expect(() => parseFlags(["--confidence=ultra"])).toThrow(/--confidence/);
	});

	it("rejects an invalid --since value", () => {
		expect(() => parseFlags(["--since=not-a-date"])).toThrow(/--since/);
	});

	it("rejects an unknown flag", () => {
		expect(() => parseFlags(["--unknown"])).toThrow(/Unknown flag/);
	});
});
