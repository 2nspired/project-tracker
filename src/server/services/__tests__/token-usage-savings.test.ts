// Locks down the savings-summary lens (#195 U3). Same DB-fixture pattern
// as F1 / U2 / U4 — exercises the real Prisma queries (period window,
// briefMe-call filter, per-session log ordering) so the math + filtering
// drift gets caught at the schema layer if it ever shifts.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

const PROJECT_ID = "10000000-1000-4000-8000-100000000195";
const PROJECT_NO_BASELINE = "10000000-1000-4000-8000-100000000196";
const PROJECT_NEGATIVE = "10000000-1000-4000-8000-100000000197";
const PROJECT_OTHER = "10000000-1000-4000-8000-100000000198";
const PROJECT_LOG_ORDER = "10000000-1000-4000-8000-100000000199";

const SESSION_RECENT = "savings-session-recent";
const SESSION_OTHER_PROJECT = "savings-session-other-project";

describe("getSavingsSummary — no-baseline state", () => {
	let testDb: TestDb;

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Project with NO metadata at all.
		await testDb.prisma.project.create({
			data: {
				id: PROJECT_NO_BASELINE,
				name: "No baseline",
				slug: "no-baseline-195",
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("returns no-baseline when Project.metadata is empty", async () => {
		const result = await tokenUsageService.getSavingsSummary(PROJECT_NO_BASELINE, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({ state: "no-baseline" });
	});

	it("returns no-baseline when metadata exists but tokenBaseline is missing", async () => {
		await testDb.prisma.project.update({
			where: { id: PROJECT_NO_BASELINE },
			data: { metadata: JSON.stringify({ unrelated: "key", another: { nested: true } }) },
		});
		const result = await tokenUsageService.getSavingsSummary(PROJECT_NO_BASELINE, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({ state: "no-baseline" });
	});

	it("returns no-baseline when tokenBaseline is partial (missing required keys)", async () => {
		await testDb.prisma.project.update({
			where: { id: PROJECT_NO_BASELINE },
			data: {
				metadata: JSON.stringify({
					tokenBaseline: { measuredAt: "2026-01-01T00:00:00Z" },
				}),
			},
		});
		const result = await tokenUsageService.getSavingsSummary(PROJECT_NO_BASELINE, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({ state: "no-baseline" });
	});

	it("returns NOT_FOUND when the project does not exist", async () => {
		const result = await tokenUsageService.getSavingsSummary(
			"10000000-1000-4000-8000-100000099999",
			"30d"
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("NOT_FOUND");
	});
});

describe("getSavingsSummary — ready state with positive net savings", () => {
	let testDb: TestDb;

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Project with a baseline alongside unrelated metadata keys — proves
		// the parser tolerates extra blob entries and reads only the keys it
		// needs (per spec).
		await testDb.prisma.project.create({
			data: {
				id: PROJECT_ID,
				name: "Has baseline",
				slug: "has-baseline-195",
				metadata: JSON.stringify({
					unrelatedKey: "preserved",
					nested: { other: 42 },
					tokenBaseline: {
						measuredAt: "2026-04-01T00:00:00Z",
						naiveBootstrapTokens: 11_000,
						briefMeTokens: 1_000,
						// per-call savings = 10_000 tokens
					},
				}),
			},
		});

		// Session with two briefMe calls + one getCardContext (overhead).
		// Model claude-opus-4-7 → inputPerMTok = 15, outputPerMTok = 75.
		// Savings price at the *input* rate (#204): consumer-side semantics
		// — the avoided briefMe payload would have been read as input.
		// Overhead stays output-priced (the agent emits those response
		// tokens).
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_RECENT,
				projectId: PROJECT_ID,
				cardId: null,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// briefMe calls: 2 — each "saved" 10_000 × $15/M = $0.15. Two calls = $0.30.
		// Plus a getCardContext (overhead) so the U2 result has a non-zero overhead.
		await testDb.prisma.toolCallLog.createMany({
			data: [
				{
					toolName: "briefMe",
					toolType: "essential",
					agentName: "test-agent",
					sessionId: SESSION_RECENT,
					durationMs: 5,
					success: true,
					responseTokens: 0, // overhead from briefMe itself ignored for the savings count
				},
				{
					toolName: "briefMe",
					toolType: "essential",
					agentName: "test-agent",
					sessionId: SESSION_RECENT,
					durationMs: 5,
					success: true,
					responseTokens: 0,
				},
				{
					toolName: "getCardContext",
					toolType: "extended",
					agentName: "test-agent",
					sessionId: SESSION_RECENT,
					durationMs: 5,
					success: true,
					responseTokens: 1_000, // $0.000075 of overhead at opus rate
				},
			],
		});

		// Negative-control session in another project — must not contribute.
		await testDb.prisma.project.create({
			data: { id: PROJECT_OTHER, name: "Other", slug: "other-195" },
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_OTHER_PROJECT,
				projectId: PROJECT_OTHER,
				cardId: null,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
		await testDb.prisma.toolCallLog.create({
			data: {
				toolName: "briefMe",
				toolType: "essential",
				agentName: "test-agent",
				sessionId: SESSION_OTHER_PROJECT,
				durationMs: 5,
				success: true,
				responseTokens: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("returns ready with positive net savings using the project's primary model rate", async () => {
		const result = await tokenUsageService.getSavingsSummary(PROJECT_ID, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.state).toBe("ready");
		if (result.data.state !== "ready") return;

		// Per-call savings = (11_000 - 1_000) × 15 / 1_000_000 = $0.15
		// briefMeCallCount = 2 → grossSavings = $0.30
		// (Priced at inputPerMTok per #204 — consumer reads briefMe
		// payload as input on next turn, so the avoided cost is the
		// avoided input read. Old output-rate math gave $1.50.)
		expect(result.data.briefMeCallCount).toBe(2);
		expect(result.data.grossSavingsUsd).toBeCloseTo(0.3, 5);

		// Pigeon overhead = (briefMe×2 = 0 tokens) + (getCardContext = 1k tokens × $75/M)
		//                = $0.000075 total
		expect(result.data.pigeonOverheadUsd).toBeCloseTo((1_000 * 75) / 1_000_000, 5);

		// Net savings = gross − overhead, must be positive in this fixture.
		expect(result.data.netSavingsUsd).toBeCloseTo(
			result.data.grossSavingsUsd - result.data.pigeonOverheadUsd,
			5
		);
		expect(result.data.netSavingsUsd).toBeGreaterThan(0);

		// Period echoed back, baseline echoed back verbatim.
		expect(result.data.period).toBe("30d");
		expect(result.data.baseline).toEqual({
			measuredAt: "2026-04-01T00:00:00Z",
			naiveBootstrapTokens: 11_000,
			briefMeTokens: 1_000,
		});
	});

	it("baseline JSON parses correctly with unrelated metadata keys present", async () => {
		// Same project; the project's metadata blob carries unrelatedKey/nested
		// alongside tokenBaseline. The parser must not be tripped by extras.
		const result = await tokenUsageService.getSavingsSummary(PROJECT_ID, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.state).toBe("ready");
		if (result.data.state !== "ready") return;

		expect(result.data.baseline.naiveBootstrapTokens).toBe(11_000);
		expect(result.data.baseline.briefMeTokens).toBe(1_000);
	});

	it("briefMeCallCount filters by toolName='briefMe' only", async () => {
		// We have 2 briefMe + 1 getCardContext in SESSION_RECENT. If the
		// filter ever loosens, the count would tick up to 3 — this test
		// catches that drift.
		const result = await tokenUsageService.getSavingsSummary(PROJECT_ID, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		if (result.data.state !== "ready") return;
		expect(result.data.briefMeCallCount).toBe(2);
	});

	it("does not count briefMe calls from sessions in other projects", async () => {
		// SESSION_OTHER_PROJECT has 1 briefMe call but lives in PROJECT_OTHER.
		// PROJECT_ID's count must stay at 2.
		const result = await tokenUsageService.getSavingsSummary(PROJECT_ID, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		if (result.data.state !== "ready") return;
		expect(result.data.briefMeCallCount).toBe(2);
	});
});

describe("getSavingsSummary — ready state with negative net savings", () => {
	let testDb: TestDb;

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Tiny per-call savings + lots of expensive overhead → net negative.
		await testDb.prisma.project.create({
			data: {
				id: PROJECT_NEGATIVE,
				name: "Negative net",
				slug: "neg-net-195",
				metadata: JSON.stringify({
					tokenBaseline: {
						measuredAt: "2026-04-01T00:00:00Z",
						naiveBootstrapTokens: 1_500,
						briefMeTokens: 1_000,
						// per-call savings = only 500 tokens × $15/M = $0.0000075
						// (priced at inputPerMTok per #204; old output rate gave $0.0000375)
					},
				}),
			},
		});

		const SESSION = "savings-neg-session";
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION,
				projectId: PROJECT_NEGATIVE,
				cardId: null,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// One briefMe call → tiny savings. Lots of getCardContext overhead → big cost.
		await testDb.prisma.toolCallLog.createMany({
			data: [
				{
					toolName: "briefMe",
					toolType: "essential",
					agentName: "test-agent",
					sessionId: SESSION,
					durationMs: 5,
					success: true,
					responseTokens: 0,
				},
				{
					toolName: "getCardContext",
					toolType: "extended",
					agentName: "test-agent",
					sessionId: SESSION,
					durationMs: 5,
					success: true,
					responseTokens: 1_000_000, // $75 of overhead at opus rate
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("returns negative netSavingsUsd as-is, no flooring or hiding", async () => {
		const result = await tokenUsageService.getSavingsSummary(PROJECT_NEGATIVE, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		if (result.data.state !== "ready") return;

		// gross = (500 × 15 × 1) / 1M = $0.0000075 (input rate, #204)
		// overhead = 1M × 75 / 1M = $75.00 (output rate — agent emits these)
		// net = ~ −$74.99...
		expect(result.data.grossSavingsUsd).toBeCloseTo((500 * 15) / 1_000_000, 5);
		expect(result.data.pigeonOverheadUsd).toBeCloseTo(75, 5);
		expect(result.data.netSavingsUsd).toBeLessThan(0);
		expect(result.data.netSavingsUsd).toBeCloseTo(
			result.data.grossSavingsUsd - result.data.pigeonOverheadUsd,
			5
		);
	});
});

describe("getSavingsSummary — per-session log ordering & cap", () => {
	let testDb: TestDb;

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: {
				id: PROJECT_LOG_ORDER,
				name: "Log order",
				slug: "log-order-195",
				metadata: JSON.stringify({
					tokenBaseline: {
						measuredAt: "2026-04-01T00:00:00Z",
						naiveBootstrapTokens: 11_000,
						briefMeTokens: 1_000,
					},
				}),
			},
		});

		// Seed 12 sessions, each with a single TokenUsageEvent at a distinct
		// recordedAt, plus one briefMe call. The service must return the
		// most-recent 10 in `recordedAt` desc order.
		const now = Date.now();
		for (let i = 0; i < 12; i++) {
			const sessionId = `log-order-session-${i}`;
			// session 0 is the oldest, session 11 is the newest.
			const recordedAt = new Date(now - (11 - i) * 60 * 1000); // 1-minute spacing
			await testDb.prisma.tokenUsageEvent.create({
				data: {
					sessionId,
					projectId: PROJECT_LOG_ORDER,
					cardId: null,
					agentName: "test-agent",
					model: "claude-opus-4-7",
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheCreation1hTokens: 0,
					cacheCreation5mTokens: 0,
					recordedAt,
				},
			});
			await testDb.prisma.toolCallLog.create({
				data: {
					toolName: "briefMe",
					toolType: "essential",
					agentName: "test-agent",
					sessionId,
					durationMs: 5,
					success: true,
					responseTokens: 0,
				},
			});
		}
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("returns the 10 most-recent sessions in recordedAt desc order", async () => {
		const result = await tokenUsageService.getSavingsSummary(PROJECT_LOG_ORDER, "lifetime");
		expect(result.success).toBe(true);
		if (!result.success) return;
		if (result.data.state !== "ready") return;

		expect(result.data.perSessionLog).toHaveLength(10);

		// Newest first → log-order-session-11, then -10, …, down to -2.
		const ids = result.data.perSessionLog.map((s) => s.sessionId);
		expect(ids[0]).toBe("log-order-session-11");
		expect(ids[9]).toBe("log-order-session-2");

		// Strict desc on recordedAt.
		for (let i = 1; i < result.data.perSessionLog.length; i++) {
			const prev = result.data.perSessionLog[i - 1].recordedAt.getTime();
			const curr = result.data.perSessionLog[i].recordedAt.getTime();
			expect(prev).toBeGreaterThanOrEqual(curr);
		}

		// Each top-10 session contributed one briefMe call → savings >0.
		for (const entry of result.data.perSessionLog) {
			expect(entry.savingsUsd).toBeGreaterThan(0);
		}
	});
});

// Regression test: pins the input-rate factor in the savings math (#204).
// If anyone ever swaps the factor back to outputPerMTok, this asserts the
// exact dollar arithmetic with the explicit rate values from
// `DEFAULT_PRICING` so the failure mode is loud and unambiguous: the
// expected number is the input-rate product, the would-be-bug number is
// the output-rate product, and they differ by ~5× under default Anthropic
// pricing (15 vs 75 per Mtok for claude-opus-4-7).
describe("getSavingsSummary — savings priced at input rate (#204)", () => {
	const PROJECT_RATE_PIN = "10000000-1000-4000-8000-100000000204";
	const SESSION_RATE_PIN = "savings-session-rate-pin";

	let testDb: TestDb;

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Snapshot fixture: 100_000 tokens/call savings, 3 calls.
		// Under default pricing (claude-opus-4-7 → input=15, output=75):
		//   gross @ input  = (100_000 × 15 × 3) / 1M = $4.50  ← correct
		//   gross @ output = (100_000 × 75 × 3) / 1M = $22.50 ← old bug
		await testDb.prisma.project.create({
			data: {
				id: PROJECT_RATE_PIN,
				name: "Rate pin",
				slug: "rate-pin-204",
				metadata: JSON.stringify({
					tokenBaseline: {
						measuredAt: "2026-05-01T00:00:00Z",
						naiveBootstrapTokens: 110_000,
						briefMeTokens: 10_000, // per-call savings = 100_000 tokens
					},
				}),
			},
		});

		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_RATE_PIN,
				projectId: PROJECT_RATE_PIN,
				cardId: null,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		await testDb.prisma.toolCallLog.createMany({
			data: [1, 2, 3].map(() => ({
				toolName: "briefMe",
				toolType: "essential",
				agentName: "test-agent",
				sessionId: SESSION_RATE_PIN,
				durationMs: 5,
				success: true,
				responseTokens: 0,
			})),
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("multiplies per-call savings × inputPerMTok × call count (NOT outputPerMTok)", async () => {
		const result = await tokenUsageService.getSavingsSummary(PROJECT_RATE_PIN, "lifetime");
		expect(result.success).toBe(true);
		if (!result.success) return;
		if (result.data.state !== "ready") return;

		// Pin the rate values explicitly so a future pricing-default change
		// makes this assertion fail at the *fixture* level, not silently.
		const PER_CALL_SAVINGS_TOKENS = 100_000;
		const CALL_COUNT = 3;
		const INPUT_PER_MTOK = 15; // claude-opus-4-7 default
		const OUTPUT_PER_MTOK = 75; // claude-opus-4-7 default — would-be bug

		const expectedAtInputRate = (PER_CALL_SAVINGS_TOKENS * INPUT_PER_MTOK * CALL_COUNT) / 1_000_000;
		const wouldBeBugAtOutputRate =
			(PER_CALL_SAVINGS_TOKENS * OUTPUT_PER_MTOK * CALL_COUNT) / 1_000_000;

		expect(expectedAtInputRate).toBeCloseTo(4.5, 5);
		expect(wouldBeBugAtOutputRate).toBeCloseTo(22.5, 5);

		expect(result.data.briefMeCallCount).toBe(CALL_COUNT);
		// Correct value: priced at input rate.
		expect(result.data.grossSavingsUsd).toBeCloseTo(expectedAtInputRate, 5);
		// And explicitly NOT the output-rate value — guards the regression.
		expect(result.data.grossSavingsUsd).not.toBeCloseTo(wouldBeBugAtOutputRate, 5);
	});
});
