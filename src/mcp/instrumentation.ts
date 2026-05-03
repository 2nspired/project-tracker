import { randomUUID } from "node:crypto";
import { resolveProjectIdFromCwd } from "@/lib/services/resolve-project";
import { db } from "./db.js";
import { requireIntentIfPolicyRequires, resolvePolicyForCall } from "./policy-enforcement.js";
import type { ToolResult } from "./utils.js";
import { AGENT_NAME, err } from "./utils.js";

// ─── Session Identity ────────────────────────────────────────────────
// One UUID per MCP server process — matches the MCP session lifecycle.
export const SESSION_ID = randomUUID();

// ─── Project Identity (#277) ─────────────────────────────────────────
// Resolve the calling repo's projectId once per process and stamp every
// `tool_call_log` row with it. This decouples project attribution for
// MCP overhead from the Stop-hook ingestion path: previously
// `getProjectPigeonOverhead` discovered project-scoped sessions by
// joining `token_usage_event WHERE projectId = ?` and then filtering
// `tool_call_log WHERE sessionId IN (…)`. When the Stop hook didn't fire
// (or `resolveProjectIdFromCwd` returned null at TokenUsageEvent write
// time), the bridge collapsed to `[]` and `<PigeonOverheadSection>`
// silently rendered $0. Stamping `tool_call_log.projectId` directly at
// write time removes the bridge entirely.
//
// Resolution is cached for the lifetime of the MCP server process — the
// caller cwd is fixed at process start (via `MCP_CALLER_CWD` or the
// inherited `process.cwd()`), so re-resolving per call would be wasted
// `git rev-parse` subprocesses. Resolution is best-effort: if the cwd
// isn't inside a registered repo, the column stays NULL and the row is
// excluded from project-scoped readers. Analytics-only readers
// (`getToolUsageStats`) continue to see every row.
let resolvedProjectIdPromise: Promise<string | null> | null = null;

function getProjectIdForLogs(): Promise<string | null> {
	if (resolvedProjectIdPromise) return resolvedProjectIdPromise;
	const cwd = process.env.MCP_CALLER_CWD || process.cwd();
	resolvedProjectIdPromise = resolveProjectIdFromCwd(cwd, db).catch((e) => {
		console.error("[MCP] projectId resolve for instrumentation failed:", e);
		return null;
	});
	return resolvedProjectIdPromise;
}

/**
 * Test-only: reset the cached projectId so unit tests can re-stub the
 * resolver between cases. No production caller should touch this.
 */
export function __resetResolvedProjectIdForTests(): void {
	resolvedProjectIdPromise = null;
}

// ─── Fire-and-Forget Logger ──────────────────────────────────────────

interface LogEntry {
	toolName: string;
	toolType: "essential" | "extended";
	durationMs: number;
	success: boolean;
	errorMessage?: string;
	responseTokens?: number;
}

function record(entry: LogEntry): void {
	// Resolve projectId asynchronously, then write. The resolve is cached
	// so steady-state cost is one `await` on an already-settled promise.
	getProjectIdForLogs()
		.then((projectId) =>
			db.toolCallLog.create({
				data: {
					toolName: entry.toolName,
					toolType: entry.toolType,
					agentName: AGENT_NAME,
					sessionId: SESSION_ID,
					projectId,
					durationMs: entry.durationMs,
					success: entry.success,
					errorMessage: entry.errorMessage ?? null,
					responseTokens: entry.responseTokens ?? 0,
				},
			})
		)
		.catch((e) => console.error("[MCP] instrumentation write failed:", e));
}

// ─── Extended Tool Logger ────────────────────────────────────────────
// Called by tool-registry.ts after executing an extended tool handler.

export function logToolCall(toolName: string, durationMs: number, result: ToolResult): void {
	record({
		toolName,
		toolType: "extended",
		durationMs,
		success: result.isError !== true,
		errorMessage: result.isError ? result.content[0]?.text?.slice(0, 500) : undefined,
		// Estimate response tokens via the chars/4 heuristic (matches `ok()` in
		// utils.ts). `result.content[0].text` is already the serialized payload
		// (JSON or TOON) — no double-stringify, just measure its length.
		responseTokens: Math.ceil((result.content[0]?.text?.length ?? 0) / 4),
	});
}

// ─── Essential Tool Wrapper ──────────────────────────────────────────
// Wraps essential tool handlers registered directly on McpServer.

export type WrapOptions = {
	/**
	 * When true, the wrapper skips policy resolution entirely. Read-only
	 * tools (e.g. `briefMe`, `checkOnboarding`, `getTools`) cannot trigger
	 * an `intent_required_on` violation — the policy gate only runs on
	 * mutating tools. Skipping avoids the per-call `git rev-parse`
	 * subprocess + DB lookup in `resolvePolicyForCall`. See card #232.
	 */
	readOnlyHint?: boolean;
};

// biome-ignore lint/suspicious/noExplicitAny: handler wrapper must preserve MCP SDK's generic handler types
export function wrapEssentialHandler<F extends (...args: any[]) => Promise<any>>(
	toolName: string,
	handler: F,
	options: WrapOptions = {}
): F {
	const wrapped = (async (...args: unknown[]) => {
		const start = Date.now();
		try {
			// Per-project tracker.md policy enforcement (RFC #111, card 3/7).
			// Runs *before* the tool handler so we reject missing-intent calls
			// without mutating state. The hardcoded `.min(1)` schemas on
			// moveCard/deleteCard remain as a back-compat safety net.
			//
			// Read-only short-circuit (card #232): skip the resolver for tools
			// that can't possibly mutate state. Saves a `git rev-parse`
			// subprocess (3s timeout) + DB lookup on every read-only call.
			const params = args[0];
			if (!options.readOnlyHint) {
				const policy = await resolvePolicyForCall(params);
				const check = requireIntentIfPolicyRequires(policy, toolName, params);
				if (!check.ok) {
					const result = err(check.message);
					record({
						toolName,
						toolType: "essential",
						durationMs: Date.now() - start,
						success: false,
						errorMessage: result.content[0]?.text?.slice(0, 500),
						responseTokens: Math.ceil((result.content[0]?.text?.length ?? 0) / 4),
					});
					return result;
				}
			}

			const result = await handler(...args);
			record({
				toolName,
				toolType: "essential",
				durationMs: Date.now() - start,
				success: result.isError !== true,
				errorMessage: result.isError ? result.content[0]?.text?.slice(0, 500) : undefined,
				responseTokens: Math.ceil((result.content[0]?.text?.length ?? 0) / 4),
			});
			return result;
		} catch (error) {
			record({
				toolName,
				toolType: "essential",
				durationMs: Date.now() - start,
				success: false,
				errorMessage:
					error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
			});
			throw error;
		}
	}) as F;
	return wrapped;
}
