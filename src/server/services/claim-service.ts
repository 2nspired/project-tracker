/**
 * Thin web-side shim over the shared claim service.
 *
 * The actual implementation lives in `src/lib/services/claim.ts` so the
 * MCP process can use it without crossing the `src/server/` ↔ `src/mcp/`
 * layer boundary (v6.2 decision a5a4cde6 — `src/lib/services/` owns
 * shared logic; both processes pass their own `PrismaClient`). Mirrors
 * the `src/server/services/tag-service.ts` shim from cluster 1 and the
 * `src/mcp/staleness.ts` shim from #228.
 *
 * Web callers (decision-service, tRPC routers) keep importing from
 * `@/server/services/claim-service` and call `createClaimService(db)`
 * with their own FTS-extended Next.js db — no singleton is bound here
 * because every existing caller already constructs its own instance.
 */

export {
	type ClaimService,
	type CreateClaimInput,
	createClaimService,
	type ListClaimFilter,
	type NormalizedClaim,
	type UpdateClaimInput,
} from "@/lib/services/claim";
