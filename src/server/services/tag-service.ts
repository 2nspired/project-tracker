/**
 * Thin web-side shim over the shared tag service.
 *
 * The actual implementation lives in `src/lib/services/tag.ts` so the MCP
 * process can use it without crossing the `src/server/` ↔ `src/mcp/` layer
 * boundary (v6.2 decision a5a4cde6 — `src/lib/services/` owns shared
 * logic; both processes pass their own `PrismaClient`). Mirrors the
 * `src/mcp/staleness.ts` shim pattern.
 *
 * Web callers (tRPC tag router, `src/server/services/card-service.ts`)
 * keep the `tagService` singleton bound to the FTS-extended Next.js db.
 */

import {
	__testing__,
	createTagService,
	type DidYouMean,
	type TagGovernanceHints,
	type TagResolveResult,
	type TagService,
	type TagState,
	type TagWithCount,
	type TagWithHints,
} from "@/lib/services/tag";
import { db } from "@/server/db";

export {
	__testing__,
	createTagService,
	type DidYouMean,
	type TagGovernanceHints,
	type TagResolveResult,
	type TagService,
	type TagState,
	type TagWithCount,
	type TagWithHints,
};

// Singleton bound to the Next.js db (FTS-extended). MCP code constructs
// its own instance via createTagService(mcpDb) at module load.
export const tagService = createTagService(db);
