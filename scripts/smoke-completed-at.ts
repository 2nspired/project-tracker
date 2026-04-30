#!/usr/bin/env tsx

/**
 * Smoke test for `Card.completedAt` behavior on column moves (#174).
 *
 * Seeds an isolated project with In Progress + Done + Backlog columns, then
 * walks a card through the lifecycle and asserts:
 *
 *   1. completedAt is null on creation in a non-Done column.
 *   2. Moving INTO Done sets completedAt to a fresh timestamp.
 *   3. Moving from Done back to a non-Done column clears completedAt.
 *   4. Moving a card across two non-Done columns leaves completedAt null.
 *   5. When a card is dropped into Done with siblings already there, the
 *      siblings' completedAt is NOT clobbered — only the moved card's
 *      completedAt is touched. (The original bug: transactional position
 *      rewrites bumped every Done sibling's updatedAt to ~now, reshuffling
 *      the displayed order.)
 *
 * Run: `tsx scripts/smoke-completed-at.ts` — exits 0 on success, 1 on failure.
 */

import { db } from "../src/server/db.js";
import { cardService } from "../src/server/services/card-service.js";

const TAG = `completed-at-smoke-${Date.now()}`;

let failures = 0;
const fail = (msg: string) => {
	console.error(`✗ ${msg}`);
	failures++;
};
const pass = (msg: string) => console.log(`✓ ${msg}`);

async function main() {
	const project = await db.project.create({
		data: { name: TAG, slug: TAG, description: "completedAt smoke" },
	});
	const board = await db.board.create({
		data: {
			projectId: project.id,
			name: "Smoke Board",
			columns: {
				create: [
					{ name: "Backlog", position: 0, role: "backlog" },
					{ name: "In Progress", position: 1, role: "active" },
					{ name: "Done", position: 2, role: "done" },
				],
			},
		},
		include: { columns: true },
	});
	const backlog = board.columns.find((c) => c.role === "backlog")!;
	const active = board.columns.find((c) => c.role === "active")!;
	const done = board.columns.find((c) => c.role === "done")!;

	const make = (columnId: string, n: number, title: string) =>
		db.card.create({
			data: { columnId, projectId: project.id, number: n, title, position: n, createdBy: "HUMAN" },
		});

	try {
		// ─── 1. completedAt is null on creation in a non-Done column ─────────
		const card = await make(active.id, 1, "lifecycle card");
		card.completedAt === null
			? pass("new card in In Progress has completedAt=null")
			: fail(`expected completedAt=null on creation, got ${card.completedAt}`);

		// ─── 2. Moving INTO Done sets completedAt ────────────────────────────
		const beforeMoveTs = Date.now();
		const moveToDone = await cardService.move(card.id, { columnId: done.id, position: 0 });
		if (!moveToDone.success) {
			fail(`move into Done failed: ${moveToDone.error.message}`);
			return;
		}
		const cardInDone = await db.card.findUniqueOrThrow({ where: { id: card.id } });
		const stamped = cardInDone.completedAt;
		stamped instanceof Date && stamped.getTime() >= beforeMoveTs
			? pass("moving into Done sets completedAt to a fresh timestamp")
			: fail(`expected fresh completedAt, got ${stamped}`);

		// ─── 3. Moving from Done back to non-Done clears completedAt ─────────
		const moveBack = await cardService.move(card.id, { columnId: active.id, position: 0 });
		if (!moveBack.success) {
			fail(`move out of Done failed: ${moveBack.error.message}`);
			return;
		}
		const cardBackInActive = await db.card.findUniqueOrThrow({ where: { id: card.id } });
		cardBackInActive.completedAt === null
			? pass("moving out of Done clears completedAt")
			: fail(`expected completedAt=null after exit, got ${cardBackInActive.completedAt}`);

		// ─── 4. Cross-non-Done moves leave completedAt null ──────────────────
		const moveAcross = await cardService.move(card.id, { columnId: backlog.id, position: 0 });
		if (!moveAcross.success) {
			fail(`move across non-Done failed: ${moveAcross.error.message}`);
			return;
		}
		const cardInBacklog = await db.card.findUniqueOrThrow({ where: { id: card.id } });
		cardInBacklog.completedAt === null
			? pass("moving across non-Done columns leaves completedAt null")
			: fail(`expected completedAt=null after non-Done move, got ${cardInBacklog.completedAt}`);

		// ─── 5. Sibling completedAt is preserved when a new card lands in Done
		const sibling = await make(active.id, 2, "sibling shipped earlier");
		const shipSibling = await cardService.move(sibling.id, { columnId: done.id, position: 0 });
		if (!shipSibling.success) {
			fail(`ship sibling failed: ${shipSibling.error.message}`);
			return;
		}
		const siblingShipped = await db.card.findUniqueOrThrow({ where: { id: sibling.id } });
		const siblingCompletedAt = siblingShipped.completedAt;
		if (!(siblingCompletedAt instanceof Date)) {
			fail("sibling did not get completedAt set on ship");
			return;
		}

		// Now ship a second card; sibling's completedAt should NOT change.
		const second = await make(active.id, 3, "second shipped now");
		await new Promise((r) => setTimeout(r, 5)); // ensure now() can differ
		const shipSecond = await cardService.move(second.id, { columnId: done.id, position: 0 });
		if (!shipSecond.success) {
			fail(`ship second failed: ${shipSecond.error.message}`);
			return;
		}
		const siblingAfter = await db.card.findUniqueOrThrow({ where: { id: sibling.id } });
		siblingAfter.completedAt?.getTime() === siblingCompletedAt.getTime()
			? pass("sibling completedAt preserved when another card lands in Done")
			: fail(
					`sibling completedAt clobbered: was ${siblingCompletedAt.toISOString()}, now ${siblingAfter.completedAt?.toISOString()}`
				);
	} finally {
		await db.project.delete({ where: { id: project.id } });
	}

	if (failures > 0) {
		console.error(`\n${failures} failure(s)`);
		process.exit(1);
	}
	console.log("\nAll completedAt smoke checks passed.");
}

main()
	.catch((e) => {
		console.error("Unhandled error:", e);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
