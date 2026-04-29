/**
 * Decision-claim filtering shared by briefMe and downstream views.
 *
 * Background: the legacy proposed/accepted decision statuses both collapsed
 * into Claim `status="active"` during the #86 cutover, so row status alone
 * can't distinguish "currently in force" from "still being decided." We use
 * the linked card's column-role instead — a decision attached to a Done- or
 * Parking-role card is ratified-and-shipped, not open. See #116.
 */

import { hasRole } from "../column-roles.js";

export type DecisionClaimLike = {
	card: { column: { role: string | null; name: string } } | null;
};

/**
 * Keep decisions that are currently in force on still-active work.
 *
 * - No linked card → keep (project-level decision, can't ship with a card).
 * - Linked card in Done/Parking → drop (ratified and shipped).
 * - Otherwise → keep.
 */
export function isRecentDecision<T extends DecisionClaimLike>(claim: T): boolean {
	if (!claim.card) return true;
	return !hasRole(claim.card.column, "done") && !hasRole(claim.card.column, "parking");
}
