#!/usr/bin/env -S npx tsx
/**
 * Schema migration: Tag.state column (#170 — TagManager UI).
 *
 * Adds a `state TEXT NOT NULL DEFAULT 'active'` column to the `tag` table.
 * Mirrors `Milestone.state` semantics — archived tags are hidden from
 * list/picker by default but kept in the schema so historical card
 * associations continue to resolve.
 *
 * Why a script instead of `prisma db push`: Prisma sees the FTS5 virtual
 * tables (knowledge_fts and shadow tables) as drift since they live outside
 * the schema, and db:push refuses without --accept-data-loss. Dropping FTS5
 * silently loses the existing index (no bulk-rebuild path exists). Raw SQL
 * sidesteps the foot-gun.
 *
 * Idempotent — safe to re-run. PRAGMA table_info gates the ALTER.
 *
 * Run with the launchd service stopped (`npm run service:stop`).
 *
 * Rollback: `ALTER TABLE tag DROP COLUMN state` (SQLite ≥ 3.35).
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../prisma/generated/client";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const TRACKER_ROOT = resolve(SCRIPT_DIR, "..");
const DB_URL = `file:${resolve(TRACKER_ROOT, "data", "tracker.db")}`;

async function main() {
	const adapter = new PrismaBetterSqlite3({ url: DB_URL });
	const db = new PrismaClient({ adapter, log: ["error"] });

	console.log("");
	console.log("Tag.state migration (#170)");
	console.log("──────────────────────────");
	console.log("");

	try {
		const columns = await db.$queryRawUnsafe<Array<{ name: string }>>(
			"PRAGMA table_info(tag)"
		);
		const hasState = columns.some((c) => c.name === "state");

		if (hasState) {
			console.log("  ✓ tag.state column already present — nothing to do.");
			return;
		}

		await db.$executeRawUnsafe(
			"ALTER TABLE tag ADD COLUMN state TEXT NOT NULL DEFAULT 'active'"
		);

		const tagCount = await db.tag.count();
		console.log(`  ✓ Added tag.state column. ${tagCount} existing rows defaulted to "active".`);
		console.log("");
		console.log("  Next: bump SCHEMA_VERSION to 12 (already done in src/mcp/utils.ts).");
		console.log("        Restart the service: npm run service:start");
	} finally {
		await db.$disconnect();
	}
}

main().catch((error) => {
	console.error("");
	console.error("Migration failed:");
	console.error(error);
	process.exit(1);
});
