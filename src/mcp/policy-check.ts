/**
 * Pure intent-enforcement check, factored out from `policy-enforcement.ts`
 * so unit tests can import it without pulling in `db.ts` (which transitively
 * loads the Prisma client). Implementation detail of card #125 / RFC #111.
 *
 * Behavior matrix (also encoded in the test names):
 * - policy is null OR has no `intent_required_on` → pass (back-compat;
 *   any hardcoded `.min(1)` schema is the safety net).
 * - tool not listed in `intent_required_on` → pass.
 * - tool listed, `params.intent` missing/non-string/empty/whitespace → fail
 *   with a clear validation error.
 * - tool listed, `params.intent` is a non-empty string → pass.
 */

import type { TrackerPolicy } from "../lib/services/tracker-policy.js";

export type IntentCheckResult = { ok: true } | { ok: false; message: string };

export function requireIntentIfPolicyRequires(
	policy: TrackerPolicy | null,
	toolName: string,
	params: unknown
): IntentCheckResult {
	if (!policy) return { ok: true };
	const required = policy.intent_required_on;
	if (!Array.isArray(required) || required.length === 0) return { ok: true };
	if (!required.includes(toolName)) return { ok: true };

	const intent =
		typeof params === "object" && params !== null
			? (params as Record<string, unknown>).intent
			: undefined;

	if (typeof intent !== "string" || intent.trim().length === 0) {
		return {
			ok: false,
			message: `Tool "${toolName}" requires a non-empty \`intent\` parameter (per tracker.md → intent_required_on). Pass a short rationale (e.g. \`intent: "promoting to In Progress: starting work"\`).`,
		};
	}

	return { ok: true };
}
