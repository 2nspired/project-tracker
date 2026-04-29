#!/usr/bin/env tsx

/**
 * Cleanup: delete Board rows whose `projectId` points to a non-existent
 * Project. Surfaced during the 4.0.0 migration sweep — onDelete: Cascade
 * should normally prevent this, but pre-FK-enforced inserts (or direct
 * SQL) can leave dangling refs.
 *
 * Behavior:
 *   - Lists every orphan board with its data counts (cards, columns, notes).
 *   - Deletes empty orphans (relies on schema cascades to clear columns).
 *   - Refuses non-empty orphans unless --force is passed.
 *   - --dry-run prints the plan without writes.
 *
 * Idempotent: a clean DB exits with "no orphans".
 *
 * Run: `npm run db:cleanup-orphan-boards [-- --dry-run] [-- --force]`
 */

import { db } from "../src/server/db.js";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

interface OrphanReport {
	boardId: string;
	boardName: string;
	deadProjectId: string;
	cards: number;
	columns: number;
	notes: number;
	deleted: boolean;
	skipReason?: string;
}

async function main() {
	const boards = await db.board.findMany({
		select: { id: true, name: true, projectId: true },
	});

	const reports: OrphanReport[] = [];

	for (const board of boards) {
		const project = await db.project.findUnique({
			where: { id: board.projectId },
			select: { id: true },
		});
		if (project) continue;

		const [cards, columns, notes] = await Promise.all([
			db.card.count({ where: { column: { boardId: board.id } } }),
			db.column.count({ where: { boardId: board.id } }),
			db.note.count({ where: { boardId: board.id } }),
		]);

		const report: OrphanReport = {
			boardId: board.id,
			boardName: board.name,
			deadProjectId: board.projectId,
			cards,
			columns,
			notes,
			deleted: false,
		};

		const isEmpty = cards === 0 && notes === 0;
		if (!isEmpty && !FORCE) {
			report.skipReason = "non-empty (cards or notes present); pass --force to delete anyway";
			reports.push(report);
			continue;
		}

		if (!DRY_RUN) {
			await db.$transaction(async (tx) => {
				await tx.column.deleteMany({ where: { boardId: board.id } });
				await tx.board.delete({ where: { id: board.id } });
			});
			report.deleted = true;
		}
		reports.push(report);
	}

	if (reports.length === 0) {
		console.log("No orphan boards found.");
		return;
	}

	const verb = DRY_RUN ? "Would delete" : "Deleted";
	console.log(`Found ${reports.length} orphan board(s):\n`);
	for (const r of reports) {
		const status = r.skipReason ? "SKIPPED" : DRY_RUN ? verb : r.deleted ? verb : "UNCHANGED";
		console.log(`  [${status}] ${r.boardName} (${r.boardId})`);
		console.log(`    dead projectId: ${r.deadProjectId}`);
		console.log(`    cards=${r.cards}  columns=${r.columns}  notes=${r.notes}`);
		if (r.skipReason) console.log(`    reason: ${r.skipReason}`);
	}

	if (DRY_RUN) {
		console.log("\nDry run — no writes performed. Re-run without --dry-run to apply.");
	}
}

main()
	.catch((e) => {
		console.error("Cleanup failed:", e);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
