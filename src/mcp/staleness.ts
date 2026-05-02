/**
 * Thin MCP-side shim over the shared staleness service.
 *
 * The actual implementation lives in `src/lib/services/staleness.ts` so
 * the Next.js web server can use it without crossing the `src/server/` ↔
 * `src/mcp/` layer boundary (v6.2 decision a5a4cde6 — `src/lib/services/`
 * owns shared logic; both processes pass their own `PrismaClient`).
 *
 * MCP callers (`src/mcp/server.ts`, `src/mcp/tools/session-tools.ts`)
 * stay no-arg by binding the local `db` singleton here.
 */

import {
	checkStaleness as checkStalenessImpl,
	formatStalenessWarnings,
	type StalenessWarning,
} from "../lib/services/staleness.js";
import { db } from "./db.js";

export type { StalenessWarning };
export { formatStalenessWarnings };

export async function checkStaleness(projectId: string): Promise<StalenessWarning[]> {
	return checkStalenessImpl(db, projectId);
}
