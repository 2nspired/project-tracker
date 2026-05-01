#!/usr/bin/env -S npx tsx
/**
 * Schema migration: extract handoffs from Note(kind="handoff") into a
 * dedicated `handoff` table, hard-delete `kind="brief"` snapshots (#179
 * Phase 2, v6.0.0).
 *
 * Why a script instead of `prisma db push`: Prisma sees the FTS5 virtual
 * tables (knowledge_fts and shadow tables) as drift since they live outside
 * the schema, and db:push refuses without --accept-data-loss. With the flag
 * the FTS5 drop fails partway and corrupts the schema engine. Raw SQL
 * sidesteps the foot-gun. FTS is recreated lazily by `queryKnowledge` /
 * `initFts5` on the next read.
 *
 * Idempotent — safe to re-run. The CREATE TABLE IF NOT EXISTS gate, the
 * INSERT…SELECT WHERE NOT EXISTS guard, and the DELETE-by-kind step all
 * tolerate a partially-completed prior run.
 *
 * Run with the launchd service stopped (`npm run service:stop`).
 *
 * Usage:  npm run migrate:handoffs
 *     or  npx tsx scripts/migrate-handoffs-from-notes.ts
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../prisma/generated/client";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const TRACKER_ROOT = resolve(SCRIPT_DIR, "..");
const DB_URL = `file:${resolve(TRACKER_ROOT, "data", "tracker.db")}`;

type LegacyHandoffNote = {
	id: string;
	board_id: string | null;
	project_id: string | null;
	author: string;
	content: string;
	metadata: string;
	created_at: string;
};

async function main() {
	const adapter = new PrismaBetterSqlite3({ url: DB_URL });
	const db = new PrismaClient({ adapter, log: ["error"] });

	console.log("");
	console.log("Handoff extraction migration (#179 Phase 2 → v6.0.0)");
	console.log("─────────────────────────────────────────────────────");
	console.log("");

	try {
		// 1. Create the handoff table if it doesn't exist. Schema mirrors the
		// Prisma model in prisma/schema.prisma; keep these in sync.
		await db.$executeRawUnsafe(`
			CREATE TABLE IF NOT EXISTS handoff (
				id          TEXT PRIMARY KEY,
				board_id    TEXT NOT NULL,
				project_id  TEXT NOT NULL,
				agent_name  TEXT NOT NULL,
				summary     TEXT NOT NULL,
				working_on  TEXT NOT NULL DEFAULT '[]',
				findings    TEXT NOT NULL DEFAULT '[]',
				next_steps  TEXT NOT NULL DEFAULT '[]',
				blockers    TEXT NOT NULL DEFAULT '[]',
				created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (board_id)   REFERENCES board(id)   ON DELETE CASCADE,
				FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
			)
		`);
		await db.$executeRawUnsafe(
			`CREATE INDEX IF NOT EXISTS handoff_board_id_created_at_idx   ON handoff (board_id, created_at)`
		);
		await db.$executeRawUnsafe(
			`CREATE INDEX IF NOT EXISTS handoff_project_id_created_at_idx ON handoff (project_id, created_at)`
		);
		console.log("  ✓ handoff table + indexes ensured");

		// 2. Migrate kind="handoff" Note rows. Skip rows missing board_id or
		// project_id — they're orphans that pre-date the cutover discipline
		// (FK constraints would reject them anyway).
		const orphans = await db.$queryRawUnsafe<{ count: number }[]>(
			`SELECT COUNT(*) as count FROM note WHERE kind = 'handoff' AND (board_id IS NULL OR project_id IS NULL)`
		);
		const orphanCount = orphans[0]?.count ?? 0;
		if (orphanCount > 0) {
			console.warn(`  ⚠ ${orphanCount} handoff notes missing board_id or project_id — skipping`);
		}

		const legacy = await db.$queryRawUnsafe<LegacyHandoffNote[]>(
			`SELECT id, board_id, project_id, author, content, metadata, created_at
			 FROM note
			 WHERE kind = 'handoff' AND board_id IS NOT NULL AND project_id IS NOT NULL`
		);
		console.log(`  • ${legacy.length} handoff notes eligible for migration`);

		let inserted = 0;
		let skipped = 0;
		for (const row of legacy) {
			const exists = await db.$queryRawUnsafe<{ id: string }[]>(
				`SELECT id FROM handoff WHERE id = ?`,
				row.id
			);
			if (exists.length > 0) {
				skipped++;
				continue;
			}
			let metadata: {
				workingOn?: string[];
				findings?: string[];
				nextSteps?: string[];
				blockers?: string[];
			} = {};
			try {
				metadata = JSON.parse(row.metadata || "{}") as typeof metadata;
			} catch {
				console.warn(`    ! note ${row.id} has malformed metadata — defaulting to empty arrays`);
			}
			await db.$executeRawUnsafe(
				`INSERT INTO handoff (id, board_id, project_id, agent_name, summary, working_on, findings, next_steps, blockers, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				row.id,
				row.board_id,
				row.project_id,
				row.author,
				row.content,
				JSON.stringify(metadata.workingOn ?? []),
				JSON.stringify(metadata.findings ?? []),
				JSON.stringify(metadata.nextSteps ?? []),
				JSON.stringify(metadata.blockers ?? []),
				row.created_at
			);
			inserted++;
		}
		console.log(`  ✓ inserted ${inserted} handoffs (${skipped} already migrated)`);

		// 3. Verify count parity before any destructive step.
		const handoffCount = (
			await db.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*) as count FROM handoff`)
		)[0]?.count;
		const expected = legacy.length;
		if ((handoffCount ?? 0) < expected) {
			throw new Error(
				`Migration sanity check failed: handoff table has ${handoffCount} rows, expected at least ${expected}.`
			);
		}
		console.log(`  ✓ handoff row count: ${handoffCount}`);

		// 4. Hard-delete legacy kind="handoff" + kind="brief" Note rows. Briefs
		// have no archival value (synthesized live by briefMe); handoffs are
		// now in the handoff table.
		const briefCount = (
			await db.$queryRawUnsafe<{ count: number }[]>(
				`SELECT COUNT(*) as count FROM note WHERE kind = 'brief'`
			)
		)[0]?.count;
		const noteHandoffCount = (
			await db.$queryRawUnsafe<{ count: number }[]>(
				`SELECT COUNT(*) as count FROM note WHERE kind = 'handoff'`
			)
		)[0]?.count;

		await db.$executeRawUnsafe(`DELETE FROM note WHERE kind IN ('handoff', 'brief')`);
		console.log(
			`  ✓ deleted ${noteHandoffCount} handoff + ${briefCount} brief Note rows`
		);

		// 5. Drop FTS5 virtual + shadow tables if they linger from a prior
		// failed db:push. queryKnowledge / initFts5 will recreate them empty
		// on next read; the cold-start rebuild path repopulates per-project.
		const ftsTables = ["knowledge_fts", "knowledge_fts_data", "knowledge_fts_idx", "knowledge_fts_content", "knowledge_fts_docsize", "knowledge_fts_config"];
		for (const t of ftsTables) {
			try {
				await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${t}`);
			} catch {
				/* tolerate */
			}
		}
		console.log("  ✓ FTS5 shadow tables cleared (will rebuild on next query)");

		console.log("");
		console.log("Done.");
		console.log("Next: bump SCHEMA_VERSION + MCP_SERVER_VERSION + package.json, restart service.");
		console.log("");
	} finally {
		await db.$disconnect();
	}
}

main().catch((err) => {
	console.error("");
	console.error("Migration failed:", err);
	process.exit(1);
});
