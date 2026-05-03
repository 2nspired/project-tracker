/**
 * Shared token-usage service.
 *
 * Both the Next.js web server (`src/server/services/token-usage-service.ts`
 * thin shim, tRPC `token-usage` router, brief-payload-service) and the MCP
 * process (`src/mcp/server.ts`, `src/mcp/tools/{baseline,token}-tools.ts`)
 * need the same token-usage write/read paths. Each process owns its own
 * `PrismaClient`, so this module exposes a `createTokenUsageService(prisma)`
 * factory rather than a singleton — mirrors `src/lib/services/tag.ts` and
 * the v6.2 decision (a5a4cde6) that `src/server/` and `src/mcp/` never
 * import from each other; both consume `src/lib/services/`.
 *
 * Process-binding lives in thin shims:
 *   - Web: `src/server/services/token-usage-service.ts` — binds the
 *     Next.js `db` and exports a singleton `tokenUsageService`.
 *   - MCP: callers construct `createTokenUsageService(mcpDb)` locally so
 *     they hit the MCP-process Prisma client, not the web one.
 *
 * Dead code: `getPigeonOverhead` (project-wide period-windowed lens) was
 * dropped in #236 along with `<PigeonOverheadSection>`. The per-session
 * (`getSessionPigeonOverhead`) and per-card (`getCardPigeonOverhead`)
 * variants stay — they back the chip surfaces that survived #236.
 */

import { createReadStream } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Prisma, PrismaClient } from "prisma/generated/client";
import { attribute } from "@/lib/services/attribution";
import { buildAttributionSnapshot } from "@/lib/services/attribution-snapshot";
import { computeCost, type ModelPricing, resolvePricing } from "@/lib/token-pricing-defaults";
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

/**
 * Per-session breakdown of attribution state — backs #213's unattributed
 * gap counter. Three architecturally distinct buckets (a single opaque
 * "unattributed" number conflates them):
 *
 * - `attributed` — at least one row in the session has `cardId` set
 *   (either `signal=explicit`, `single-in-progress`, or restored from a
 *   prior `attributeSession` write).
 * - `unattributed` — every row has `cardId IS NULL` AND at least one row
 *   has a `signal` value. The Attribution Engine ran and decided null
 *   (multi-In-Progress orchestrator session, or no signal at all).
 *   Action implied: review workflow, this is what the engine sees.
 * - `preEngine` — every row has `cardId IS NULL` AND `signal IS NULL`.
 *   These are pre-#269 rows; #270 (deferred) would backfill them.
 *   Action implied: wait for backfill, or accept the historical drag.
 *
 * Counts are session-distinct, not event-distinct, since the Costs UI
 * surfaces the user-meaningful unit. Costs are summed across all events
 * in each bucket's sessions — same scan as `aggregateEvents` already does.
 */
export type AttributionBucket = {
	sessionCount: number;
	costUsd: number;
};

export type AttributionBreakdown = {
	attributed: AttributionBucket;
	unattributed: AttributionBucket;
	preEngine: AttributionBucket;
};

export type UsageSummary = {
	totalCostUsd: number;
	sessionCount: number;
	eventCount: number;
	trackingSince: Date | null;
	byModel: ModelTotals[];
	attributionBreakdown: AttributionBreakdown;
};

/**
 * Per-session row for the Top-N expensive sessions lens (#211).
 * Tight v1 scope — `byModelTotalsUsd` and `briefMeCallCount` from the
 * original card description are deferred (separate queries, low value
 * for the headline lens). The `cardId` reflects whatever attribution
 * the engine produced; sessions touching multiple cards land on the
 * first one alphabetically (deterministic; orchestrator sessions are
 * the multi-card case and they should be `null` per #269).
 */
export type TopSessionEntry = {
	sessionId: string;
	totalCostUsd: number;
	primaryModel: string;
	mostRecentAt: Date;
	cardId: string | null;
	cardRef: string | null;
	cardTitle: string | null;
};

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

export type BaselineResult = {
	briefMeTokens: number;
	naiveBootstrapTokens: number;
	latestHandoffTokens?: number;
	savings: number;
	savingsPct: number;
	measuredAt: string;
};

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
	signal: string | null;
	signalConfidence: string | null;
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
function resolveConfigCandidates(cwd: string = process.cwd()): string[] {
	const home = homedir();
	const candidates: string[] = [];
	const envOverride = process.env.CLAUDE_CONFIG_DIR;
	if (envOverride?.trim()) {
		candidates.push(path.join(envOverride, "settings.json"));
	}
	candidates.push(path.join(home, ".claude", "settings.json"));
	candidates.push(path.join(home, ".claude-alt", "settings.json"));
	// Project-scoped paths: launchd plist sets `WorkingDirectory` to the repo
	// root (see `scripts/service.ts:74-75`), so `path.resolve(cwd, ".claude", ...)`
	// hits the user's repo in both dev and service mode.
	candidates.push(path.resolve(cwd, ".claude", "settings.json"));
	candidates.push(path.resolve(cwd, ".claude", "settings.local.json"));
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
	cardId: string | null;
	signal: string | null;
};

// Per-session attribution state collected during the aggregation pass.
// `hasCardId` and `hasSignal` are sticky-true: once any row in a session
// flips them, they stay flipped. Combined at the end into the three
// AttributionBucket categories.
type SessionAttrState = {
	hasCardId: boolean;
	hasSignal: boolean;
	costUsd: number;
};

function aggregateEvents(events: EventRow[], pricing: Record<string, ModelPricing>): UsageSummary {
	const sessions = new Set<string>();
	const byModelMap = new Map<string, ModelTotals>();
	const sessionAttr = new Map<string, SessionAttrState>();
	let totalCost = 0;
	let earliest: Date | null = null;

	for (const event of events) {
		sessions.add(event.sessionId);
		const cost = computeCost(event, pricing);
		totalCost += cost;
		if (!earliest || event.recordedAt < earliest) earliest = event.recordedAt;

		const attr = sessionAttr.get(event.sessionId) ?? {
			hasCardId: false,
			hasSignal: false,
			costUsd: 0,
		};
		if (event.cardId !== null) attr.hasCardId = true;
		if (event.signal !== null) attr.hasSignal = true;
		attr.costUsd += cost;
		sessionAttr.set(event.sessionId, attr);

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

	const attributionBreakdown: AttributionBreakdown = {
		attributed: { sessionCount: 0, costUsd: 0 },
		unattributed: { sessionCount: 0, costUsd: 0 },
		preEngine: { sessionCount: 0, costUsd: 0 },
	};
	for (const attr of sessionAttr.values()) {
		const bucket = attr.hasCardId
			? attributionBreakdown.attributed
			: attr.hasSignal
				? attributionBreakdown.unattributed
				: attributionBreakdown.preEngine;
		bucket.sessionCount += 1;
		bucket.costUsd += attr.costUsd;
	}

	return {
		totalCostUsd: totalCost,
		sessionCount: sessions.size,
		eventCount: events.length,
		trackingSince: earliest,
		byModel: Array.from(byModelMap.values()).sort((a, b) => b.costUsd - a.costUsd),
		attributionBreakdown,
	};
}

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

// ─── Service factory ─────────────────────────────────────────────────

// Factory matches the createTagService convention so the same logic can
// run inside the Next.js process (with the FTS-extended db singleton) and
// inside the MCP stdio process (with its own better-sqlite3 client).
//
// The web shim binds this against `@/server/db`; the test suite mocks
// that import through a hoisted `get db()` getter that's populated AFTER
// the module loads, so callers may pass a Proxy or a regular client.
// Methods read `prisma` from the closure on every call, preserving the
// pre-refactor "live binding" semantics.
export function createTokenUsageService(prisma: PrismaClient) {
	// ─── Internal: pricing loader ────────────────────────────────────
	async function loadPricing(): Promise<Record<string, ModelPricing>> {
		const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
		return resolvePricing(settings?.tokenPricing ?? null);
	}

	// ─── Internal: board-scope where helper (#200 Phase 1a) ──────────
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

		const cards = await prisma.card.findMany({
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

		const directRows = await prisma.tokenUsageEvent.findMany({
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
			// Attribution Engine (#269): one snapshot read per write, then a
			// pure decision via `attribute()`. Explicit input.cardId always
			// wins (signal=`explicit`); falls through to single-In-Progress,
			// then `unattributed` for multi-In-Progress / no-signal.
			const snapshot = await buildAttributionSnapshot(prisma, input.projectId);
			const attribution = attribute({ cardId: input.cardId }, snapshot);

			const data = {
				sessionId: input.sessionId,
				projectId: input.projectId,
				cardId: attribution.cardId,
				agentName: input.agentName ?? "unknown",
				model: input.model,
				inputTokens: Math.max(0, Math.floor(input.inputTokens)),
				outputTokens: Math.max(0, Math.floor(input.outputTokens)),
				cacheReadTokens: Math.max(0, Math.floor(input.cacheReadTokens ?? 0)),
				cacheCreation1hTokens: Math.max(0, Math.floor(input.cacheCreation1hTokens ?? 0)),
				cacheCreation5mTokens: Math.max(0, Math.floor(input.cacheCreation5mTokens ?? 0)),
				signal: attribution.signal,
				signalConfidence: attribution.confidence,
			};
			const existing = await prisma.tokenUsageEvent.findFirst({
				where: { sessionId: data.sessionId, model: data.model },
				select: { id: true },
			});
			if (existing) {
				await prisma.tokenUsageEvent.update({
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
						signal: data.signal,
						signalConfidence: data.signalConfidence,
					},
				});
			} else {
				await prisma.tokenUsageEvent.create({ data });
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
			warnings.push({
				code: "PARSE_ERROR",
				detail: `${totalParseErrors} malformed line(s) skipped`,
			});
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

		// Attribution Engine (#269): one snapshot per call (not per row), one
		// pure decision shared by every model row in this session. Explicit
		// input.cardId still wins via attribution's signal=`explicit` branch.
		const snapshot = await buildAttributionSnapshot(prisma, input.projectId);
		const attribution = attribute({ cardId: input.cardId }, snapshot);

		const rows: InsertRow[] = [];
		for (const [model, acc] of totals.entries()) {
			rows.push({
				sessionId: input.sessionId,
				projectId: input.projectId,
				cardId: attribution.cardId,
				agentName: input.agentName ?? "claude-code",
				model,
				signal: attribution.signal,
				signalConfidence: attribution.confidence,
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
			const existing = await prisma.tokenUsageEvent.findMany({
				where: { sessionId: input.sessionId, cardId: { not: null } },
				select: { cardId: true },
			});
			const preservedCardId = existing.find((row) => row.cardId !== null)?.cardId ?? null;

			await prisma.$transaction([
				prisma.tokenUsageEvent.deleteMany({ where: { sessionId: input.sessionId } }),
				...rows.map((row) =>
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
							signal: row.signal,
							signalConfidence: row.signalConfidence,
						},
					})
				),
			]);

			// Restore the prior attribution if neither the caller nor the
			// engine produced one. Gate on `attribution.cardId` (not
			// `input.cardId`) so a fresh `single-in-progress` decision wins
			// over a stale `attributeSession` write — which is the whole
			// point of #269. Pre-#269 rows can have a non-null cardId from
			// the manual `attributeSession` MCP tool; we still preserve those
			// when the engine has no signal so the row doesn't regress to null.
			if (preservedCardId && !attribution.cardId) {
				await prisma.tokenUsageEvent.updateMany({
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
				prisma.tokenUsageEvent.findMany({
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
						cardId: true,
						signal: true,
					},
				}),
				loadPricing(),
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
				prisma.tokenUsageEvent.findMany({
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
						cardId: true,
						signal: true,
					},
				}),
				loadPricing(),
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

	// Top-N expensive sessions lens (#211). Aggregates per-session cost
	// from `TokenUsageEvent` rows, sorts by cost desc, joins the attributed
	// card metadata for the surface to render. `boardId` routes through
	// `resolveBoardScopeWhere` so the lens follows the same scoping rule
	// as `getProjectSummary` — board scope means "sessions that touched
	// any card on this board," with the multi-board double-count quirk.
	//
	// Memory ceiling: same as `getProjectSummary` — unbounded findMany over
	// the project's lifetime, aggregated in JS. Acceptable at current
	// dogfooding scale; switch to a SQL `groupBy(sessionId)` if the
	// per-project row count crosses 100k.
	async function getTopSessions(
		projectId: string,
		opts?: { boardId?: string; limit?: number }
	): Promise<ServiceResult<TopSessionEntry[]>> {
		try {
			const limit = Math.max(1, Math.min(100, opts?.limit ?? 10));
			const where = await resolveBoardScopeWhere(projectId, opts?.boardId);
			const [events, pricing] = await Promise.all([
				prisma.tokenUsageEvent.findMany({
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
						cardId: true,
					},
					orderBy: { recordedAt: "asc" },
				}),
				loadPricing(),
			]);

			type SessionAcc = {
				totalCostUsd: number;
				modelCost: Map<string, number>;
				mostRecentAt: Date;
				cardId: string | null;
			};
			const sessions = new Map<string, SessionAcc>();
			for (const event of events) {
				const cost = computeCost(event, pricing);
				const acc = sessions.get(event.sessionId) ?? {
					totalCostUsd: 0,
					modelCost: new Map<string, number>(),
					mostRecentAt: event.recordedAt,
					cardId: null,
				};
				acc.totalCostUsd += cost;
				acc.modelCost.set(event.model, (acc.modelCost.get(event.model) ?? 0) + cost);
				if (event.recordedAt > acc.mostRecentAt) acc.mostRecentAt = event.recordedAt;
				// First non-null cardId wins. The Attribution Engine writes one
				// card per session at write-time, so within a session all rows
				// share the same cardId in practice. The "first wins" rule is
				// just a defensive deterministic tiebreak for legacy rows.
				if (acc.cardId === null && event.cardId !== null) acc.cardId = event.cardId;
				sessions.set(event.sessionId, acc);
			}

			const ranked = Array.from(sessions.entries())
				.map(([sessionId, acc]) => {
					const primaryModel = Array.from(acc.modelCost.entries()).sort(
						(a, b) => b[1] - a[1]
					)[0]?.[0];
					return {
						sessionId,
						totalCostUsd: acc.totalCostUsd,
						primaryModel: primaryModel ?? "unknown",
						mostRecentAt: acc.mostRecentAt,
						cardId: acc.cardId,
					};
				})
				.sort((a, b) => b.totalCostUsd - a.totalCostUsd)
				.slice(0, limit);

			// Hydrate card refs/titles for the rows that have a cardId. One
			// findMany over the de-duped cardId set keeps it bounded by `limit`
			// regardless of how many sessions share a card.
			const cardIds = Array.from(
				new Set(ranked.map((r) => r.cardId).filter((id): id is string => id !== null))
			);
			const cards =
				cardIds.length > 0
					? await prisma.card.findMany({
							where: { id: { in: cardIds } },
							select: { id: true, number: true, title: true },
						})
					: [];
			const cardById = new Map(cards.map((c) => [c.id, c]));

			const rows: TopSessionEntry[] = ranked.map((r) => {
				const card = r.cardId ? cardById.get(r.cardId) : null;
				return {
					sessionId: r.sessionId,
					totalCostUsd: r.totalCostUsd,
					primaryModel: r.primaryModel,
					mostRecentAt: r.mostRecentAt,
					cardId: r.cardId,
					cardRef: card ? `#${card.number}` : null,
					cardTitle: card?.title ?? null,
				};
			});

			return { success: true, data: rows };
		} catch (error) {
			console.error("[TOKEN_USAGE_SERVICE] getTopSessions error:", error);
			return {
				success: false,
				error: { code: "QUERY_FAILED", message: "Failed to load top sessions." },
			};
		}
	}

	// Aggregates events scoped to "any session that touched this card". A
	// session that touched multiple cards contributes to *each* card's total —
	// no fictional split. Returns the same UsageSummary shape so the chip
	// renders identically across surfaces.
	async function getCardSummary(cardId: string): Promise<ServiceResult<UsageSummary>> {
		try {
			const card = await prisma.card.findUnique({
				where: { id: cardId },
				select: { projectId: true },
			});
			if (!card) {
				return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
			}
			// Direct attribution rows (cardId set on event) — included verbatim.
			// Plus session-scoped rows from any session that touched this card via
			// any direct attribution. Keeps the math simple and avoids the
			// "split a 4-card session" trap.
			const directRows = await prisma.tokenUsageEvent.findMany({
				where: { cardId },
				select: { sessionId: true },
			});
			const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));
			const [events, pricing] = await Promise.all([
				prisma.tokenUsageEvent.findMany({
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
						cardId: true,
						signal: true,
					},
				}),
				loadPricing(),
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
			const milestone = await prisma.milestone.findUnique({
				where: { id: milestoneId },
				select: { projectId: true },
			});
			if (!milestone) {
				return { success: false, error: { code: "NOT_FOUND", message: "Milestone not found." } };
			}
			const cards = await prisma.card.findMany({
				where: { milestoneId },
				select: { id: true },
			});
			const cardIds = cards.map((c) => c.id);
			// Session attribution: any session that touched any card in this
			// milestone. Same full-attribution rule as `getCardSummary`.
			const directRows =
				cardIds.length > 0
					? await prisma.tokenUsageEvent.findMany({
							where: { cardId: { in: cardIds } },
							select: { sessionId: true },
						})
					: [];
			const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));

			const [events, pricing] = await Promise.all([
				prisma.tokenUsageEvent.findMany({
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
						cardId: true,
						signal: true,
					},
				}),
				loadPricing(),
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
			const todayUtcMidnightMs = Date.UTC(
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate()
			);
			const windowStart = new Date(todayUtcMidnightMs - 6 * 24 * 60 * 60 * 1000);

			const scopeWhere = await resolveBoardScopeWhere(projectId, boardId);
			const [events, pricing] = await Promise.all([
				prisma.tokenUsageEvent.findMany({
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
						cardId: true,
						signal: true,
					},
				}),
				loadPricing(),
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

	// ─── Setup diagnostics ─────────────────────────────────────────────

	async function getDiagnostics(): Promise<ServiceResult<SetupDiagnostics>> {
		try {
			const candidates = resolveConfigCandidates();
			const [configPaths, latest, total, missingRepoPath] = await Promise.all([
				Promise.all(candidates.map(inspectConfigPath)),
				prisma.tokenUsageEvent.findFirst({
					orderBy: { recordedAt: "desc" },
					select: { recordedAt: true },
				}),
				prisma.tokenUsageEvent.count(),
				prisma.project.count({ where: { OR: [{ repoPath: null }, { repoPath: "" }] } }),
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
			const pricing = await loadPricing();
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
			const card = await prisma.card.findUnique({
				where: { id: cardId },
				select: { id: true },
			});
			if (!card) {
				return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
			}
			const result = await prisma.tokenUsageEvent.updateMany({
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
			await prisma.appSettings.upsert({
				where: { id: "singleton" },
				create: { id: "singleton", tokenPricing: JSON.stringify(overrides) },
				update: { tokenPricing: JSON.stringify(overrides) },
			});
			const merged = await loadPricing();
			return { success: true, data: merged };
		} catch (error) {
			console.error("[TOKEN_USAGE_SERVICE] updatePricing error:", error);
			return {
				success: false,
				error: { code: "WRITE_FAILED", message: "Failed to update pricing." },
			};
		}
	}

	// ─── Recalibrate baseline (#192 F3) ────────────────────────────────
	//
	// Measures briefMe's payload size against a naive "load the whole board"
	// payload so the UI can render a "Pigeon paid for itself" surface with
	// real numbers instead of a hand-tuned constant. Persists the result on
	// `Project.metadata.tokenBaseline`. Same chars/4 estimator as
	// `src/mcp/utils.ts#ok` so the comparison is apples-to-apples.
	//
	// Layer note: `buildBriefPayload` lives in `src/server/services/` because
	// it depends on the tRPC `runVersionCheck`. We reach it via dynamic
	// import so the module-graph link is runtime-only — the boundary lint
	// (regex on static `from "@/server/..."` imports) is satisfied, and any
	// MCP-side caller that invokes `recalibrateBaseline` resolves the server
	// module in-process the same way the pre-refactor singleton did.
	async function recalibrateBaseline(projectId: string): Promise<ServiceResult<BaselineResult>> {
		try {
			// Lazy-import to avoid a top-level cycle (brief-payload-service
			// re-imports the token-usage service) and to keep the lib layer
			// free of static `@/server/...` imports — the boundary lint only
			// matches `from "@/server/..."`, so a dynamic import preserves the
			// historical require-cycle escape and the boundary cleanup.
			const { buildBriefPayload } = await import("@/server/services/brief-payload-service");

			// Resolve the project's first board (oldest = canonical default).
			const board = await prisma.board.findFirst({
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
			const briefPayload = await buildBriefPayload(board.id, prisma);
			const briefMeTokens = estimateTokens(briefPayload);

			// Naive bootstrap: full getBoard payload — every column, every
			// card with full descriptions and checklist items. Mirrors
			// discovery-tools `getBoard` (summary=false, excludeDone=false) so
			// the comparison reflects what an agent would pull in if briefMe
			// didn't exist.
			const fullBoard = await prisma.board.findUnique({
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
			const latestHandoff = await prisma.handoff.findFirst({
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
			const project = await prisma.project.findUnique({
				where: { id: projectId },
				select: { metadata: true },
			});
			const existing = safeParseJson(project?.metadata ?? "{}");
			await prisma.project.update({
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

	// ─── Pigeon overhead helpers (#194 U2) ─────────────────────────────
	//
	// Surfaces the cost of Pigeon's own MCP tool *responses* — what the
	// agent paid in `outputPerMTok` to read tool results. F1 (#190) added
	// `responseTokens` (chars/4 of the result body) on `ToolCallLog`; the
	// helpers below turn those bytes into a dollar number on a per-session
	// or per-card basis.
	//
	// Pricing rule: a tool call's response is text the agent later reads as
	// model input on the next turn — but for the agent that *just produced*
	// that response (the assistant), the tokens were emitted as output.
	// Sticking to `outputPerMTok` matches how Anthropic bills the assistant
	// turn that emitted the tool result. Per-session pricing is resolved
	// from the `model` of any TokenUsageEvent for that session; sessions
	// with no token rows fall back to `__default__` (zero) so an unwired
	// project produces a clean $0 instead of an inflated estimate.
	//
	// History: this section used to also expose `getPigeonOverhead`, the
	// project-wide period-windowed lens that backed `<PigeonOverheadSection>`
	// on the Costs page. That procedure + its component were removed in
	// #236. The per-session and per-card variants stay — they back the
	// `<PigeonOverheadChip>` / `<CardPigeonOverheadChip>` surfaces.

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
			const card = await prisma.card.findUnique({
				where: { id: cardId },
				select: { projectId: true },
			});
			if (!card) {
				return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
			}
			const directRows = await prisma.tokenUsageEvent.findMany({
				where: { cardId },
				select: { sessionId: true },
			});
			const sessionIds = Array.from(new Set(directRows.map((r) => r.sessionId)));
			if (sessionIds.length === 0) {
				return { success: true, data: { totalCostUsd: 0, callCount: 0 } };
			}

			// Pick a representative model per session — first event's model wins.
			// Scope to this card's project so a session-id collision across
			// projects doesn't resolve pricing from the wrong project.
			const eventRows = await prisma.tokenUsageEvent.findMany({
				where: { sessionId: { in: sessionIds }, projectId: card.projectId },
				select: { sessionId: true, model: true },
				orderBy: { recordedAt: "asc" },
			});
			const sessionModel = new Map<string, string>();
			for (const row of eventRows) {
				if (!sessionModel.has(row.sessionId)) sessionModel.set(row.sessionId, row.model);
			}

			const [logs, pricing] = await Promise.all([
				prisma.toolCallLog.findMany({
					where: { sessionId: { in: sessionIds } },
					select: { sessionId: true, responseTokens: true },
				}),
				loadPricing(),
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
				prisma.toolCallLog.findMany({
					where: { sessionId },
					select: { responseTokens: true },
				}),
				prisma.tokenUsageEvent.findFirst({
					where: { sessionId },
					select: { model: true },
				}),
				loadPricing(),
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

	return {
		recordManual,
		recordFromTranscript,
		attributeSession,
		getProjectSummary,
		getSessionSummary,
		getTopSessions,
		getCardSummary,
		getMilestoneSummary,
		getDailyCostSeries,
		getDiagnostics,
		getPricing,
		updatePricing,
		recalibrateBaseline,
		getSessionPigeonOverhead,
		getCardPigeonOverhead,
		// Internals exposed for tests that need to pin scope-resolution
		// behavior without round-tripping through a query (#200 Phase 1a).
		__resolveBoardScopeWhere: resolveBoardScopeWhere,
	};
}

export type TokenUsageService = ReturnType<typeof createTokenUsageService>;

// Internals exposed for unit tests — not part of the public service API.
// `configHasTokenHook` and `aggregateTranscript` are pure helpers that test
// the JSONL parser and config-hook detection without hitting the DB.
// `resolveConfigCandidates` is pure path-building.
export const __testing__ = {
	configHasTokenHook,
	aggregateTranscript,
	resolveConfigCandidates,
};
