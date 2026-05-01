// Locks down `tokenUsageService.getCardDeliveryMetrics` (#196 U4):
//   - Happy path: shipped + priced cards yield correct shippedCount, avg,
//     total, and top-5 sort by cost desc.
//   - Zero shipped: returns shippedCount=0 / avg=0 / top5=[].
//   - Shipped-but-all-$0: shippedCount > 0, totalCostUsd=0, top5=[]; UI uses
//     this to render the "No AI cost recorded" partial state.
//   - Lifetime: previousPeriodAvgCostUsd is null (no prior window).
//   - Period comparison math: avg vs. immediately preceding window of the
//     same length.
//
// Uses the project-wide `createTestDb` fixture established in #190 (per-suite
// temp SQLite, schema applied via `prisma migrate diff`). `db` is mocked the
// same way the existing `getCardSummary` suite handles it — service module
// reads from the singleton, the mock returns a hoisted ref the fixture
// populates in `beforeAll`.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getCardDeliveryMetrics", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000010";
	const BOARD_ID = "20000000-2000-4000-8000-200000000010";
	const COLUMN_ID = "30000000-3000-4000-8000-300000000010";
	const CARD_HIGH = "40000000-4000-4000-8000-400000000010"; // shipped, expensive
	const CARD_LOW = "40000000-4000-4000-8000-400000000011"; // shipped, cheap
	const CARD_FREE = "40000000-4000-4000-8000-400000000012"; // shipped, $0
	const CARD_OPEN = "40000000-4000-4000-8000-400000000013"; // not shipped (no completedAt)
	const CARD_OLD = "40000000-4000-4000-8000-400000000014"; // shipped 45d ago — only in lifetime

	const SESSION_HIGH = "session-high";
	const SESSION_LOW = "session-low";
	const SESSION_OLD = "session-old";

	const NOW = new Date("2026-04-30T12:00:00Z");

	function daysAgo(d: number): Date {
		return new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
	}

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Pin "now" so day-window math is deterministic. The service computes
		// its own `now`, but our seed timestamps are absolute — picking
		// fixed dates avoids race-on-midnight flakes.
		vi.useFakeTimers();
		vi.setSystemTime(NOW);

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Test", slug: "test" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Test board" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Done", role: "done", position: 0 },
		});

		// CARD_HIGH: shipped 5 days ago, expensive (3M output × $75/M = $225)
		await testDb.prisma.card.create({
			data: {
				id: CARD_HIGH,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 1,
				title: "High-cost card",
				position: 0,
				completedAt: daysAgo(5),
			},
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_HIGH,
				projectId: PROJECT_ID,
				cardId: CARD_HIGH,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: 3_000_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// CARD_LOW: shipped 10 days ago, cheap (1M input × $15/M = $15)
		await testDb.prisma.card.create({
			data: {
				id: CARD_LOW,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 2,
				title: "Low-cost card",
				position: 1,
				completedAt: daysAgo(10),
			},
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_LOW,
				projectId: PROJECT_ID,
				cardId: CARD_LOW,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 1_000_000,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// CARD_FREE: shipped 8 days ago, no token events at all → $0.
		await testDb.prisma.card.create({
			data: {
				id: CARD_FREE,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 3,
				title: "Free card",
				position: 2,
				completedAt: daysAgo(8),
			},
		});

		// CARD_OPEN: not shipped (completedAt null). Should never appear.
		await testDb.prisma.card.create({
			data: {
				id: CARD_OPEN,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 4,
				title: "Open card",
				position: 3,
				completedAt: null,
			},
		});

		// CARD_OLD: shipped 45 days ago, expensive — only visible in
		// "lifetime" + the 30-60d-ago "previous period" window.
		await testDb.prisma.card.create({
			data: {
				id: CARD_OLD,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 5,
				title: "Old shipped card",
				position: 4,
				completedAt: daysAgo(45),
			},
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_OLD,
				projectId: PROJECT_ID,
				cardId: CARD_OLD,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 2_000_000, // 2M × $15/M = $30
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		vi.useRealTimers();
		await testDb.cleanup();
	});

	it("happy path: 30d window picks up HIGH + LOW + FREE; avg excludes $0; top-5 sorted desc", async () => {
		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;

		// All three "shipped within 30d" cards counted, including the $0 one.
		expect(result.data.shippedCount).toBe(3);
		// Total cost = HIGH ($225) + LOW ($15) = $240. FREE excluded.
		expect(result.data.totalCostUsd).toBeCloseTo(240, 4);
		// Avg over the 2 PRICED cards = $120 (FREE excluded from denominator).
		expect(result.data.avgCostUsd).toBeCloseTo(120, 4);

		// Top-5 sorted by cost desc; FREE excluded entirely.
		expect(result.data.top5.map((c) => c.cardNumber)).toEqual([1, 2]);
		expect(result.data.top5[0].totalCostUsd).toBeCloseTo(225, 4);
		expect(result.data.top5[1].totalCostUsd).toBeCloseTo(15, 4);

		// Period bookkeeping.
		expect(result.data.periodLabel).toBe("30d");
		expect(result.data.periodStartDate).not.toBeNull();
	});

	it("zero shipped (window with no completedAt cards): shippedCount=0, avg=0, top5 empty", async () => {
		// Use a side project with no shipped cards so we exercise the empty path
		// without poisoning the main fixture's history.
		const EMPTY_PROJECT = "10000000-1000-4000-8000-100000000099";
		await testDb.prisma.project.create({
			data: { id: EMPTY_PROJECT, name: "Empty", slug: "empty" },
		});
		const result = await tokenUsageService.getCardDeliveryMetrics(EMPTY_PROJECT, "7d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.shippedCount).toBe(0);
		expect(result.data.avgCostUsd).toBe(0);
		expect(result.data.totalCostUsd).toBe(0);
		expect(result.data.top5).toEqual([]);
	});

	it("shipped-but-all-$0: shippedCount > 0, totalCostUsd=0, top5 empty (partial-state surface)", async () => {
		// 7d window catches only CARD_HIGH (5d ago) which IS priced. Build a
		// dedicated zero-cost project to isolate the all-$0 case.
		const ZERO_PROJECT = "10000000-1000-4000-8000-100000000098";
		const ZERO_BOARD = "20000000-2000-4000-8000-200000000098";
		const ZERO_COLUMN = "30000000-3000-4000-8000-300000000098";
		const ZERO_CARD = "40000000-4000-4000-8000-400000000098";
		await testDb.prisma.project.create({
			data: { id: ZERO_PROJECT, name: "ZeroCost", slug: "zerocost" },
		});
		await testDb.prisma.board.create({
			data: { id: ZERO_BOARD, projectId: ZERO_PROJECT, name: "Board" },
		});
		await testDb.prisma.column.create({
			data: { id: ZERO_COLUMN, boardId: ZERO_BOARD, name: "Done", role: "done", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: ZERO_CARD,
				columnId: ZERO_COLUMN,
				projectId: ZERO_PROJECT,
				number: 1,
				title: "Shipped no AI",
				position: 0,
				completedAt: daysAgo(2),
			},
		});

		const result = await tokenUsageService.getCardDeliveryMetrics(ZERO_PROJECT, "7d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.shippedCount).toBe(1);
		expect(result.data.totalCostUsd).toBe(0);
		expect(result.data.avgCostUsd).toBe(0);
		expect(result.data.top5).toEqual([]);
	});

	it("lifetime: previousPeriodAvgCostUsd is null (no 'previous lifetime' window)", async () => {
		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID, "lifetime");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// All shipped cards counted (HIGH, LOW, FREE, OLD = 4).
		expect(result.data.shippedCount).toBe(4);
		expect(result.data.previousPeriodAvgCostUsd).toBeNull();
		expect(result.data.periodStartDate).toBeNull();
	});

	it("30d period comparison: previous-period avg pulls from 30-60d ago window", async () => {
		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Previous window (30-60d ago) contains only CARD_OLD ($30).
		// Avg over 1 priced card = $30.
		expect(result.data.previousPeriodAvgCostUsd).toBeCloseTo(30, 4);
	});

	it("7d period comparison: previous-period (7-14d ago) includes LOW; current avg = HIGH only", async () => {
		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID, "7d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Current 7d window: HIGH (5d ago) only — FREE (8d ago) and LOW (10d
		// ago) are outside. shippedCount counts shipped-in-window cards.
		expect(result.data.shippedCount).toBe(1);
		expect(result.data.avgCostUsd).toBeCloseTo(225, 4);
		// Previous 7-14d window: LOW (10d) priced + FREE (8d) zero-cost
		// (excluded from avg). Avg over 1 priced card = $15.
		expect(result.data.previousPeriodAvgCostUsd).toBeCloseTo(15, 4);
	});
});
