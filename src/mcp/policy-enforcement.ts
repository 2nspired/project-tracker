/**
 * Tool-boundary enforcement of `tracker.md` policy. Implementation card 3/7
 * of RFC #111 (`docs/RFC-WORKFLOW.md`).
 *
 * Today the only enforced rule is `intent_required_on`: when a tool name is
 * listed there, the MCP server requires the caller to pass a non-empty
 * `intent` string before the tool handler runs. Source-of-truth for which
 * tools require intent moves from per-tool input schemas (the `.min(1)` on
 * `moveCard`/`deleteCard`) to per-project policy. The hardcoded schemas
 * remain as a safety-net default so projects without a `tracker.md` keep
 * the existing behavior (back-compat) — see the design note in card #125.
 *
 * The enforcement is split into two layers so it's easy to unit-test:
 *
 * 1. `requireIntentIfPolicyRequires` (in `./policy-check.ts`) — a pure
 *    function. Given a (possibly null) policy, a tool name, and the
 *    params object, it decides whether the call should be rejected. Most
 *    of the test matrix lives there, with no I/O imports.
 *
 * 2. `loadPolicyForBoard` / `loadPolicyForCwd` / `resolvePolicyForCall` —
 *    small async helpers (this file) that resolve the project from a
 *    `boardId` (or, falling back, the current git repo root) and call
 *    `loadTrackerPolicy`. These are the integration points used by the
 *    tool dispatch wrappers in `instrumentation.ts` and `tool-registry.ts`.
 *
 * Read-on-every-call: `loadTrackerPolicy` is fast (small file, local FS)
 * and we want hot-reload semantics — editing `tracker.md` should take
 * effect on the next tool call without restarting the MCP server.
 */

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { loadTrackerPolicy, type TrackerPolicy } from "../lib/services/tracker-policy.js";
import { db } from "./db.js";

export {
	type IntentCheckResult,
	requireIntentIfPolicyRequires,
} from "./policy-check.js";

const execFileAsync = promisify(execFile);

/**
 * Resolve the policy for a tool call that knows its `boardId`. Returns
 * null if the board (or its project) can't be found, or the project has
 * no `repoPath` — in that case the caller treats it as "no policy" and
 * lets the back-compat path apply (the hardcoded schemas still enforce).
 *
 * Errors from `loadTrackerPolicy` (yaml/schema/version) are *intentionally
 * not surfaced* here. This middleware is solely about the intent-required
 * gate; we don't want a malformed `tracker.md` to block every write. The
 * `policy_error` is already surfaced via `briefMe`'s response so agents
 * see it at session start.
 */
export async function loadPolicyForBoard(
	boardId: string | undefined
): Promise<TrackerPolicy | null> {
	if (!boardId || typeof boardId !== "string") return null;
	try {
		const board = await db.board.findUnique({
			where: { id: boardId },
			select: { project: { select: { repoPath: true } } },
		});
		if (!board) return null;
		const result = await loadTrackerPolicy({
			repoPath: board.project.repoPath,
		});
		return result.policy;
	} catch {
		return null;
	}
}

/**
 * Fallback resolver: when a tool doesn't take `boardId` directly (or it's
 * omitted), try to resolve the project from the caller's git repo root.
 * Mirrors the logic in `resolveBoardFromCwd` but stops at the project
 * (we only need `repoPath`).
 */
export async function loadPolicyForCwd(): Promise<TrackerPolicy | null> {
	const callerCwd = process.env.MCP_CALLER_CWD || process.cwd();
	let repoRoot: string;
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd: callerCwd,
			timeout: 3000,
		});
		repoRoot = await realpath(stdout.trim());
	} catch {
		return null;
	}

	try {
		const project = await db.project.findUnique({
			where: { repoPath: repoRoot },
			select: { repoPath: true },
		});
		if (!project) return null;
		const result = await loadTrackerPolicy({
			repoPath: project.repoPath,
		});
		return result.policy;
	} catch {
		return null;
	}
}

/**
 * Resolve policy from the call's params: prefer an explicit `boardId`,
 * fall back to cwd. Returns null on any failure — the dispatcher then
 * applies back-compat (hardcoded schemas).
 */
export async function resolvePolicyForCall(params: unknown): Promise<TrackerPolicy | null> {
	const boardId =
		typeof params === "object" && params !== null
			? (params as Record<string, unknown>).boardId
			: undefined;
	if (typeof boardId === "string" && boardId.length > 0) {
		const fromBoard = await loadPolicyForBoard(boardId);
		if (fromBoard) return fromBoard;
	}
	return loadPolicyForCwd();
}
