// Locks down `activityService.getFlowMetrics` (#208):
// the 7-day throughput sparkline must align to **calendar days in UTC**,
// not a rolling 168-hour window. Mirrors the canonical fix from
// `tokenUsageService.getDailyCostSeries` (#203) so the Pulse strip's two
// sparklines share one x-axis.
//
// Pre-fix the function anchored on `Date.now() - 7d`, so a request fired at
// mid-day put the index 5↔6 boundary 24h before `now` rather than at UTC
// midnight. Yesterday's calendar day was therefore split: completions from
// the late half of yesterday landed in bucket 6 ("today"), completions from
// the early half of yesterday landed in bucket 5.
//
// This test pins three completion events that straddle the two possible
// boundaries (mid-day rolling vs. UTC midnight) so any regression is loud:
//
//   `NOW`   = 2026-04-30T14:00:00Z (mid-UTC-day, the scenario from the
//             card description: "If the page loads at 14:00…").
//   Event A = NOW − 1ms             → 13:59:59.999Z 04-30 (today UTC)
//                                       Pre-fix: bucket 6. Post-fix: bucket 6.
//   Event B = NOW − 23h59m          → 14:01:00Z 04-29   (yesterday UTC)
//                                       Pre-fix: bucket 6 (just inside the
//                                       rolling 24h window).
//                                       Post-fix: bucket 5 (UTC midnight
//                                       puts all of 04-29 in 5).
//   Event C = NOW − 24h01m          → 13:59:00Z 04-29   (yesterday UTC)
//                                       Pre-fix: bucket 5. Post-fix: bucket 5.
//
// Pre-fix bucket counts:  [0,0,0,0,0, 1, 2].
// Post-fix bucket counts: [0,0,0,0,0, 2, 1].
//
// Each event is a `moved` activity into a `done`-role column — that's the
// signal `getFlowMetrics` uses to count throughput.
//
// Fixture pattern matches the existing token-usage suites (per-suite temp
// SQLite via `createTestDb`; `db` mocked via a hoisted ref).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { activityService } = await import("@/server/services/activity-service");

describe("getFlowMetrics — calendar-day (UTC) throughput bucketing", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000208";
	const BOARD_ID = "20000000-2000-4000-8000-200000000208";
	const TODO_COL_ID = "30000000-3000-4000-8000-300000000208";
	const DONE_COL_ID = "30000000-3000-4000-8000-300000000209";
	const CARD_A = "40000000-4000-4000-8000-40000000020a";
	const CARD_B = "40000000-4000-4000-8000-40000000020b";
	const CARD_C = "40000000-4000-4000-8000-40000000020c";

	// Mid-UTC-day: matches the "page loads at 14:00" scenario from the card.
	const NOW = new Date("2026-04-30T14:00:00Z");

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Pin `Date.now()` so the service's window math is deterministic.
		vi.useFakeTimers();
		vi.setSystemTime(NOW);

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Test 208", slug: "test-208" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Board" },
		});
		// Two columns: a non-done source ("Todo") and a done destination
		// ("Done"). `getFlowMetrics` keys throughput off arrivals into a
		// `role: "done"` column.
		await testDb.prisma.column.create({
			data: { id: TODO_COL_ID, boardId: BOARD_ID, name: "Todo", position: 0, role: "todo" },
		});
		await testDb.prisma.column.create({
			data: { id: DONE_COL_ID, boardId: BOARD_ID, name: "Done", position: 1, role: "done" },
		});
		// Distinct cards so each activity references a real card row.
		// `columnId` post-move would be the destination; the throughput bucket
		// is read off `activity.createdAt`, not the card's column, so we just
		// pin them to Done for fixture simplicity.
		for (const id of [CARD_A, CARD_B, CARD_C]) {
			await testDb.prisma.card.create({
				data: {
					id,
					columnId: DONE_COL_ID,
					projectId: PROJECT_ID,
					number: Number.parseInt(id.slice(-2), 16),
					title: `Card ${id.slice(-1)}`,
					position: 0,
				},
			});
		}

		// Event A — 1ms ago. Today UTC, lands in bucket 6 under either rule.
		await testDb.prisma.activity.create({
			data: {
				cardId: CARD_A,
				action: "moved",
				details: 'Moved from "Todo" to "Done"',
				actorType: "AGENT",
				createdAt: new Date(NOW.getTime() - 1),
			},
		});

		// Event B — 23h59m ago. Yesterday UTC. Pre-fix this leaks into bucket 6
		// (only 23h59m old < the 24h rolling boundary); post-fix it correctly
		// belongs in bucket 5 (UTC midnight puts the whole prior calendar day
		// into yesterday's bucket).
		await testDb.prisma.activity.create({
			data: {
				cardId: CARD_B,
				action: "moved",
				details: 'Moved from "Todo" to "Done"',
				actorType: "AGENT",
				createdAt: new Date(NOW.getTime() - (23 * 60 + 59) * 60 * 1000),
			},
		});

		// Event C — 24h01m ago. Yesterday UTC. Bucket 5 under either rule;
		// it anchors "yesterday's bucket isn't lying about its own count".
		await testDb.prisma.activity.create({
			data: {
				cardId: CARD_C,
				action: "moved",
				details: 'Moved from "Todo" to "Done"',
				actorType: "AGENT",
				createdAt: new Date(NOW.getTime() - (24 * 60 + 1) * 60 * 1000),
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		vi.useRealTimers();
		await testDb.cleanup();
	});

	it("aligns the index 5↔6 boundary with UTC midnight, not a rolling 24h", async () => {
		const result = await activityService.getFlowMetrics(BOARD_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		const series = result.data.throughput;
		expect(series).toHaveLength(7);

		// Bucket 6 (today, UTC) holds only Event A: 1 completion.
		// Pre-fix this would also include Event B (count = 2) — that's the
		// regression this test guards against.
		expect(series[6]).toBe(1);

		// Bucket 5 (yesterday, UTC) holds Events B + C: 2 completions.
		// Pre-fix this would only hold Event C (count = 1).
		expect(series[5]).toBe(2);

		// Buckets 0..4 are empty — no events were seeded into them.
		for (let i = 0; i < 5; i++) {
			expect(series[i]).toBe(0);
		}
	});
});
