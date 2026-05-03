/**
 * Thin web-side shim over the shared board-audit service.
 *
 * The actual implementation lives in `src/lib/services/board-audit.ts` so
 * the MCP process can use it without crossing the `src/server/` ↔
 * `src/mcp/` layer boundary (v6.2 decision a5a4cde6 — `src/lib/services/`
 * owns shared logic; both processes pass their own `PrismaClient`).
 * Mirrors the `src/server/services/milestone-service.ts` shim pattern.
 *
 * Web callers (the new tRPC `boardHealth` router that backs the dashboard
 * hygiene panel) keep the `boardAuditService` singleton bound to the
 * FTS-extended Next.js db.
 */

import {
	__testing__,
	type AuditBoardResult,
	type BoardAuditOptions,
	type BoardAuditService,
	type CardRef,
	createBoardAuditService,
	type MissingTagsResult,
	type NearMissTagPair,
	type NoPriorityBacklogResult,
	type OverdueMilestoneEntry,
	type OverdueMilestonesResult,
	type SingleUseTagEntry,
	type StaleDecisionEntry,
	type StaleDecisionsResult,
	type TaxonomyDriftResult,
} from "@/lib/services/board-audit";
import { db } from "@/server/db";

export {
	__testing__,
	type AuditBoardResult,
	type BoardAuditOptions,
	type BoardAuditService,
	type CardRef,
	createBoardAuditService,
	type MissingTagsResult,
	type NearMissTagPair,
	type NoPriorityBacklogResult,
	type OverdueMilestoneEntry,
	type OverdueMilestonesResult,
	type SingleUseTagEntry,
	type StaleDecisionEntry,
	type StaleDecisionsResult,
	type TaxonomyDriftResult,
};

// Singleton bound to the Next.js db (FTS-extended). MCP code constructs
// its own instance via createBoardAuditService(mcpDb) at module load.
export const boardAuditService = createBoardAuditService(db);
