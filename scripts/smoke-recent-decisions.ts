#!/usr/bin/env tsx
/**
 * Smoke test for the recentDecisions filter (card #116).
 *
 * Mirrors the #115 quadrant pattern, but for decisions instead of blockers.
 * Seeds active-status Claims of kind=decision attached to cards in different
 * column-role states, plus the no-card and superseded edge cases, then runs
 * the same query+filter shape that briefMe uses and asserts the right rows
 * survive.
 *
 *  Cases covered
 *    1. active decision on active card  → SURFACES
 *    2. active decision on Done card    → hidden (ratified + shipped)
 *    3. active decision on Parking card → hidden (parked work, not in force)
 *    4. active decision with no card    → SURFACES (project-level)
 *    5. superseded decision on active card → hidden (status filter)
 *
 *  Also asserts:
 *    - select includes card.column.role/name (regression guard for #116 root cause)
 *    - take: 10 caps the result on a project with >10 active decisions
 *
 * Run: `tsx scripts/smoke-recent-decisions.ts` — exits 0 on success, 1 on failure.
 */

import { isRecentDecision } from "../src/lib/services/decisions.js";
import { db } from "../src/server/db.js";

const TAG = `recent-decisions-smoke-${Date.now()}`;

let failures = 0;
const fail = (msg: string) => {
	console.error(`✗ ${msg}`);
	failures++;
};
const pass = (msg: string) => console.log(`✓ ${msg}`);

async function main() {
	const project = await db.project.create({
		data: { name: TAG, slug: TAG, description: "recentDecisions filter smoke" },
	});
	const board = await db.board.create({
		data: {
			projectId: project.id,
			name: "Smoke Board",
			columns: {
				create: [
					{ name: "In Progress", position: 0, role: "active" },
					{ name: "Done", position: 1, role: "done" },
					{ name: "Parking Lot", position: 2, role: "parking" },
				],
			},
		},
		include: { columns: true },
	});
	const active = board.columns.find((c) => c.role === "active")!;
	const done = board.columns.find((c) => c.role === "done")!;
	const parking = board.columns.find((c) => c.role === "parking")!;

	const makeCard = (columnId: string, n: number, title: string) =>
		db.card.create({
			data: {
				columnId,
				projectId: project.id,
				number: n,
				title,
				position: n,
				createdBy: "HUMAN",
			},
		});

	const makeDecision = (
		statement: string,
		opts: { cardId?: string | null; status?: string } = {}
	) =>
		db.claim.create({
			data: {
				projectId: project.id,
				kind: "decision",
				statement,
				body: "",
				evidence: "{}",
				payload: "{}",
				author: "smoke",
				cardId: opts.cardId ?? null,
				status: opts.status ?? "active",
			},
		});

	try {
		// ─── Seed cards ──────────────────────────────────────────────────────
		const activeCard = await makeCard(active.id, 1, "active-card");
		const doneCard = await makeCard(done.id, 2, "done-card");
		const parkingCard = await makeCard(parking.id, 3, "parking-card");

		// ─── Seed decisions across the cases ────────────────────────────────
		const onActive = await makeDecision("decision on active card", { cardId: activeCard.id });
		await makeDecision("decision on Done card", { cardId: doneCard.id });
		await makeDecision("decision on Parking card", { cardId: parkingCard.id });
		const onNoCard = await makeDecision("project-level decision (no card)");
		await makeDecision("superseded decision on active card", {
			cardId: activeCard.id,
			status: "superseded",
		});

		// ─── Replicate the exact briefMe query shape ─────────────────────────
		const decisionClaims = await db.claim.findMany({
			where: { projectId: project.id, kind: "decision", status: "active" },
			orderBy: { createdAt: "desc" },
			take: 10,
			select: {
				id: true,
				statement: true,
				card: {
					select: {
						number: true,
						column: { select: { role: true, name: true } },
					},
				},
			},
		});

		// Regression guard: catch a future "select forgot column" change before
		// it ships and reintroduces the #116 bug class.
		const allHaveColumnOrNoCard = decisionClaims.every(
			(d) => !d.card || (d.card.column && "role" in d.card.column)
		);
		allHaveColumnOrNoCard
			? pass("query select pulls card.column.role for the filter")
			: fail("query select missing card.column shape — filter will misbehave");

		// Status filter at the SQL layer drops superseded.
		const ids = new Set(decisionClaims.map((d) => d.id));
		!ids.has(
			(await db.claim.findFirst({
				where: { projectId: project.id, status: "superseded" },
				select: { id: true },
			}))!.id
		)
			? pass("status='active' SQL filter excludes superseded")
			: fail("superseded decision leaked past the SQL status filter");

		// ─── Apply the filter ────────────────────────────────────────────────
		const surfaced = decisionClaims.filter(isRecentDecision);
		const surfacedStatements = new Set(surfaced.map((d) => d.statement));

		surfacedStatements.has("decision on active card")
			? pass("active card decision surfaces")
			: fail("active card decision should surface but didn't");

		surfacedStatements.has("project-level decision (no card)")
			? pass("project-level decision (no card) surfaces")
			: fail("project-level decision should surface but didn't");

		!surfacedStatements.has("decision on Done card")
			? pass("Done card decision is filtered out")
			: fail("Done card decision leaked through");

		!surfacedStatements.has("decision on Parking card")
			? pass("Parking card decision is filtered out")
			: fail("Parking card decision leaked through");

		surfaced.length === 2
			? pass(`exactly 2 decisions surface (got ${surfaced.length})`)
			: fail(
					`expected 2 decisions to surface, got ${surfaced.length}: ${[...surfacedStatements].join(", ")}`
				);

		// Sanity-check the helper directly on the no-card branch.
		isRecentDecision(onNoCard as never satisfies { card: null })
			? pass("isRecentDecision keeps no-card decisions")
			: fail("isRecentDecision dropped a no-card decision");

		isRecentDecision({ card: { column: { role: "active", name: "In Progress" } } })
			? pass("isRecentDecision keeps active-column decisions")
			: fail("isRecentDecision dropped an active-column decision");

		!isRecentDecision({ card: { column: { role: "done", name: "Done" } } })
			? pass("isRecentDecision drops done-column decisions")
			: fail("isRecentDecision kept a done-column decision");

		// ─── take: 10 cap ────────────────────────────────────────────────────
		// Seed 10 more active decisions on the active card → 11 total active, 1
		// already counted. take=10 should cap.
		for (let i = 0; i < 10; i++) {
			await makeDecision(`bulk-active-decision-${i}`, { cardId: activeCard.id });
		}
		const capped = await db.claim.findMany({
			where: { projectId: project.id, kind: "decision", status: "active" },
			orderBy: { createdAt: "desc" },
			take: 10,
			select: {
				id: true,
				statement: true,
				card: {
					select: { number: true, column: { select: { role: true, name: true } } },
				},
			},
		});
		capped.length === 10
			? pass("take: 10 caps the result set")
			: fail(`take: 10 cap broken — got ${capped.length} rows`);

		// Quick reference — silence "unused" warning on `onActive`.
		void onActive;
	} finally {
		await db.project.delete({ where: { id: project.id } });
	}

	if (failures > 0) {
		console.error(`\n${failures} failure(s)`);
		process.exit(1);
	}
	console.log("\nAll recentDecisions smoke checks passed.");
}

main()
	.catch((e) => {
		console.error("Unhandled error:", e);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
