import { createReadStream } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { PrismaClient } from "prisma/generated/client";
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

// ─── Internal: row insert (shared between record paths) ────────────

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

async function insertRows(prisma: PrismaClient, rows: InsertRow[]): Promise<void> {
	if (rows.length === 0) return;
	await prisma.$transaction(
		rows.map((row) =>
			prisma.tokenUsageEvent.create({
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
		)
	);
}

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

// ─── Public API ────────────────────────────────────────────────────

async function recordManual(input: ManualRecordInput): Promise<ServiceResult<RecordResult>> {
	try {
		await insertRows(db, [
			{
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
			},
		]);
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
async function getProjectSummary(projectId: string): Promise<ServiceResult<UsageSummary>> {
	try {
		const [events, pricing] = await Promise.all([
			db.tokenUsageEvent.findMany({
				where: { projectId },
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
	/** Daily cost USD over the last 7 days (index 0 = 6 days ago, index 6 = today). */
	dailyCostUsd: number[];
	/** Sum of `dailyCostUsd` — the headline number for the Pulse strip. */
	weekTotalCostUsd: number;
};

// 7-day rolling cost series, indexed identically to `activityService.getFlowMetrics`'s
// `throughput`, so the Pulse UI can render both sparklines on aligned x-axes.
async function getDailyCostSeries(projectId: string): Promise<ServiceResult<DailyCostSeries>> {
	try {
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const [events, pricing] = await Promise.all([
			db.tokenUsageEvent.findMany({
				where: { projectId, recordedAt: { gte: sevenDaysAgo } },
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
				(event.recordedAt.getTime() - sevenDaysAgo.getTime()) / (24 * 60 * 60 * 1000)
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
	candidates.push(path.resolve(".claude", "settings.json"));
	candidates.push(path.resolve(".claude", "settings.local.json"));
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
};

/** Test seam: lets unit tests exercise the hook-detection logic without
 * spinning up the DB-backed `getDiagnostics` path, plus the JSONL
 * aggregator so #190 can lock down the parser shape against synthetic
 * transcripts. Not part of the public service API. */
export const __testing__ = { configHasTokenHook, aggregateTranscript };
