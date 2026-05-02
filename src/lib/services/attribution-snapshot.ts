/**
 * Attribution snapshot builder (#269).
 *
 * Bridges the live Prisma state and the pure `attribute()` function in
 * `attribution.ts`. Called from `recordManual` and `recordFromTranscript`
 * before each attribution decision.
 *
 * Scope (signals 1, 2, 5 from #267): only `inProgressCardIds` is populated.
 * Tail signals 3 (`session-recent-touch`) and 4 (`session-commit`) are
 * deferred to #272 — they require sessionId on Activity / GitLink plus a
 * session-id correlation strategy. The snapshot builder returns empty
 * arrays for both fields so `attribute()` falls through to `unattributed`
 * on those branches without ever returning a wrong card.
 *
 * "In Progress" is project-scoped: any card whose column has `role =
 * "active"` on any board within this project. Multi-board projects with
 * one card pinned per board therefore count as multi-In-Progress and
 * correctly classify as `unattributed` (orchestrator gate).
 */

import type { PrismaClient } from "prisma/generated/client";
import type { AttributionStateSnapshot } from "@/lib/services/attribution";

export async function buildAttributionSnapshot(
	prisma: PrismaClient,
	projectId: string
): Promise<AttributionStateSnapshot> {
	const inProgressCards = await prisma.card.findMany({
		where: { projectId, column: { role: "active" } },
		select: { id: true },
	});

	return {
		inProgressCardIds: inProgressCards.map((c) => c.id),
		// Stub for #272 — see file header.
		sessionTouchedCards: [],
		sessionCommits: [],
	};
}
