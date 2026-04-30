import { createReadStream } from "node:fs";
import { access, readdir } from "node:fs/promises";
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

// ─── Service export ────────────────────────────────────────────────

export const tokenUsageService = {
	recordManual,
	recordFromTranscript,
	getProjectSummary,
	getSessionSummary,
	getCardSummary,
	getMilestoneSummary,
	getPricing,
	updatePricing,
};
