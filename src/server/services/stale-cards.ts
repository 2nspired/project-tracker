/**
 * Thin server-side re-export of the shared stale-cards service.
 *
 * The canonical implementation lives in `src/lib/services/stale-cards.ts`
 * so the MCP process can use it without crossing the `src/server/` ↔
 * `src/mcp/` layer boundary (v6.2 decision a5a4cde6 — `src/lib/services/`
 * owns shared logic; both processes pass their own `PrismaClient`).
 *
 * Existing server-side callers (`api-state`, `board-service`,
 * `card-service`, `brief-payload-service`) keep their import path —
 * `findStaleInProgress` already takes `db: PrismaClient` as its first
 * argument so no signature change was needed.
 */

export {
	findStaleInProgress,
	type StaleCardEntry,
	type StaleCardInfo,
} from "@/lib/services/stale-cards";
