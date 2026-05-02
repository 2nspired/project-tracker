/**
 * Thin web-side shim over the shared token-usage service.
 *
 * The actual implementation lives in `src/lib/services/token-usage.ts` so
 * the MCP process can use it without crossing the `src/server/` ↔
 * `src/mcp/` layer boundary (v6.2 decision a5a4cde6 — `src/lib/services/`
 * owns shared logic; both processes pass their own `PrismaClient`).
 *
 * Web callers (tRPC `token-usage` router, `brief-payload-service`, the
 * test suite) keep their import surface unchanged — they import the
 * `tokenUsageService` singleton from this file. MCP code constructs its
 * own instance via `createTokenUsageService(mcpDb)` against `src/mcp/db`.
 */

import type { PrismaClient } from "prisma/generated/client";
import {
	createTokenUsageService,
	__testing__ as libTesting,
	resolveRecommendedHookCommand,
} from "@/lib/services/token-usage";
import { db } from "@/server/db";

export type {
	BaselineResult,
	DailyCostSeries,
	ManualRecordInput,
	ModelTotals,
	RecordResult,
	SetupConfigPath,
	SetupDiagnostics,
	TokenUsageService,
	TokenUsageWarning,
	TokenUsageWarningCode,
	TranscriptRecordInput,
	UsageSummary,
} from "@/lib/services/token-usage";

export { createTokenUsageService, resolveRecommendedHookCommand };

// Wrap the web `db` import in a Proxy so each property access re-resolves
// the live ESM binding. The existing test suite (token-usage-board-scope,
// token-usage-recalibrate, etc.) mocks `@/server/db` via a hoisted
// `get db()` getter that's populated AFTER this module loads; a regular
// pass-through would capture `null` at construction time and freeze the
// closure to the unset value. The Proxy preserves the pre-refactor "live
// binding" semantics that the singleton implementation relied on.
const livePrisma = new Proxy({} as PrismaClient, {
	get(_target, prop) {
		const current = db as unknown as Record<PropertyKey, unknown>;
		const value = current?.[prop];
		return typeof value === "function"
			? (value as (...args: unknown[]) => unknown).bind(current)
			: value;
	},
});

// Singleton bound to the Next.js db (FTS-extended). MCP code constructs its
// own instance via createTokenUsageService(mcpDb) at module load.
export const tokenUsageService = createTokenUsageService(livePrisma);

// Internals exposed for unit tests — not part of the public service API.
// `resolveBoardScopeWhere` is bound to the web singleton so #200 Phase 1a
// tests can pin the where-clause shape directly without round-tripping
// through a query.
export const __testing__ = {
	...libTesting,
	resolveBoardScopeWhere: tokenUsageService.__resolveBoardScopeWhere,
};
