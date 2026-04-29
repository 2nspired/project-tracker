#!/usr/bin/env tsx
/**
 * Smoke test for the rolling briefMe snapshot history (card #99).
 *
 *  Boundary cases covered
 *    1. saveBriefSnapshot writes Note(kind="brief") with payload round-tripped via JSON.
 *    2. listBriefSnapshots returns rows newest-first.
 *    3. Retention: after 22 inserts at retention=20, exactly 20 remain — the 2 oldest are gone.
 *    4. Per-board scoping: another board's snapshots are untouched by GC on the test board.
 *
 * Run: `tsx scripts/smoke-brief-snapshots.ts` — exits 0 on success, 1 on failure.
 */

import {
	listBriefSnapshots,
	parseBriefSnapshot,
	saveBriefSnapshot,
} from "../src/lib/services/brief-snapshot.js";
import { db } from "../src/server/db.js";

const TAG = `brief-smoke-${Date.now()}`;

let failures = 0;
const fail = (msg: string) => {
	console.error(`✗ ${msg}`);
	failures++;
};
const pass = (msg: string) => console.log(`✓ ${msg}`);

async function main() {
	const project = await db.project.create({
		data: { name: TAG, slug: TAG, description: "Brief snapshot smoke test" },
	});
	const board = await db.board.create({
		data: { projectId: project.id, name: "Brief Smoke Board" },
	});
	const otherBoard = await db.board.create({
		data: { projectId: project.id, name: "Other Smoke Board" },
	});

	try {
		// ─── 1. round-trip ──────────────────────────────────────────────
		const sample = { pulse: "test", topWork: [{ ref: "#1", title: "x" }] };
		const note = await saveBriefSnapshot(db, {
			boardId: board.id,
			agentName: "smoke-agent",
			pulse: "smoke pulse",
			payload: sample,
		});
		if (note.kind === "brief" && note.author === "smoke-agent") {
			pass("note saved with kind=brief + author");
		} else {
			fail(`note kind/author wrong: ${note.kind} / ${note.author}`);
		}
		const parsed = parseBriefSnapshot(note);
		if (JSON.stringify(parsed.payload) === JSON.stringify(sample)) {
			pass("payload round-trips through metadata JSON");
		} else {
			fail(`payload mismatch: ${JSON.stringify(parsed.payload)}`);
		}

		// ─── 2. retention + ordering ─────────────────────────────────────
		// We already wrote 1 above; add 21 more for a total of 22.
		for (let i = 1; i < 22; i++) {
			await saveBriefSnapshot(db, {
				boardId: board.id,
				agentName: "smoke-agent",
				pulse: `pulse ${i}`,
				payload: { i },
			});
		}

		const remaining = await db.note.count({
			where: { boardId: board.id, kind: "brief" },
		});
		if (remaining === 20) {
			pass(`retention enforced: 22 inserts → 20 kept`);
		} else {
			fail(`retention failed: expected 20, got ${remaining}`);
		}

		const list = await listBriefSnapshots(db, board.id, 20);
		if (list.length === 20) {
			pass("list returns 20 rows");
		} else {
			fail(`list length wrong: ${list.length}`);
		}
		const desc = list.every(
			(n, i) => i === 0 || list[i - 1]!.createdAt.getTime() >= n.createdAt.getTime()
		);
		if (desc) pass("list is newest-first");
		else fail("list is not ordered desc by createdAt");

		// The two oldest pulses ("smoke pulse" and "pulse 1") must be gone.
		const oldestStillThere = list.find((n) => n.content === "smoke pulse" || n.content === "pulse 1");
		if (!oldestStillThere) {
			pass("oldest 2 snapshots evicted");
		} else {
			fail(`oldest snapshot survived GC: ${oldestStillThere.content}`);
		}

		// ─── 3. per-board scoping ────────────────────────────────────────
		await saveBriefSnapshot(db, {
			boardId: otherBoard.id,
			agentName: "smoke-agent",
			pulse: "other-board pulse",
			payload: {},
		});
		// Force GC churn on the test board — should not touch otherBoard's row.
		await saveBriefSnapshot(db, {
			boardId: board.id,
			agentName: "smoke-agent",
			pulse: "another",
			payload: {},
		});
		const otherCount = await db.note.count({
			where: { boardId: otherBoard.id, kind: "brief" },
		});
		if (otherCount === 1) {
			pass("other board untouched by GC");
		} else {
			fail(`other-board count wrong: ${otherCount}`);
		}
	} finally {
		// ─── Cleanup ─────────────────────────────────────────────────────
		await db.note.deleteMany({ where: { OR: [{ boardId: board.id }, { boardId: otherBoard.id }] } });
		await db.board.deleteMany({ where: { projectId: project.id } });
		await db.project.delete({ where: { id: project.id } });
	}

	if (failures > 0) {
		console.error(`\n${failures} failure(s)`);
		process.exit(1);
	}
	console.log("\nAll brief-snapshot smoke checks passed.");
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(() => db.$disconnect());
