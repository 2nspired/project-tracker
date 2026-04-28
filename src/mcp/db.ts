import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "prisma/generated/client";
import { initFts5 } from "@/server/fts";
import { ftsExtension } from "@/server/fts/extension";

const adapter = new PrismaBetterSqlite3({
	url: "file:./data/tracker.db",
});

const baseClient = new PrismaClient({
	adapter,
	log: ["error", "warn"],
});

// Enable WAL mode for concurrent read/write access (MCP + web server)
baseClient.$executeRawUnsafe("PRAGMA journal_mode = WAL").catch(() => {});
baseClient.$executeRawUnsafe("PRAGMA synchronous = NORMAL").catch(() => {});

// Ensure the FTS5 virtual table exists before any extension hook fires.
initFts5(baseClient).catch((e) => console.error("[fts] init failed (non-fatal):", e));

// Apply the live-sync extension. Hooks update knowledge_fts on every
// note/claim/card/comment write. Errors are logged inside the extension and
// never propagate — FTS is a secondary index.
//
// Cast back to PrismaClient so downstream service signatures (`db: PrismaClient`)
// continue to typecheck. The extended client is structurally a superset at
// runtime — only `$on` (event subscription, unused in this codebase) is
// dropped, and the extension adds no new methods or fields.
export const db = baseClient.$extends(ftsExtension(baseClient)) as unknown as PrismaClient;
