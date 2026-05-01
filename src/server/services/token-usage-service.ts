import { createReadStream } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Prisma, PrismaClient } from "prisma/generated/client";
import { computeCost, type ModelPricing, resolvePricing } from "@/lib/token-pricing-defaults";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

// ─── Types ─────────────────────────────────────────────────────────

export type TokenUsageWarningCode =
	| "NO_USAGE_FOUND"
	| "PROJECT_NOT_FOUND"
	| "PARSE_ERROR"
	| "TRANSCRIPT_NOT_FOUND";

export type TokenUsageWarning = { code: TokenUsageWarningCode; detail?: string };

export type RecordResult = {
	created: number;
	subAgentFiles: number;
	warnings: TokenUsageWarning[];
};

export type ManualRecordInput = {
	projectId: string;
	sessionId: string;
	cardId?: string | null;
	agentName?: string | null;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheCreation1hTokens?: number;
	cacheCreation5mTokens?: number;
};

export type TranscriptRecordInput = {
	projectId: string;
	sessionId: string;
	transcriptPath: string;
	cardId?: string | null;
	agentName?: string | null;
};

export type ModelTotals = {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreation1hTokens: number;
	cacheCreation5mTokens: number;
	costUsd: number;
};

export type UsageSummary = {
	totalCostUsd: number;
	sessionCount: number;
	eventCount: number;
	trackingSince: Date | null;
	byModel: ModelTotals[];
};

// ─── Internal: pricing loader (web side) ───────────────────────────

async function loadPricing(prisma: PrismaClient): Promise<Record<string, ModelPricing>> {
	const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
	return resolvePricing(settings?.tokenPricing ?? null);
}

// ─── Internal: row insert shape (used by recordFromTranscript) ─────

type InsertRow = {
	sessionId: string;
	projectId: string;
	cardId: string | null;
	agentName: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreation1hTokens: number;
	cacheCreation5mTokens: number;
};

// ─── Internal: transcript JSONL streaming aggregator ───────────────

type ModelAccumulator = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreation1hTokens: number;
	cacheCreation5mTokens: number;
};

function emptyAcc(): ModelAccumulator {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreation1hTokens: 0,
		cacheCreation5mTokens: 0,
	};
}

// Streams a JSONL transcript, summing `message.usage` per `message.model`.
// readline-based for backpressure-safe iteration on multi-megabyte files.
// Malformed lines are skipped — never throw — and reflected in the returned
// `parseErrors` count so callers can surface a soft warning.
async function aggregateTranscript(
	filePath: string,
	totals: Map<string, ModelAccumulator>
): Promise<{ messagesSeen: number; parseErrors: number }> {
	let messagesSeen = 0;
	let parseErrors = 0;

	const stream = createReadStream(filePath, { encoding: "utf8" });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });

	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			parseErrors += 1;
			continue;
		}
		const entry = parsed as {
			message?: {
				role?: string;
				model?: string;
				usage?: {
					input_tokens?: number;
					output_tokens?: number;
					cache_read_input_tokens?: number;
					cache_creation_input_tokens?: number;
					cache_creation?: {
						ephemeral_1h_input_tokens?: number;
						ephemeral_5m_input_tokens?: number;
					};
				};
			};
		};
		const msg = entry.message;
		if (!msg || msg.role !== "assistant" || !msg.usage || !msg.model) continue;

		const usage = msg.usage;
		const acc = totals.get(msg.model) ?? emptyAcc();
		acc.inputTokens += numericOrZero(usage.input_tokens);
		acc.outputTokens += numericOrZero(usage.output_tokens);
		acc.cacheReadTokens += numericOrZero(usage.cache_read_input_tokens);

		// Prefer the explicit ephemeral_{1h,5m} split when present; fall back to
		// the lumped `cache_creation_input_tokens` field as the 5m bucket
		// (Anthropic's default cache TTL) when only the legacy field exists.
		const eph1h = numericOrZero(usage.cache_creation?.ephemeral_1h_input_tokens);
		const eph5m = numericOrZero(usage.cache_creation?.ephemeral_5m_input_tokens);
		if (eph1h > 0 || eph5m > 0) {
			acc.cacheCreation1hTokens += eph1h;
			acc.cacheCreation5mTokens += eph5m;
		} else {
			acc.cacheCreation5mTokens += numericOrZero(usage.cache_creation_input_tokens);
		}

		totals.set(msg.model, acc);
		messagesSeen += 1;
	}

	return { messagesSeen, parseErrors };
}

function numericOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

// Sub-agent transcripts live alongside the parent transcript in
// `<dirname>/<sessionId>/subagents/agent-*.jsonl`. Confirmed by inspecting a
// real Claude Code session — sub-agent token usage is NOT rolled into the
// parent's `message.usage`, so missing this path under-counts by 30–50% on
// sessions that delegate to sub-agents.
async function listSubAgentTranscripts(parentPath: string): Promise<string[]> {
	const dir = path.dirname(parentPath);
	const sessionId = path.basename(parentPath, ".jsonl");
	const subAgentDir = path.join(dir, sessionId, "subagents");
	try {
		const entries = await readdir(subAgentDir);
		return entries.filter((f) => f.endsWith(".jsonl")).map((f) => path.join(subAgentDir, f));
	} catch {
		return [];
	}
}

// ─── Internal: board-scope where helper (#200 Phase 1a) ───────────
//
// Centralizes the "what does it mean to scope a token-usage query to a
// board?" rule so the join can't drift between callers. Two modes:
//
//   - `boardId === undefined` → returns `{ projectId }`. Identical to the
//     pre-#200 callsite behavior; existing project-scope queries route
//     through here without changing their results.
//
//   - `boardId` set → resolves the cards under any column on the board,
//     then expands to "any session that touched a card on this board"
//     using the same session-expansion rule that backs `getCardSummary`
//     (see its doc comment): a session that touched multiple cards
//     contributes its full cost to *each* card it touched, no fictional
//     split. Bubbled up to the board level, this means a session that
//     touched cards on both boardA and boardB contributes its full cost
//     to BOTH boards' totals. That's intentional — it's the "Cost
//     inequality" acceptance from #200: `boardA.total + boardB.total >
//     project.total` is expected, not a bug.
//
// `projectId` is pinned in the returned `where` even when `boardId` is
// set so a sessionId that happens to collide across projects (deliberate
// or otherwise) can't leak the other project's cost into this board's
// totals. The cross-project isolation test pins this — it's the bug
// class this helper exists to prevent.
//
// A `boardId` that resolves to no cards (bad id, brand-new empty board)
// produces a where that matches no rows. Callers see clean zeros. The
// 404-on-bad-boardId concern lives at the router/UI layer — this helper
// stays pure.
async function resolveBoardScopeWhere(
	projectId: string,
	boardId?: string
): Promise<Prisma.TokenUsageEventWhereInput> {
	if (!boardId) return { projectId };

	const cards = await db.card.findMany({
		where: { column: { boardId } },
		select: { id: true },
	});
	const cardIds = cards.map((c) => c.id);

	if (cardIds.length === 0) {
		// Empty board (or bad boardId): build a where that can never match.
		// Mirrors the `id: { in: [] }` sentinel `getMilestoneSummary` uses for
		// the same reason — a missing `OR` would otherwise widen back to the
		// full project, which would be a silent leak.
		return { projectId, id: { in: [] } };
	}

	const directRows = await db.tokenUsageEvent.findMany({
		where: { projectId, cardId: { in: cardIds } },
		select: { sessionId: true },
	});
	const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));

	return {
		projectId,
		OR: [
			{ cardId: { in: cardIds } },
			...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
		],
	};
}

// ─── Public API ────────────────────────────────────────────────────

// Manual record path (Codex/OpenAI agents that don't emit a JSONL transcript).
// Idempotent on `(sessionId, model)` — re-calling with the same pair replaces
// the existing row's token counts (last-write-wins), matching `recordFromTranscript`'s
// "same input → same row count" contract. A retry of a failed call therefore
// can't double-bill the user, and test fixtures that seed the same row twice
// stay deterministic. Replace (not sum) was chosen for parity with the sibling;
// callers that need accumulation should pre-sum before calling.
//
// Implementation note: the `(sessionId, model)` pair has no DB-level unique
// constraint, so we use a `findFirst` + conditional `update`/`create` rather
// than a Prisma upsert. Adding the constraint would interact with
// `recordFromTranscript`'s delete-and-replace semantics on `sessionId`; a
// one-function read-then-write keeps the fix scoped and migration-free.
async function recordManual(input: ManualRecordInput): Promise<ServiceResult<RecordResult>> {
	try {
		const data = {
			sessionId: input.sessionId,
			projectId: input.projectId,
			cardId: input.cardId ?? null,
			agentName: input.agentName ?? "unknown",
			model: input.model,
			inputTokens: Math.max(0, Math.floor(input.inputTokens)),
			outputTokens: Math.max(0, Math.floor(input.outputTokens)),
			cacheReadTokens: Math.max(0, Math.floor(input.cacheReadTokens ?? 0)),
			cacheCreation1hTokens: Math.max(0, Math.floor(input.cacheCreation1hTokens ?? 0)),
			cacheCreation5mTokens: Math.max(0, Math.floor(input.cacheCreation5mTokens ?? 0)),
		};
		const existing = await db.tokenUsageEvent.findFirst({
			where: { sessionId: data.sessionId, model: data.model },
			select: { id: true },
		});
		if (existing) {
			await db.tokenUsageEvent.update({
				where: { id: existing.id },
				data: {
					projectId: data.projectId,
					cardId: data.cardId,
					agentName: data.agentName,
					inputTokens: data.inputTokens,
					outputTokens: data.outputTokens,
					cacheReadTokens: data.cacheReadTokens,
					cacheCreation1hTokens: data.cacheCreation1hTokens,
					cacheCreation5mTokens: data.cacheCreation5mTokens,
				},
			});
		} else {
			await db.tokenUsageEvent.create({ data });
		}
		return { success: true, data: { created: 1, subAgentFiles: 0, warnings: [] } };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] recordManual error:", error);
		return {
			success: false,
			error: { code: "INSERT_FAILED", message: "Failed to record token usage." },
		};
	}
}

// Stop-hook idempotent path: deletes any existing rows with this sessionId
// before inserting. Re-running the hook against the same transcript produces
// the same row count, not duplicates. Returns soft warnings for missing
// transcripts / no-usage-found rather than throwing — the Stop hook should
// never block a session from ending.
//
// Re-run safety vs. `attributeSession`: the snapshot-and-restore inside the
// transaction below preserves any `cardId` that `attributeSession` wrote
// between the original Stop-hook fire and a later re-run, so card
// attribution survives a Stop-hook replay even when the transcript itself
// has no card context.
async function recordFromTranscript(
	input: TranscriptRecordInput
): Promise<ServiceResult<RecordResult>> {
	const warnings: TokenUsageWarning[] = [];
	const totals = new Map<string, ModelAccumulator>();

	if (!(await fileExists(input.transcriptPath))) {
		return {
			success: true,
			data: {
				created: 0,
				subAgentFiles: 0,
				warnings: [{ code: "TRANSCRIPT_NOT_FOUND", detail: input.transcriptPath }],
			},
		};
	}

	let totalParseErrors = 0;
	try {
		const parentResult = await aggregateTranscript(input.transcriptPath, totals);
		totalParseErrors += parentResult.parseErrors;
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] aggregateTranscript parent error:", error);
		warnings.push({
			code: "PARSE_ERROR",
			detail: error instanceof Error ? error.message : String(error),
		});
	}

	const subAgentFiles = await listSubAgentTranscripts(input.transcriptPath);
	for (const subPath of subAgentFiles) {
		try {
			const subResult = await aggregateTranscript(subPath, totals);
			totalParseErrors += subResult.parseErrors;
		} catch (error) {
			console.error("[TOKEN_USAGE_SERVICE] aggregateTranscript subagent error:", error);
			warnings.push({
				code: "PARSE_ERROR",
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (totalParseErrors > 0) {
		warnings.push({ code: "PARSE_ERROR", detail: `${totalParseErrors} malformed line(s) skipped` });
	}

	if (totals.size === 0) {
		return {
			success: true,
			data: {
				created: 0,
				subAgentFiles: subAgentFiles.length,
				warnings: [...warnings, { code: "NO_USAGE_FOUND" }],
			},
		};
	}

	const rows: InsertRow[] = [];
	for (const [model, acc] of totals.entries()) {
		rows.push({
			sessionId: input.sessionId,
			projectId: input.projectId,
			cardId: input.cardId ?? null,
			agentName: input.agentName ?? "claude-code",
			model,
			...acc,
		});
	}

	try {
		// Idempotent: same sessionId always replaces. If the user has multiple
		// agents writing under the same sessionId (unusual), they'd overwrite
		// each other — that's an acceptable trade for hook re-run safety.
		//
		// Cardid preservation across re-runs: `attributeSession` (called from
		// briefMe / saveHandoff) writes a `cardId` onto these rows between the
		// original Stop-hook fire and any re-run. The transcript itself only
		// carries the cardId the hook had at write time (often null), so a
		// naive delete-and-replace would silently wipe the attribution. We
		// snapshot the existing non-null cardId for this session before the
		// delete; if the new row set didn't carry one through, we restore it
		// via a single `updateMany` after re-insert. One extra SELECT and a
		// conditional UPDATE — cheaper than reworking the write strategy.
		const existing = await db.tokenUsageEvent.findMany({
			where: { sessionId: input.sessionId, cardId: { not: null } },
			select: { cardId: true },
		});
		const preservedCardId = existing.find((row) => row.cardId !== null)?.cardId ?? null;

		await db.$transaction([
			db.tokenUsageEvent.deleteMany({ where: { sessionId: input.sessionId } }),
			...rows.map((row) =>
				db.tokenUsageEvent.create({
					data: {
						sessionId: row.sessionId,
						projectId: row.projectId,
						cardId: row.cardId,
						agentName: row.agentName,
						model: row.model,
						inputTokens: row.inputTokens,
						outputTokens: row.outputTokens,
						cacheReadTokens: row.cacheReadTokens,
						cacheCreation1hTokens: row.cacheCreation1hTokens,
						cacheCreation5mTokens: row.cacheCreation5mTokens,
					},
				})
			),
		]);

		// Restore the prior attribution if the re-run didn't supply one. We
		// only write when the new rows have null cardId — if the caller
		// passed a fresh cardId we respect that as the new source of truth.
		if (preservedCardId && !input.cardId) {
			await db.tokenUsageEvent.updateMany({
				where: { sessionId: input.sessionId, cardId: null },
				data: { cardId: preservedCardId },
			});
		}
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] recordFromTranscript insert error:", error);
		return {
			success: false,
			error: { code: "INSERT_FAILED", message: "Failed to write token usage rows." },
		};
	}

	return {
		success: true,
		data: { created: rows.length, subAgentFiles: subAgentFiles.length, warnings },
	};
}

// Aggregates all events for a project into a single summary. `byModel`
// preserves per-model breakdown; the chip in the UI displays only
// `totalCostUsd` but the settings page can expose the full table.
//
// Memory ceiling: this is an unbounded `findMany` over `TokenUsageEvent` for
// the project's full lifetime — every row loads into Node memory before
// `aggregateEvents` reduces it. Acceptable at current scale (a single
// active project tops out in the low thousands of rows after months of
// use). If we ever grow into the 100k+ range per project, switch to a SQL
// `groupBy` on `model` so the aggregation runs in SQLite and only the
// per-model totals cross the boundary.
//
// Optional `boardId`: when set, scopes the summary to the cards on that
// board via `resolveBoardScopeWhere` (session-expansion rule applies, so
// `boardA + boardB > project` is *expected* — see helper's doc). When
// omitted, behavior is identical to pre-#200 (whole project).
async function getProjectSummary(
	projectId: string,
	boardId?: string
): Promise<ServiceResult<UsageSummary>> {
	try {
		const where = await resolveBoardScopeWhere(projectId, boardId);
		const [events, pricing] = await Promise.all([
			db.tokenUsageEvent.findMany({
				where,
				select: {
					sessionId: true,
					model: true,
					inputTokens: true,
					outputTokens: true,
					cacheReadTokens: true,
					cacheCreation1hTokens: true,
					cacheCreation5mTokens: true,
					recordedAt: true,
				},
			}),
			loadPricing(db),
		]);

		return { success: true, data: aggregateEvents(events, pricing) };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getProjectSummary error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load project summary." },
		};
	}
}

async function getSessionSummary(
	sessionId: string,
	projectId: string
): Promise<ServiceResult<UsageSummary>> {
	try {
		const [events, pricing] = await Promise.all([
			db.tokenUsageEvent.findMany({
				where: { sessionId, projectId },
				select: {
					sessionId: true,
					model: true,
					inputTokens: true,
					outputTokens: true,
					cacheReadTokens: true,
					cacheCreation1hTokens: true,
					cacheCreation5mTokens: true,
					recordedAt: true,
				},
			}),
			loadPricing(db),
		]);
		return { success: true, data: aggregateEvents(events, pricing) };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getSessionSummary error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load session summary." },
		};
	}
}

// Aggregates events scoped to "any session that touched this card". A
// session that touched multiple cards contributes to *each* card's total —
// no fictional split. Returns the same UsageSummary shape so the chip
// renders identically across surfaces.
async function getCardSummary(cardId: string): Promise<ServiceResult<UsageSummary>> {
	try {
		const card = await db.card.findUnique({ where: { id: cardId }, select: { projectId: true } });
		if (!card) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}
		// Direct attribution rows (cardId set on event) — included verbatim.
		// Plus session-scoped rows from any session that touched this card via
		// any direct attribution. Keeps the math simple and avoids the
		// "split a 4-card session" trap.
		const directRows = await db.tokenUsageEvent.findMany({
			where: { cardId },
			select: { sessionId: true },
		});
		const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));
		const [events, pricing] = await Promise.all([
			db.tokenUsageEvent.findMany({
				where: {
					projectId: card.projectId,
					OR: [{ cardId }, { sessionId: { in: sessionIds } }],
				},
				select: {
					sessionId: true,
					model: true,
					inputTokens: true,
					outputTokens: true,
					cacheReadTokens: true,
					cacheCreation1hTokens: true,
					cacheCreation5mTokens: true,
					recordedAt: true,
				},
			}),
			loadPricing(db),
		]);
		return { success: true, data: aggregateEvents(events, pricing) };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getCardSummary error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load card summary." },
		};
	}
}

async function getMilestoneSummary(milestoneId: string): Promise<ServiceResult<UsageSummary>> {
	try {
		const milestone = await db.milestone.findUnique({
			where: { id: milestoneId },
			select: { projectId: true },
		});
		if (!milestone) {
			return { success: false, error: { code: "NOT_FOUND", message: "Milestone not found." } };
		}
		const cards = await db.card.findMany({
			where: { milestoneId },
			select: { id: true },
		});
		const cardIds = cards.map((c) => c.id);
		// Session attribution: any session that touched any card in this
		// milestone. Same full-attribution rule as `getCardSummary`.
		const directRows =
			cardIds.length > 0
				? await db.tokenUsageEvent.findMany({
						where: { cardId: { in: cardIds } },
						select: { sessionId: true },
					})
				: [];
		const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));

		const [events, pricing] = await Promise.all([
			db.tokenUsageEvent.findMany({
				where:
					sessionIds.length > 0
						? {
								projectId: milestone.projectId,
								OR: [
									...(cardIds.length > 0 ? [{ cardId: { in: cardIds } }] : []),
									{ sessionId: { in: sessionIds } },
								],
							}
						: { id: { in: [] } }, // no rows
				select: {
					sessionId: true,
					model: true,
					inputTokens: true,
					outputTokens: true,
					cacheReadTokens: true,
					cacheCreation1hTokens: true,
					cacheCreation5mTokens: true,
					recordedAt: true,
				},
			}),
			loadPricing(db),
		]);
		return { success: true, data: aggregateEvents(events, pricing) };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getMilestoneSummary error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load milestone summary." },
		};
	}
}

export type DailyCostSeries = {
	/**
	 * Daily cost USD over the last 7 calendar days, bucketed by **UTC** day.
	 * `index 0` = the UTC day starting 6 days before today's UTC day;
	 * `index 6` = today's UTC day (00:00 UTC → 24:00 UTC).
	 *
	 * Buckets are anchored to UTC midnight (not a rolling 168-hour window) so
	 * the rightmost bar always represents a stable calendar day instead of
	 * shifting with the time of page load. UTC is chosen because there is no
	 * project-wide timezone configured; using UTC keeps bucket math identical
	 * across hosts and across server/client renders.
	 */
	dailyCostUsd: number[];
	/** Sum of `dailyCostUsd` — the headline number for the Pulse strip. */
	weekTotalCostUsd: number;
};

// 7-day calendar cost series (UTC), indexed identically to
// `activityService.getFlowMetrics`'s `throughput`, so the Pulse UI can render
// both sparklines on aligned x-axes.
//
// Bucketing rule: each event lands in `floor((event.recordedAt - windowStart) / 1d)`,
// where `windowStart` is **UTC midnight at the start of the day 6 days before
// today's UTC day**. That means index 6 = today (UTC) regardless of the
// time-of-day at which the request fires; the rightmost sparkline bar is a
// full calendar day, not a "last 24h" smear.
//
// Optional `boardId`: routes through `resolveBoardScopeWhere` and merges
// the resulting where with the `recordedAt` window filter. Same
// session-expansion semantics as `getProjectSummary`'s board scope.
async function getDailyCostSeries(
	projectId: string,
	boardId?: string
): Promise<ServiceResult<DailyCostSeries>> {
	try {
		// Anchor the 7-day window at UTC midnight so buckets line up with
		// calendar days. `Date.UTC` returns ms since epoch for midnight UTC of
		// the given y/m/d, so this is independent of the host's local TZ.
		const now = new Date();
		const todayUtcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
		const windowStart = new Date(todayUtcMidnightMs - 6 * 24 * 60 * 60 * 1000);

		const scopeWhere = await resolveBoardScopeWhere(projectId, boardId);
		const [events, pricing] = await Promise.all([
			db.tokenUsageEvent.findMany({
				where: { ...scopeWhere, recordedAt: { gte: windowStart } },
				select: {
					sessionId: true,
					model: true,
					inputTokens: true,
					outputTokens: true,
					cacheReadTokens: true,
					cacheCreation1hTokens: true,
					cacheCreation5mTokens: true,
					recordedAt: true,
				},
			}),
			loadPricing(db),
		]);

		const dailyCostUsd = new Array<number>(7).fill(0);
		let weekTotalCostUsd = 0;
		for (const event of events) {
			const dayIndex = Math.floor(
				(event.recordedAt.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)
			);
			if (dayIndex < 0 || dayIndex >= 7) continue;
			const cost = computeCost(event, pricing);
			dailyCostUsd[dayIndex] += cost;
			weekTotalCostUsd += cost;
		}

		return { success: true, data: { dailyCostUsd, weekTotalCostUsd } };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getDailyCostSeries error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load daily cost series." },
		};
	}
}

// ─── Card delivery metrics (#196 U4) ───────────────────────────────
//
// "Shipped" definition for this surface: `Card.completedAt IS NOT NULL` —
// `card-service.ts` stamps that field on entry to a Done-role column and
// clears it on exit, so it's the stable source of truth (Activity rows are
// not consulted). We join shipped cards to their attributed token spend so
// the Costs page can render "12 cards shipped, $7 avg, ↑ from $5 last
// period" without an agent having to eyeball the board.
//
// Cost attribution mirrors `getCardSummary`'s session-expansion rule: any
// `TokenUsageEvent` directly attributed to the card *plus* any event whose
// `sessionId` was anchored to the card via the same direct-attribution
// chain. F2's `attributeSession` MCP tool closes most of the un-attributed
// gap — events that still lack a `cardId` after that are intentionally
// excluded ("no AI involvement on record"). Cards with $0 cost are dropped
// from the headline so they don't dilute the average.

export type CardDeliveryPeriod = "7d" | "30d" | "lifetime";

export type CardDeliveryEntry = {
	cardId: string;
	cardNumber: number;
	cardTitle: string;
	completedAt: Date;
	totalCostUsd: number;
};

export type CardDeliveryMetrics = {
	shippedCount: number;
	avgCostUsd: number;
	totalCostUsd: number;
	top5: CardDeliveryEntry[];
	periodLabel: CardDeliveryPeriod;
	periodStartDate: Date | null;
	previousPeriodAvgCostUsd: number | null;
};

const PERIOD_DAYS: Record<Exclude<CardDeliveryPeriod, "lifetime">, number> = {
	"7d": 7,
	"30d": 30,
};

// Sum the cost of a shipped card using the same "session-expansion" rule
// `getCardSummary` applies — direct rows + session-shared rows. Returns 0
// when no events resolve, in which case the caller filters this card out
// of the avg/total math (see exclusion note above).
async function sumCardCost(
	cardId: string,
	projectId: string,
	pricing: Record<string, ModelPricing>
): Promise<number> {
	const directRows = await db.tokenUsageEvent.findMany({
		where: { cardId },
		select: { sessionId: true },
	});
	const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));
	if (sessionIds.length === 0) {
		// No direct attribution → no cost to count for this card. Skipping
		// the second query saves a roundtrip on the (large) shipped-but-no-
		// AI-involvement subset of cards.
		return 0;
	}
	const events = await db.tokenUsageEvent.findMany({
		where: {
			projectId,
			OR: [{ cardId }, { sessionId: { in: sessionIds } }],
		},
		select: {
			model: true,
			inputTokens: true,
			outputTokens: true,
			cacheReadTokens: true,
			cacheCreation1hTokens: true,
			cacheCreation5mTokens: true,
		},
	});
	let total = 0;
	for (const event of events) total += computeCost(event, pricing);
	return total;
}

// Average cost over shipped+priced cards in `[periodStart, periodEnd)`.
// Returns null when no priced cards land in the window — used by the
// previous-period comparison so the caller can hide the delta arrow when
// the prior window is empty rather than rendering a meaningless "↑ from $0".
async function avgCostForWindow(
	projectId: string,
	periodStart: Date,
	periodEnd: Date,
	pricing: Record<string, ModelPricing>
): Promise<number | null> {
	const cards = await db.card.findMany({
		where: {
			projectId,
			completedAt: { gte: periodStart, lt: periodEnd },
		},
		select: { id: true },
	});
	if (cards.length === 0) return null;
	let pricedCount = 0;
	let totalCost = 0;
	for (const card of cards) {
		const cost = await sumCardCost(card.id, projectId, pricing);
		if (cost > 0) {
			pricedCount += 1;
			totalCost += cost;
		}
	}
	if (pricedCount === 0) return null;
	return totalCost / pricedCount;
}

async function getCardDeliveryMetrics(
	projectId: string,
	period: CardDeliveryPeriod
): Promise<ServiceResult<CardDeliveryMetrics>> {
	try {
		const pricing = await loadPricing(db);
		const now = new Date();

		// Window math: 7d → [now-7d, now); 30d → [now-30d, now). Lifetime
		// uses null so the Prisma where-clause skips the lower bound.
		const periodStartDate =
			period === "lifetime"
				? null
				: new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);

		const cards = await db.card.findMany({
			where: {
				projectId,
				completedAt: periodStartDate ? { gte: periodStartDate, not: null } : { not: null },
			},
			select: { id: true, number: true, title: true, completedAt: true },
		});

		// Compute cost per card serially. Cards-shipped-per-period is bounded
		// in the dozens for any realistic Pigeon project, so a parallel
		// `Promise.all` would just hammer SQLite without a meaningful win.
		const entries: CardDeliveryEntry[] = [];
		let totalCostUsd = 0;
		let pricedCount = 0;
		let shippedCount = 0;
		for (const card of cards) {
			if (!card.completedAt) continue; // satisfies TS narrowing
			shippedCount += 1;
			const cost = await sumCardCost(card.id, projectId, pricing);
			if (cost <= 0) continue; // exclude $0 cards from headline math
			pricedCount += 1;
			totalCostUsd += cost;
			entries.push({
				cardId: card.id,
				cardNumber: card.number,
				cardTitle: card.title,
				completedAt: card.completedAt,
				totalCostUsd: cost,
			});
		}

		const top5 = entries.sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, 5);
		const avgCostUsd = pricedCount > 0 ? totalCostUsd / pricedCount : 0;

		// Previous-period comparison: same window length, immediately before
		// the current one. Hidden for lifetime (no "previous lifetime"). The
		// avgCostForWindow helper returns null when the prior window has zero
		// priced cards — UI uses that to suppress the delta arrow rather than
		// drawing a phantom comparison against $0.
		let previousPeriodAvgCostUsd: number | null = null;
		if (period !== "lifetime" && periodStartDate) {
			const days = PERIOD_DAYS[period];
			const prevStart = new Date(periodStartDate.getTime() - days * 24 * 60 * 60 * 1000);
			previousPeriodAvgCostUsd = await avgCostForWindow(
				projectId,
				prevStart,
				periodStartDate,
				pricing
			);
		}

		return {
			success: true,
			data: {
				shippedCount,
				avgCostUsd,
				totalCostUsd,
				top5,
				periodLabel: period,
				periodStartDate,
				previousPeriodAvgCostUsd,
			},
		};
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getCardDeliveryMetrics error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load card delivery metrics." },
		};
	}
}

// ─── Setup diagnostics ─────────────────────────────────────────────

export type SetupConfigPath = {
	/** Absolute path of the inspected Claude Code config file. */
	path: string;
	/** True when the file exists and is readable JSON. */
	exists: boolean;
	/** True when a Stop hook invoking `scripts/stop-hook.sh` is present. */
	hasHook: boolean;
};

export type SetupDiagnostics = {
	configPaths: SetupConfigPath[];
	eventCount: number;
	lastEventAt: Date | null;
	/** Count of `Project` rows missing `repoPath` — these can't be resolved by `resolveProjectIdFromCwd` and silently drop their token data. */
	projectsWithoutRepoPath: number;
	/** Absolute path to this server's `scripts/stop-hook.sh` — paste verbatim into `command:` in the user's `settings.json`. */
	recommendedHookCommand: string;
};

// Standard Claude Code config locations checked by the setup dialog.
//
// CC 2.1.x reads hooks ONLY from `settings.json` files (user, project, and
// project-local) — `.claude.json` is an internal state file and its `hooks`
// key is silently ignored. This is the single most common cause of "the
// hook is wired but no events ever land": the snippet went in the wrong
// file. We scan the four locations CC actually reads:
//
//   1. `$CLAUDE_CONFIG_DIR/settings.json`   (env override, when set)
//   2. `~/.claude/settings.json`             (user — default install)
//   3. `~/.claude-alt/settings.json`         (user — side-by-side alt install)
//   4. `<repo>/.claude/settings.json`        (project, shared/committed)
//   5. `<repo>/.claude/settings.local.json`  (project, per-machine/gitignored)
//
// Anything else falls through to the "no config found" state, which lets
// the user paste manually.
//
// Caveat for launchd-installed Pigeon: launchctl services don't inherit
// shell env, so a CLAUDE_CONFIG_DIR set in ~/.zshrc won't be visible here
// unless the user re-exports it via the plist. The standard-paths fallback
// covers ~95% of installs without configuration.
function resolveConfigCandidates(): string[] {
	const home = homedir();
	const candidates: string[] = [];
	const envOverride = process.env.CLAUDE_CONFIG_DIR;
	if (envOverride?.trim()) {
		candidates.push(path.join(envOverride, "settings.json"));
	}
	candidates.push(path.join(home, ".claude", "settings.json"));
	candidates.push(path.join(home, ".claude-alt", "settings.json"));
	// NOTE: project-scoped `<repo>/.claude/settings*.json` lookups are
	// intentionally NOT resolved here. `path.resolve(".claude", ...)` resolves
	// against the *server's* cwd (the launchd install dir at runtime), not the
	// user's repo, so it produced false negatives in the diagnostic. The user-
	// scoped paths above cover ~95% of installs; for the remainder, surface
	// the missing-config state and let the user paste manually rather than
	// lying about a path we can't reliably reach.
	// Dedupe in case env override resolves to one of the standards.
	return Array.from(new Set(candidates));
}

// Absolute path to this server's stop-hook entrypoint. The script lives at
// the project root and is portable (it `cd`s to its own grandparent before
// invoking tsx). Returned in diagnostics so the setup dialog can render a
// per-machine snippet — users paste verbatim instead of substituting a
// placeholder.
export function resolveRecommendedHookCommand(): string {
	return path.resolve("scripts", "stop-hook.sh");
}

// Loose typing: we walk the JSON without enforcing the full Claude Code
// config schema. We recognize a Stop hook of `type: "command"` whose
// `command` ends in `/stop-hook.sh` — the entrypoint shipped at
// `scripts/stop-hook.sh`. The legacy `type: "mcp_tool"` Stop hook is NOT
// recognized: it silently no-ops in CC 2.1.x and showing it as
// "configured" would mislead users into thinking tracking is wired.
function configHasTokenHook(json: unknown): boolean {
	if (!json || typeof json !== "object") return false;
	const hooks = (json as { hooks?: { Stop?: unknown } }).hooks?.Stop;
	if (!Array.isArray(hooks)) return false;
	for (const stop of hooks) {
		const inner = (stop as { hooks?: unknown }).hooks;
		if (!Array.isArray(inner)) continue;
		for (const h of inner) {
			if (!h || typeof h !== "object") continue;
			const entry = h as { type?: string; command?: string };
			if (entry.type !== "command" || typeof entry.command !== "string") continue;
			if (entry.command.endsWith("/stop-hook.sh") || entry.command.endsWith("\\stop-hook.sh")) {
				return true;
			}
		}
	}
	return false;
}

async function inspectConfigPath(absPath: string): Promise<SetupConfigPath> {
	try {
		const content = await readFile(absPath, "utf8");
		const parsed = JSON.parse(content);
		return { path: absPath, exists: true, hasHook: configHasTokenHook(parsed) };
	} catch {
		return { path: absPath, exists: false, hasHook: false };
	}
}

async function getDiagnostics(): Promise<ServiceResult<SetupDiagnostics>> {
	try {
		const candidates = resolveConfigCandidates();
		const [configPaths, latest, total, missingRepoPath] = await Promise.all([
			Promise.all(candidates.map(inspectConfigPath)),
			db.tokenUsageEvent.findFirst({
				orderBy: { recordedAt: "desc" },
				select: { recordedAt: true },
			}),
			db.tokenUsageEvent.count(),
			db.project.count({ where: { OR: [{ repoPath: null }, { repoPath: "" }] } }),
		]);

		return {
			success: true,
			data: {
				configPaths,
				eventCount: total,
				lastEventAt: latest?.recordedAt ?? null,
				projectsWithoutRepoPath: missingRepoPath,
				recommendedHookCommand: resolveRecommendedHookCommand(),
			},
		};
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getDiagnostics error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load diagnostics." },
		};
	}
}

async function getPricing(): Promise<ServiceResult<Record<string, ModelPricing>>> {
	try {
		const pricing = await loadPricing(db);
		return { success: true, data: pricing };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getPricing error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load pricing." },
		};
	}
}

// Bulk-attribute every TokenUsageEvent for a session to a specific card.
// Used by the MCP `attributeSession` tool — auto-called from `briefMe` when
// the session has a known active card, and from `saveHandoff` when exactly
// one card was touched. Closes the $0 `getCardSummary` gap that occurs when
// the Stop hook records token rows with no `cardId`.
//
// Idempotency: re-calling with the same `cardId` is a no-op (UPDATE writes
// the same value back). Calling with a different `cardId` is last-write-
// wins — the most recent attribution overwrites prior ones. No locking is
// needed because the call sites are timing-isolated (briefMe at session
// start, saveHandoff before exit, Stop hook after exit).
async function attributeSession(
	sessionId: string,
	cardId: string
): Promise<ServiceResult<{ updated: number }>> {
	try {
		const card = await db.card.findUnique({ where: { id: cardId }, select: { id: true } });
		if (!card) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}
		const result = await db.tokenUsageEvent.updateMany({
			where: { sessionId },
			data: { cardId },
		});
		return { success: true, data: { updated: result.count } };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] attributeSession error:", error);
		return {
			success: false,
			error: { code: "WRITE_FAILED", message: "Failed to attribute session." },
		};
	}
}

async function updatePricing(
	overrides: Record<string, Partial<ModelPricing>>
): Promise<ServiceResult<Record<string, ModelPricing>>> {
	try {
		await db.appSettings.upsert({
			where: { id: "singleton" },
			create: { id: "singleton", tokenPricing: JSON.stringify(overrides) },
			update: { tokenPricing: JSON.stringify(overrides) },
		});
		const merged = await loadPricing(db);
		return { success: true, data: merged };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] updatePricing error:", error);
		return {
			success: false,
			error: { code: "WRITE_FAILED", message: "Failed to update pricing." },
		};
	}
}

// ─── Aggregation ───────────────────────────────────────────────────

type EventRow = {
	sessionId: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreation1hTokens: number;
	cacheCreation5mTokens: number;
	recordedAt: Date;
};

function aggregateEvents(events: EventRow[], pricing: Record<string, ModelPricing>): UsageSummary {
	const sessions = new Set<string>();
	const byModelMap = new Map<string, ModelTotals>();
	let totalCost = 0;
	let earliest: Date | null = null;

	for (const event of events) {
		sessions.add(event.sessionId);
		const cost = computeCost(event, pricing);
		totalCost += cost;
		if (!earliest || event.recordedAt < earliest) earliest = event.recordedAt;

		const existing = byModelMap.get(event.model) ?? {
			model: event.model,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreation1hTokens: 0,
			cacheCreation5mTokens: 0,
			costUsd: 0,
		};
		existing.inputTokens += event.inputTokens;
		existing.outputTokens += event.outputTokens;
		existing.cacheReadTokens += event.cacheReadTokens;
		existing.cacheCreation1hTokens += event.cacheCreation1hTokens;
		existing.cacheCreation5mTokens += event.cacheCreation5mTokens;
		existing.costUsd += cost;
		byModelMap.set(event.model, existing);
	}

	return {
		totalCostUsd: totalCost,
		sessionCount: sessions.size,
		eventCount: events.length,
		trackingSince: earliest,
		byModel: Array.from(byModelMap.values()).sort((a, b) => b.costUsd - a.costUsd),
	};
}

// ─── Recalibrate baseline (#192 F3) ────────────────────────────────
//
// Measures briefMe's payload size against a naive "load the whole board"
// payload so the UI can render a "Pigeon paid for itself" surface with
// real numbers instead of a hand-tuned constant. Persists the result on
// `Project.metadata.tokenBaseline`. Same chars/4 estimator as
// `src/mcp/utils.ts#ok` so the comparison is apples-to-apples.

export type BaselineResult = {
	briefMeTokens: number;
	naiveBootstrapTokens: number;
	latestHandoffTokens?: number;
	savings: number;
	savingsPct: number;
	measuredAt: string;
};

function safeParseJson(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function estimateTokens(payload: unknown): number {
	return Math.ceil(JSON.stringify(payload).length / 4);
}

async function recalibrateBaseline(projectId: string): Promise<ServiceResult<BaselineResult>> {
	try {
		// Lazy-import to avoid a top-level cycle: brief-payload-service
		// re-uses helpers that themselves live in this file would cause
		// a require-cycle. The import here is hot once per call.
		const { buildBriefPayload } = await import("@/server/services/brief-payload-service");

		// Resolve the project's first board (oldest = canonical default).
		const board = await db.board.findFirst({
			where: { projectId },
			orderBy: { createdAt: "asc" },
		});
		if (!board) {
			return {
				success: false,
				error: { code: "BOARD_NOT_FOUND", message: "Project has no boards." },
			};
		}

		// briefMe-equivalent payload measured at MCP-handler defaults — no
		// brand/version/boot SHAs, since none of those are persisted.
		const briefPayload = await buildBriefPayload(board.id, db);
		const briefMeTokens = estimateTokens(briefPayload);

		// Naive bootstrap: full getBoard payload — every column, every
		// card with full descriptions and checklist items. Mirrors
		// discovery-tools `getBoard` (summary=false, excludeDone=false) so
		// the comparison reflects what an agent would pull in if briefMe
		// didn't exist.
		const fullBoard = await db.board.findUnique({
			where: { id: board.id },
			include: {
				project: true,
				columns: {
					orderBy: { position: "asc" },
					include: {
						cards: {
							orderBy: { position: "asc" },
							include: {
								checklists: { orderBy: { position: "asc" } },
								milestone: { select: { id: true, name: true } },
								_count: { select: { comments: true } },
							},
						},
					},
				},
			},
		});
		const naiveBootstrapTokens = estimateTokens(fullBoard);

		// Latest handoff body — only counted when one exists.
		const latestHandoff = await db.handoff.findFirst({
			where: { boardId: board.id },
			orderBy: { createdAt: "desc" },
		});
		let latestHandoffTokens: number | null = null;
		if (latestHandoff) {
			const handoffSerialized = JSON.stringify({
				summary: latestHandoff.summary,
				workingOn: latestHandoff.workingOn,
				nextSteps: latestHandoff.nextSteps,
				findings: latestHandoff.findings,
				blockers: latestHandoff.blockers,
			});
			latestHandoffTokens = Math.ceil(handoffSerialized.length / 4);
		}

		const measuredAt = new Date().toISOString();
		const tokenBaseline: Record<string, unknown> = {
			briefMeTokens,
			naiveBootstrapTokens,
			...(latestHandoffTokens !== null ? { latestHandoffTokens } : {}),
			measuredAt,
		};

		// Merge into existing metadata so other agent-written keys survive.
		const project = await db.project.findUnique({
			where: { id: projectId },
			select: { metadata: true },
		});
		const existing = safeParseJson(project?.metadata ?? "{}");
		await db.project.update({
			where: { id: projectId },
			data: { metadata: JSON.stringify({ ...existing, tokenBaseline }) },
		});

		const savings = naiveBootstrapTokens - briefMeTokens;
		const savingsPct = naiveBootstrapTokens > 0 ? savings / naiveBootstrapTokens : 0;

		return {
			success: true,
			data: {
				briefMeTokens,
				naiveBootstrapTokens,
				...(latestHandoffTokens !== null ? { latestHandoffTokens } : {}),
				savings,
				savingsPct,
				measuredAt,
			},
		};
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] recalibrateBaseline error:", error);
		return {
			success: false,
			error: {
				code: "RECALIBRATE_FAILED",
				message: error instanceof Error ? error.message : "Failed to recalibrate baseline.",
			},
		};
	}
}

// ─── Pigeon overhead lens (#194 U2) ────────────────────────────────
//
// Surfaces the cost of Pigeon's own MCP tool *responses* — what the
// agent paid in `outputPerMTok` to read tool results. F1 (#190) added
// `responseTokens` (chars/4 of the result body) on `ToolCallLog`; this
// section turns those bytes into a dollar number, grouped per tool.
//
// Pricing rule: a tool call's response is text the agent later reads as
// model input on the next turn — but for the agent that *just produced*
// that response (the assistant), the tokens were emitted as output.
// Sticking to `outputPerMTok` matches how Anthropic bills the assistant
// turn that emitted the tool result. Per-session pricing is resolved
// from the `model` of any TokenUsageEvent for that session; sessions
// with no token rows fall back to `__default__` (zero) so an unwired
// project produces a clean $0 instead of an inflated estimate.

export type PigeonOverheadByTool = {
	toolName: string;
	callCount: number;
	avgResponseTokens: number;
	totalCostUsd: number;
};

export type PigeonOverheadResult = {
	totalResponseTokens: number;
	totalCostUsd: number;
	byTool: PigeonOverheadByTool[];
	sessionCount: number;
};

export type PigeonOverheadPeriod = "7d" | "30d" | "lifetime";

function periodCutoff(period: PigeonOverheadPeriod): Date | null {
	if (period === "lifetime") return null;
	const days = period === "7d" ? 7 : 30;
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function getPigeonOverhead(
	projectId: string,
	period: PigeonOverheadPeriod
): Promise<ServiceResult<PigeonOverheadResult>> {
	try {
		const cutoff = periodCutoff(period);

		// Resolve the session set the period applies to via TokenUsageEvent —
		// the canonical source of "sessions in this project". A session
		// counts as in-period when *any* event for it landed in the window.
		// Lifetime: every distinct sessionId for this project.
		const sessionRows = await db.tokenUsageEvent.findMany({
			where: { projectId, ...(cutoff ? { recordedAt: { gte: cutoff } } : {}) },
			select: { sessionId: true, model: true },
		});
		if (sessionRows.length === 0) {
			return {
				success: true,
				data: { totalResponseTokens: 0, totalCostUsd: 0, byTool: [], sessionCount: 0 },
			};
		}

		// Pick a representative model per session for pricing. Sessions can
		// have multiple model rows (subagent or model switch); we take the
		// first one — the cost contribution per tool call is small enough
		// that mixing rates inside a session would overstate precision.
		const sessionModel = new Map<string, string>();
		for (const row of sessionRows) {
			if (!sessionModel.has(row.sessionId)) sessionModel.set(row.sessionId, row.model);
		}
		const sessionIds = Array.from(sessionModel.keys());

		const [logs, pricing] = await Promise.all([
			// `ToolCallLog` has no `projectId` column — sessionId scoping is safe
			// today because `sessionIds` is derived from this project's
			// `TokenUsageEvent` rows (caller-provided sessionIds are
			// project-scoped at write time), so a cross-project sessionId
			// collision would have to be deliberate. If multi-project sessionId
			// reuse becomes possible, add a JOIN through the corresponding
			// token-usage rows here so we can't leak another project's overhead.
			db.toolCallLog.findMany({
				where: { sessionId: { in: sessionIds } },
				select: { toolName: true, sessionId: true, responseTokens: true },
			}),
			loadPricing(db),
		]);

		type ToolAcc = { callCount: number; totalResponseTokens: number; totalCostUsd: number };
		const byToolMap = new Map<string, ToolAcc>();
		let totalResponseTokens = 0;
		let totalCostUsd = 0;

		for (const log of logs) {
			const model = sessionModel.get(log.sessionId);
			if (!model) continue;
			const rates = pricing[model] ?? pricing.__default__ ?? DEFAULT_PRICING_DEFAULT;
			const cost = (log.responseTokens / 1_000_000) * rates.outputPerMTok;
			totalResponseTokens += log.responseTokens;
			totalCostUsd += cost;

			const existing = byToolMap.get(log.toolName) ?? {
				callCount: 0,
				totalResponseTokens: 0,
				totalCostUsd: 0,
			};
			existing.callCount += 1;
			existing.totalResponseTokens += log.responseTokens;
			existing.totalCostUsd += cost;
			byToolMap.set(log.toolName, existing);
		}

		const byTool: PigeonOverheadByTool[] = Array.from(byToolMap.entries())
			.map(([toolName, acc]) => ({
				toolName,
				callCount: acc.callCount,
				avgResponseTokens:
					acc.callCount === 0 ? 0 : Math.round(acc.totalResponseTokens / acc.callCount),
				totalCostUsd: acc.totalCostUsd,
			}))
			.sort((a, b) => b.totalCostUsd - a.totalCostUsd);

		return {
			success: true,
			data: {
				totalResponseTokens,
				totalCostUsd,
				byTool,
				sessionCount: sessionIds.length,
			},
		};
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getPigeonOverhead error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load Pigeon overhead." },
		};
	}
}

// Card-scoped variant of `getSessionPigeonOverhead` — aggregates Pigeon
// tool overhead across every session that touched this card, using the
// same session-expansion rule as `getCardSummary` (any session anchored
// to the card via direct attribution counts; sessions with `cardId=null`
// that share a sessionId with a direct attribution count too). Backs the
// `<CardPigeonOverheadChip>` rendering on card-detail-sheet, since that
// surface today shows card-aggregate (not per-session) cost. #194
async function getCardPigeonOverhead(
	cardId: string
): Promise<ServiceResult<{ totalCostUsd: number; callCount: number }>> {
	try {
		const card = await db.card.findUnique({ where: { id: cardId }, select: { projectId: true } });
		if (!card) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}
		const directRows = await db.tokenUsageEvent.findMany({
			where: { cardId },
			select: { sessionId: true },
		});
		const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));
		if (sessionIds.length === 0) {
			return { success: true, data: { totalCostUsd: 0, callCount: 0 } };
		}

		// Pick a representative model per session — same approach as
		// `getPigeonOverhead`: first event's model wins. Scope to this card's
		// project so a session-id collision across projects doesn't resolve
		// pricing from the wrong project.
		const eventRows = await db.tokenUsageEvent.findMany({
			where: { sessionId: { in: sessionIds }, projectId: card.projectId },
			select: { sessionId: true, model: true },
			orderBy: { recordedAt: "asc" },
		});
		const sessionModel = new Map<string, string>();
		for (const row of eventRows) {
			if (!sessionModel.has(row.sessionId)) sessionModel.set(row.sessionId, row.model);
		}

		const [logs, pricing] = await Promise.all([
			db.toolCallLog.findMany({
				where: { sessionId: { in: sessionIds } },
				select: { sessionId: true, responseTokens: true },
			}),
			loadPricing(db),
		]);

		let totalCostUsd = 0;
		for (const log of logs) {
			const model = sessionModel.get(log.sessionId);
			if (!model) continue;
			const rates = pricing[model] ?? pricing.__default__ ?? DEFAULT_PRICING_DEFAULT;
			totalCostUsd += (log.responseTokens / 1_000_000) * rates.outputPerMTok;
		}
		return { success: true, data: { totalCostUsd, callCount: logs.length } };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getCardPigeonOverhead error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load card overhead." },
		};
	}
}

// ─── Savings summary (#195 U3) ─────────────────────────────────────
//
// "Pigeon paid for itself" — turns the F3 baseline (`Project.metadata.
// tokenBaseline`) into a dollar-denominated headline by:
//   1. counting how many `briefMe` calls fired in the period
//      (`ToolCallLog.toolName = 'briefMe'` joined to sessions whose token
//      events landed in-window),
//   2. multiplying the per-call savings (naiveBootstrap − briefMe) ×
//      project's primary `inputPerMTok` rate × that count,
//   3. subtracting `getPigeonOverhead`'s totalCostUsd over the same window
//      so the headline is *net* (gross savings minus what Pigeon's tool
//      responses themselves cost the agent in output tokens).
//
// Why input rate, not output rate (#204, locked 2026-05-01):
// The avoided tokens here are the briefMe payload the consumer would have
// otherwise had to *read* on its next turn. Anthropic bills payload reads
// as input tokens, so the savings are the input-rate cost we did not pay
// — pricing them at output rate would inflate the headline ~5× under
// default Anthropic pricing without a defensible billing model behind it.
// Switching to input rate gives `<SavingsSection>` a single, defensible
// "what you'd actually pay" number.
//
// Asymmetry with `getPigeonOverhead`: overhead stays priced at
// `outputPerMTok` because the agent *emits* tool responses (those tokens
// land on the assistant side of the bill). Both framings are correct in
// their own direction — savings = avoided input read on the consumer
// side, overhead = output the agent actually produced. The asymmetry is
// load-bearing, not a typo.
//
// Conservative framing: we assume one briefMe-equivalent rebuild per
// session would have been needed in the naive case (i.e. `briefMeCallCount`
// stands in for "sessions that benefited from Pigeon"). This under-counts
// savings on multi-resume sessions and intentionally over-attributes
// overhead to the same window; the resulting net is a lower bound the UI
// renders honestly even when negative.

export type SavingsPeriod = "7d" | "30d" | "lifetime";

export type SavingsSessionEntry = {
	sessionId: string;
	savingsUsd: number;
	pigeonCostUsd: number;
	recordedAt: Date;
};

export type SavingsSummary =
	| { state: "no-baseline" }
	| {
			state: "ready";
			netSavingsUsd: number;
			grossSavingsUsd: number;
			pigeonOverheadUsd: number;
			briefMeCallCount: number;
			baseline: {
				measuredAt: string;
				naiveBootstrapTokens: number;
				briefMeTokens: number;
			};
			period: SavingsPeriod;
			perSessionLog: SavingsSessionEntry[];
	  };

// Reads the persisted baseline blob, returning null when the project
// hasn't been recalibrated yet OR when the blob exists but is missing the
// fields the savings math depends on. Keeps "no-baseline" as a single
// surface state — the UI doesn't need to distinguish "no metadata" from
// "metadata but no baseline keys".
function readTokenBaseline(metadataRaw: string | null | undefined): {
	measuredAt: string;
	naiveBootstrapTokens: number;
	briefMeTokens: number;
} | null {
	if (!metadataRaw) return null;
	const parsed = safeParseJson(metadataRaw);
	const baseline = parsed.tokenBaseline;
	if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) return null;
	const b = baseline as Record<string, unknown>;
	const measuredAt = typeof b.measuredAt === "string" ? b.measuredAt : null;
	const naiveBootstrapTokens =
		typeof b.naiveBootstrapTokens === "number" && Number.isFinite(b.naiveBootstrapTokens)
			? b.naiveBootstrapTokens
			: null;
	const briefMeTokens =
		typeof b.briefMeTokens === "number" && Number.isFinite(b.briefMeTokens)
			? b.briefMeTokens
			: null;
	if (measuredAt === null || naiveBootstrapTokens === null || briefMeTokens === null) return null;
	return { measuredAt, naiveBootstrapTokens, briefMeTokens };
}

function savingsCutoff(period: SavingsPeriod): Date | null {
	if (period === "lifetime") return null;
	const days = period === "7d" ? 7 : 30;
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function getSavingsSummary(
	projectId: string,
	period: SavingsPeriod
): Promise<ServiceResult<SavingsSummary>> {
	try {
		// Step 1: baseline gate. Without `tokenBaseline.{naive,brief}Tokens`,
		// the savings math has no input — surface the "no-baseline" state so
		// the UI can render the Recalibrate CTA in place of fake numbers.
		const project = await db.project.findUnique({
			where: { id: projectId },
			select: { metadata: true },
		});
		if (!project) {
			return { success: false, error: { code: "NOT_FOUND", message: "Project not found." } };
		}
		const baseline = readTokenBaseline(project.metadata);
		if (!baseline) {
			return { success: true, data: { state: "no-baseline" } };
		}

		// Step 2: scope to the period via TokenUsageEvent — same convention
		// used by `getPigeonOverhead`. A session counts as in-period when any
		// of its events landed in the window.
		const cutoff = savingsCutoff(period);
		const eventRows = await db.tokenUsageEvent.findMany({
			where: { projectId, ...(cutoff ? { recordedAt: { gte: cutoff } } : {}) },
			select: { sessionId: true, model: true, recordedAt: true },
			orderBy: { recordedAt: "desc" },
		});

		const sessionFirstModel = new Map<string, string>();
		const sessionLatestEvent = new Map<string, Date>();
		// `eventRows` is ordered by `recordedAt` desc (see query above), so the
		// first row we see per `sessionId` is already the most recent — a plain
		// `has()` guard is sufficient. No `> existing` comparison needed.
		for (const row of eventRows) {
			if (!sessionFirstModel.has(row.sessionId)) sessionFirstModel.set(row.sessionId, row.model);
			if (!sessionLatestEvent.has(row.sessionId))
				sessionLatestEvent.set(row.sessionId, row.recordedAt);
		}
		const sessionIds = Array.from(sessionFirstModel.keys());

		// Pricing: prefer the most-recent session's model rate as "primary",
		// falling back to `__default__` when no sessions exist in-window.
		// This is honest about uncertainty — a project with one ancient opus
		// session and a fresh sonnet session should price savings at sonnet.
		const pricing = await loadPricing(db);
		const primaryModel = eventRows.length > 0 ? (eventRows[0]?.model ?? null) : null;
		const primaryRates =
			(primaryModel && pricing[primaryModel]) || pricing.__default__ || DEFAULT_PRICING_DEFAULT;
		// Savings are priced at the consumer-side *input* rate — the avoided
		// briefMe payload would have been read as input tokens on the next
		// turn (see doc comment above for the rationale + asymmetry note).
		const inputPerMTok = primaryRates.inputPerMTok;

		// Step 3: count briefMe calls in this period (sessions in-window
		// that called the briefMe MCP tool). One row per call.
		const briefMeLogs =
			sessionIds.length > 0
				? await db.toolCallLog.findMany({
						where: {
							sessionId: { in: sessionIds },
							toolName: "briefMe",
						},
						select: { sessionId: true, createdAt: true },
					})
				: [];
		const briefMeCallCount = briefMeLogs.length;

		// Step 4: gross savings — per-call delta × call count × project rate.
		const perCallSavingsTokens = baseline.naiveBootstrapTokens - baseline.briefMeTokens;
		const grossSavingsUsd =
			(Math.max(0, perCallSavingsTokens) * inputPerMTok * briefMeCallCount) / 1_000_000;

		// Step 5: Pigeon overhead over the same window — reuses the U2
		// service so the numerator and denominator can never drift.
		const overheadResult = await getPigeonOverhead(projectId, period);
		const pigeonOverheadUsd = overheadResult.success ? overheadResult.data.totalCostUsd : 0;

		const netSavingsUsd = grossSavingsUsd - pigeonOverheadUsd;

		// Step 6: per-session log — last 10 sessions in-window, recordedAt
		// desc. Each entry's `savingsUsd` is the per-session contribution
		// (calls in this session × per-call dollar savings) and
		// `pigeonCostUsd` is the session's overhead via
		// `getSessionPigeonOverhead` for the trimmed top-10.
		const briefMeBySession = new Map<string, number>();
		for (const log of briefMeLogs) {
			briefMeBySession.set(log.sessionId, (briefMeBySession.get(log.sessionId) ?? 0) + 1);
		}

		const orderedSessions = Array.from(sessionLatestEvent.entries())
			.sort((a, b) => b[1].getTime() - a[1].getTime())
			.slice(0, 10);

		// Pre-compute per-session overhead in parallel. Sequential awaits here
		// fired up to 10 round-trips per Costs-page render; `Promise.all` keeps
		// the math identical (results array is index-aligned with
		// `orderedSessions`) while collapsing latency to a single batch.
		const sessionOverheads = await Promise.all(
			orderedSessions.map(([sessionId]) => getSessionPigeonOverhead(sessionId))
		);
		const perSessionLog: SavingsSessionEntry[] = orderedSessions.map(
			([sessionId, recordedAt], i) => {
				const calls = briefMeBySession.get(sessionId) ?? 0;
				const savingsUsd = (Math.max(0, perCallSavingsTokens) * inputPerMTok * calls) / 1_000_000;
				const sessionOverhead = sessionOverheads[i];
				const pigeonCostUsd = sessionOverhead?.success ? sessionOverhead.data.totalCostUsd : 0;
				return {
					sessionId,
					savingsUsd,
					pigeonCostUsd,
					recordedAt,
				};
			}
		);

		return {
			success: true,
			data: {
				state: "ready",
				netSavingsUsd,
				grossSavingsUsd,
				pigeonOverheadUsd,
				briefMeCallCount,
				baseline: {
					measuredAt: baseline.measuredAt,
					naiveBootstrapTokens: baseline.naiveBootstrapTokens,
					briefMeTokens: baseline.briefMeTokens,
				},
				period,
				perSessionLog,
			},
		};
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getSavingsSummary error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load savings summary." },
		};
	}
}

async function getSessionPigeonOverhead(
	sessionId: string
): Promise<ServiceResult<{ totalCostUsd: number; callCount: number }>> {
	try {
		const [logs, eventForModel, pricing] = await Promise.all([
			db.toolCallLog.findMany({
				where: { sessionId },
				select: { responseTokens: true },
			}),
			db.tokenUsageEvent.findFirst({
				where: { sessionId },
				select: { model: true },
			}),
			loadPricing(db),
		]);

		if (logs.length === 0) {
			return { success: true, data: { totalCostUsd: 0, callCount: 0 } };
		}

		const model = eventForModel?.model;
		const rates = (model && pricing[model]) || pricing.__default__ || DEFAULT_PRICING_DEFAULT;
		let totalCostUsd = 0;
		for (const log of logs) {
			totalCostUsd += (log.responseTokens / 1_000_000) * rates.outputPerMTok;
		}
		return { success: true, data: { totalCostUsd, callCount: logs.length } };
	} catch (error) {
		console.error("[TOKEN_USAGE_SERVICE] getSessionPigeonOverhead error:", error);
		return {
			success: false,
			error: { code: "QUERY_FAILED", message: "Failed to load session overhead." },
		};
	}
}

// Local fallback so we never index-into `undefined` when pricing's
// `__default__` is absent (DEFAULT_PRICING always carries it, but a
// future override that strips it shouldn't crash this path).
const DEFAULT_PRICING_DEFAULT: ModelPricing = {
	inputPerMTok: 0,
	outputPerMTok: 0,
	cacheReadPerMTok: 0,
	cacheCreation1hPerMTok: 0,
	cacheCreation5mPerMTok: 0,
};

// ─── Service export ────────────────────────────────────────────────

export const tokenUsageService = {
	recordManual,
	recordFromTranscript,
	attributeSession,
	getProjectSummary,
	getSessionSummary,
	getCardSummary,
	getMilestoneSummary,
	getDailyCostSeries,
	getCardDeliveryMetrics,
	getDiagnostics,
	getPricing,
	updatePricing,
	recalibrateBaseline,
	getPigeonOverhead,
	getSessionPigeonOverhead,
	getCardPigeonOverhead,
	getSavingsSummary,
};

/** Test seam: lets unit tests exercise the hook-detection logic without
 * spinning up the DB-backed `getDiagnostics` path, plus the JSONL
 * aggregator so #190 can lock down the parser shape against synthetic
 * transcripts. Not part of the public service API.
 *
 * `resolveBoardScopeWhere` is also exposed here so #200 Phase 1a tests
 * can pin the where-clause shape directly without round-tripping through
 * a query — keeps the unit "what does this helper return?" honest. */
export const __testing__ = { configHasTokenHook, aggregateTranscript, resolveBoardScopeWhere };
