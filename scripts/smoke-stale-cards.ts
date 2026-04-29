#!/usr/bin/env tsx
/**
 * Smoke test for the stale-in-progress detector (card #109).
 *
 * Spins up an isolated project + board + In-Progress column, seeds cards
 * across the boundary cases the spec calls out, then asserts findStaleInProgress
 * flags exactly the right ones.
 *
 *  Boundary cases covered
 *    1. Just-touched card (updatedAt = now) → not stale.
 *    2. Card past threshold by raw updatedAt → stale.
 *    3. Card past threshold by updatedAt BUT a recent comment → not stale.
 *    4. Card past threshold by updatedAt BUT a recent activity row → not stale.
 *    5. Card past threshold by updatedAt BUT a recent git link → not stale.
 *    6. Card past threshold by updatedAt BUT a recent checklist toggle → not stale.
 *    7. Card in a non-active column past threshold → not stale (column gate).
 *    8. Threshold null disables detection entirely.
 *    9. Exactly N days old → stale (boundary inclusive on the cutoff side).
 *
 * Run: `tsx scripts/smoke-stale-cards.ts` — exits 0 on success, 1 on failure.
 */

import { db } from "../src/server/db.js";
import { findStaleInProgress } from "../src/server/services/stale-cards.js";

const TAG = `stale-smoke-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
const THRESHOLD_DAYS = 3;

let failures = 0;
const fail = (msg: string) => {
	console.error(`✗ ${msg}`);
	failures++;
};
const pass = (msg: string) => console.log(`✓ ${msg}`);

async function setBackdated(
	table: "card" | "activity" | "comment" | "git_link" | "checklist_item",
	id: string,
	when: Date
) {
	const col =
		table === "git_link"
			? "commit_date"
			: table === "checklist_item" || table === "card"
				? "updated_at"
				: "created_at";
	await db.$executeRawUnsafe(
		`UPDATE "${table}" SET "${col}" = ? WHERE id = ?`,
		when.toISOString(),
		id
	);
}

async function makeCard(
	columnId: string,
	projectId: string,
	number: number,
	title: string,
	ageDays: number
) {
	const card = await db.card.create({
		data: { columnId, projectId, number, title, position: number, createdBy: "HUMAN" },
	});
	if (ageDays > 0) await setBackdated("card", card.id, new Date(Date.now() - ageDays * DAY));
	return card;
}

async function main() {
	// ─── Setup isolated project + board ─────────────────────────────────
	const project = await db.project.create({
		data: { name: TAG, slug: TAG, description: "Stale-in-progress smoke test" },
	});
	const board = await db.board.create({
		data: {
			projectId: project.id,
			name: "Smoke Board",
			staleInProgressDays: THRESHOLD_DAYS,
			columns: {
				create: [
					{ name: "Backlog", position: 0, role: "backlog" },
					{ name: "In Progress", position: 1, role: "active" },
				],
			},
		},
		include: { columns: true },
	});
	const active = board.columns.find((c) => c.role === "active")!;
	const backlog = board.columns.find((c) => c.role === "backlog")!;

	try {
		// ─── Seed boundary cases ────────────────────────────────────────
		const fresh = await makeCard(active.id, project.id, 1, "fresh", 0);
		const stale = await makeCard(active.id, project.id, 2, "stale", 5);
		const staleButCommented = await makeCard(active.id, project.id, 3, "stale-but-commented", 10);
		const staleButActive = await makeCard(active.id, project.id, 4, "stale-but-activity", 10);
		const staleButCommit = await makeCard(active.id, project.id, 5, "stale-but-commit", 10);
		const staleButChecklist = await makeCard(active.id, project.id, 6, "stale-but-checklist", 10);
		const wrongColumn = await makeCard(backlog.id, project.id, 7, "wrong-column-stale", 10);
		const exactlyN = await makeCard(active.id, project.id, 8, "exactly-N-days", THRESHOLD_DAYS);

		const recent = new Date(Date.now() - 1 * DAY);

		const c = await db.comment.create({
			data: { cardId: staleButCommented.id, content: "still alive" },
		});
		await setBackdated("comment", c.id, recent);

		const a = await db.activity.create({ data: { cardId: staleButActive.id, action: "updated" } });
		await setBackdated("activity", a.id, recent);

		const g = await db.gitLink.create({
			data: {
				projectId: project.id,
				cardId: staleButCommit.id,
				commitHash: `deadbeef${Date.now()}`,
			},
		});
		await setBackdated("git_link", g.id, recent);

		const k = await db.checklistItem.create({
			data: { cardId: staleButChecklist.id, text: "todo", position: 0 },
		});
		await setBackdated("checklist_item", k.id, recent);

		// ─── Detection run ──────────────────────────────────────────────
		const result = await findStaleInProgress(db, board.id);
		const staleIds = new Set(result.keys());

		const expectStale = (id: string, label: string) =>
			staleIds.has(id)
				? pass(`${label} flagged stale`)
				: fail(`${label} should be stale but is not`);
		const expectFresh = (id: string, label: string) =>
			!staleIds.has(id)
				? pass(`${label} not flagged`)
				: fail(`${label} should NOT be stale but was`);

		expectFresh(fresh.id, "just-touched card");
		expectStale(stale.id, "5d-old card with no signals");
		expectFresh(staleButCommented.id, "stale updatedAt + recent comment");
		expectFresh(staleButActive.id, "stale updatedAt + recent activity");
		expectFresh(staleButCommit.id, "stale updatedAt + recent git link");
		expectFresh(staleButChecklist.id, "stale updatedAt + recent checklist mutation");
		expectFresh(wrongColumn.id, "stale card in non-active column");
		expectStale(exactlyN.id, "exactly N-days-old card (boundary)");

		// ─── Threshold-null disables detection ──────────────────────────
		await db.board.update({ where: { id: board.id }, data: { staleInProgressDays: null } });
		const disabled = await findStaleInProgress(db, board.id);
		disabled.size === 0
			? pass("threshold null returns empty map")
			: fail(`threshold null should return empty map (got ${disabled.size})`);
	} finally {
		// ─── Cleanup ────────────────────────────────────────────────────
		await db.project.delete({ where: { id: project.id } });
	}

	if (failures > 0) {
		console.error(`\n${failures} failure(s)`);
		process.exit(1);
	}
	console.log("\nAll stale-cards smoke checks passed.");
}

main()
	.catch((e) => {
		console.error("Unhandled error:", e);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
