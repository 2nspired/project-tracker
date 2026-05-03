#!/usr/bin/env -S npx tsx
/**
 * Backfill: ToolCallLog.projectId for rows written before #277.
 *
 * #277 added a `projectId` column to `tool_call_log` so MCP overhead
 * aggregations stop bridging through `token_usage_event`. Existing rows
 * have `projectId = NULL`. This script fills them best-effort via the
 * pre-#277 join: for each NULL row, pick the projectId from any
 * `token_usage_event` that shares the row's `sessionId`.
 *
 * Idempotent — safe to re-run. A row that has no matching TokenUsageEvent
 * (e.g. session never emitted a Stop-hook payload) stays NULL; project-
 * scoped readers filter NULLs out so those rows simply don't contribute
 * to any project's overhead total. They remain visible to
 * `getToolUsageStats`.
 *
 * Run once after `npm run db:push` picks up the schema change.
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
	console.log("tool_call_log.projectId backfill (#277)");
	console.log("──────────────────────────────────────");
	console.log("");

	try {
		// Count baseline up front so we can report the delta.
		const totalRows = await db.toolCallLog.count();
		const nullBefore = await db.toolCallLog.count({ where: { projectId: null } });

		if (nullBefore === 0) {
			console.log(`  All ${totalRows} row(s) already have projectId set — nothing to do.`);
			return;
		}

		// Build a (sessionId → projectId) map from token_usage_event. A
		// session can in principle hit multiple projects (sessionId
		// collisions across projects, deliberate or otherwise) — first row
		// wins. The ambiguity is rare and the cost of a wrong attribution
		// is "this row counts toward project A instead of project B in
		// `getProjectPigeonOverhead`," not data loss.
		const events = await db.tokenUsageEvent.findMany({
			select: { sessionId: true, projectId: true },
			orderBy: { recordedAt: "asc" },
		});
		const sessionToProject = new Map<string, string>();
		for (const e of events) {
			if (!sessionToProject.has(e.sessionId)) {
				sessionToProject.set(e.sessionId, e.projectId);
			}
		}

		// Bulk-update by project. One UPDATE per project keeps the SQL
		// simple and the index churn bounded; SQLite can chew through
		// thousands of rows per query without breaking a sweat.
		const byProject = new Map<string, string[]>();
		for (const [sessionId, projectId] of sessionToProject) {
			const list = byProject.get(projectId) ?? [];
			list.push(sessionId);
			byProject.set(projectId, list);
		}

		let updated = 0;
		for (const [projectId, sessionIds] of byProject) {
			const result = await db.toolCallLog.updateMany({
				where: { projectId: null, sessionId: { in: sessionIds } },
				data: { projectId },
			});
			updated += result.count;
		}

		const nullAfter = await db.toolCallLog.count({ where: { projectId: null } });
		const orphans = nullAfter; // rows whose session never produced a TokenUsageEvent

		console.log(`  Total rows:            ${totalRows}`);
		console.log(`  Rows NULL before:      ${nullBefore}`);
		console.log(`  Rows backfilled:       ${updated}`);
		console.log(
			`  Rows still NULL:       ${orphans} (no matching token_usage_event — kept as orphan logs)`
		);
		console.log("");
		console.log("Done. Run `npm run service:update` to restart the app.");
	} finally {
		await db.$disconnect();
	}
}

main().catch((error) => {
	console.error("Backfill failed:", error);
	process.exit(1);
});
