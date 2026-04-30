#!/usr/bin/env -S npx tsx
/**
 * Backfill: Card.completedAt for cards already in Done-role columns (#174).
 *
 * Idempotent — safe to re-run. Only writes when completedAt is currently null
 * AND the card sits in a Done-role column (or a column literally named "Done"
 * for boards that haven't migrated to roles yet).
 *
 * Source of truth, in order:
 *   1. Latest Activity row with action="moved" whose details mention the
 *      target column the card now sits in. This is the actual ship moment.
 *   2. Card.updatedAt as fallback for cards predating the activity log or
 *      whose move activity was wiped.
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

	let scanned = 0;
	let backfilledFromActivity = 0;
	let backfilledFromUpdatedAt = 0;
	let alreadySet = 0;

	console.log("");
	console.log("completedAt backfill (#174)");
	console.log("───────────────────────────");
	console.log("");

	try {
		const doneColumns = await db.column.findMany({
			where: {
				OR: [{ role: "done" }, { name: { equals: "Done" } }],
			},
			select: { id: true, name: true, boardId: true },
		});
		if (doneColumns.length === 0) {
			console.log("  No Done-role columns found — nothing to backfill.");
			return;
		}

		const doneColumnIds = doneColumns.map((c) => c.id);
		const cards = await db.card.findMany({
			where: { columnId: { in: doneColumnIds } },
			select: { id: true, columnId: true, updatedAt: true, completedAt: true },
		});

		for (const card of cards) {
			scanned++;
			if (card.completedAt) {
				alreadySet++;
				continue;
			}

			const targetColumn = doneColumns.find((c) => c.id === card.columnId);
			const targetName = targetColumn?.name ?? "Done";

			const moveActivity = await db.activity.findFirst({
				where: {
					cardId: card.id,
					action: "moved",
					details: { contains: `to "${targetName}"` },
				},
				orderBy: { createdAt: "desc" },
				select: { createdAt: true },
			});

			const completedAt = moveActivity?.createdAt ?? card.updatedAt;
			await db.card.update({
				where: { id: card.id },
				data: { completedAt },
			});
			if (moveActivity) backfilledFromActivity++;
			else backfilledFromUpdatedAt++;
		}

		console.log(`  Scanned ${scanned} card(s) in ${doneColumns.length} Done column(s).`);
		console.log(`  Backfilled from move activity:    ${backfilledFromActivity}`);
		console.log(`  Backfilled from card.updatedAt:   ${backfilledFromUpdatedAt}`);
		console.log(`  Already had completedAt (skipped): ${alreadySet}`);
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
