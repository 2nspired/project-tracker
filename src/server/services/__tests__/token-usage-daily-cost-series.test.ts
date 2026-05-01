// Locks down `tokenUsageService.getDailyCostSeries` (#203):
// the 7-day cost sparkline buckets must align to **calendar days in UTC**,
// not a rolling 168-hour window.
//
// Pre-fix the function anchored on `Date.now() - 7d`, so a request fired at
// mid-day put the index 5↔6 boundary 24h before `now` rather than at UTC
// midnight. Yesterday's calendar day was therefore split: events from the
// late half of yesterday landed in bucket 6 ("today"), events from the
// early half of yesterday landed in bucket 5.
//
// This test pins three events that straddle the two possible boundaries
// (mid-day rolling vs. UTC midnight) so any regression is loud:
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
// Pre-fix bucket sums: [0,0,0,0,0, C,        A+B].
// Post-fix bucket sums: [0,0,0,0,0, B+C,    A].
//
// Distinct cost amounts per event let us fingerprint exactly which bucket
// each landed in.
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

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getDailyCostSeries — calendar-day (UTC) bucketing", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000203";
	const SESSION = "session-203";

	// Mid-UTC-day: matches the "page loads at 14:00" scenario from the card.
	const NOW = new Date("2026-04-30T14:00:00Z");

	// Distinct opus output amounts so we can fingerprint per-bucket totals.
	// claude-opus-4-7 default output rate = $75 / 1M tokens.
	const OUTPUT_A = 1_000_000; // → $75 (today, bucket 6)
	const OUTPUT_B = 2_000_000; // → $150 (yesterday early-PM)
	const OUTPUT_C = 4_000_000; // → $300 (yesterday early-PM, before C/B boundary)

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Pin `Date.now()` so the service's window math is deterministic.
		vi.useFakeTimers();
		vi.setSystemTime(NOW);

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Test 203", slug: "test-203" },
		});

		// Event A — 1ms ago. Today UTC, lands in bucket 6 under either rule.
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION,
				projectId: PROJECT_ID,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: OUTPUT_A,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: new Date(NOW.getTime() - 1),
			},
		});

		// Event B — 23h59m ago. Yesterday UTC. Pre-fix this leaks into bucket 6
		// (only 23h59m old < the 24h rolling boundary); post-fix it correctly
		// belongs in bucket 5 (UTC midnight puts the whole prior calendar day
		// into yesterday's bucket).
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION,
				projectId: PROJECT_ID,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: OUTPUT_B,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: new Date(NOW.getTime() - (23 * 60 + 59) * 60 * 1000),
			},
		});

		// Event C — 24h01m ago. Yesterday UTC. Bucket 5 under either rule;
		// it anchors "yesterday's bucket isn't lying about its own cost".
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION,
				projectId: PROJECT_ID,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: OUTPUT_C,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: new Date(NOW.getTime() - (24 * 60 + 1) * 60 * 1000),
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		vi.useRealTimers();
		await testDb.cleanup();
	});

	it("aligns the index 5↔6 boundary with UTC midnight, not a rolling 24h", async () => {
		const result = await tokenUsageService.getDailyCostSeries(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		const series = result.data.dailyCostUsd;
		expect(series).toHaveLength(7);

		// Bucket 6 (today, UTC) holds only Event A: $75.
		// Pre-fix this would also include Event B ($150), totalling $225 —
		// that's the regression this test guards against.
		expect(series[6]).toBeCloseTo(75, 4);

		// Bucket 5 (yesterday, UTC) holds Events B + C: $150 + $300 = $450.
		// Pre-fix this would only hold Event C ($300).
		expect(series[5]).toBeCloseTo(450, 4);

		// Buckets 0..4 are empty — no events were seeded into them.
		for (let i = 0; i < 5; i++) {
			expect(series[i]).toBe(0);
		}

		// Week total = 75 + 150 + 300 = $525 (sum is rule-agnostic; included
		// to anchor the headline number used by the Pulse strip).
		expect(result.data.weekTotalCostUsd).toBeCloseTo(525, 4);
	});
});
