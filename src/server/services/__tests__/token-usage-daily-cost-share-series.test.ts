// Tests for `getDailyCostShareSeries` (#212).
//
// Returns a 7-element number[] of (board_cost / project_cost) per UTC day.
// Same windowing as `getDailyCostSeries` so sparkline indices line up on
// the same SummaryStrip. NaN-safe — zero project bucket → 0 share, never
// `0/0`. Ratios in [0, 1] with the session-expansion quirk that lets a
// multi-board session contribute to BOTH numerator and denominator
// equally (board total can equal project total → ratio 1.0).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getDailyCostShareSeries", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000212";
	const BOARD_A = "20000000-2000-4000-8000-2000000002a2";
	const BOARD_B = "20000000-2000-4000-8000-2000000002b2";
	const COL_A = "30000000-3000-4000-8000-3000000002a2";
	const COL_B = "30000000-3000-4000-8000-3000000002b2";
	const CARD_A = "40000000-4000-4000-8000-4000000002a2";
	const CARD_B = "40000000-4000-4000-8000-4000000002b2";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Share", slug: "share" },
		});
		await testDb.prisma.board.createMany({
			data: [
				{ id: BOARD_A, projectId: PROJECT_ID, name: "Board A" },
				{ id: BOARD_B, projectId: PROJECT_ID, name: "Board B" },
			],
		});
		await testDb.prisma.column.createMany({
			data: [
				{ id: COL_A, boardId: BOARD_A, name: "Todo", position: 0 },
				{ id: COL_B, boardId: BOARD_B, name: "Todo", position: 0 },
			],
		});
		await testDb.prisma.card.createMany({
			data: [
				{
					id: CARD_A,
					columnId: COL_A,
					projectId: PROJECT_ID,
					number: 1,
					title: "Card A",
					position: 0,
				},
				{
					id: CARD_B,
					columnId: COL_B,
					projectId: PROJECT_ID,
					number: 2,
					title: "Card B",
					position: 0,
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	async function clearRows() {
		await testDb.prisma.tokenUsageEvent.deleteMany({ where: { projectId: PROJECT_ID } });
	}

	function todayUtcMidnight(): Date {
		const now = new Date();
		return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	}

	async function seedRow(opts: { sessionId: string; cardId: string; recordedAt: Date }) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: PROJECT_ID,
				cardId: opts.cardId,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: 1_000_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: opts.recordedAt,
			},
		});
	}

	it("returns a 7-element series of zeros when there are no events", async () => {
		await clearRows();
		const result = await tokenUsageService.getDailyCostShareSeries(PROJECT_ID, BOARD_A);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.dailyShare).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});

	it("returns 0 (not NaN) when project bucket is 0 on a given day", async () => {
		// Pins the NaN-safe guard. With no events, every day's denominator
		// is 0 — must produce 0, not NaN. Important: a NaN here would crash
		// the sparkline path.length calc downstream.
		await clearRows();
		const result = await tokenUsageService.getDailyCostShareSeries(PROJECT_ID, BOARD_A);
		expect(result.success).toBe(true);
		if (!result.success) return;
		for (const v of result.data.dailyShare) {
			expect(Number.isFinite(v)).toBe(true);
			expect(v).toBe(0);
		}
	});

	it("attributes 100% share to the only board with events on a given day", async () => {
		await clearRows();
		const today = todayUtcMidnight();
		// Single event on board A, today. Board B has nothing. Project total
		// for today = board A total → share is exactly 1.0 for index 6.
		await seedRow({ sessionId: "s-only-a", cardId: CARD_A, recordedAt: today });

		const result = await tokenUsageService.getDailyCostShareSeries(PROJECT_ID, BOARD_A);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.dailyShare[6]).toBe(1);
		// Earlier days untouched.
		for (let i = 0; i < 6; i++) {
			expect(result.data.dailyShare[i]).toBe(0);
		}
	});

	it("computes a fractional share when both boards have events on the same day", async () => {
		await clearRows();
		const today = todayUtcMidnight();
		// One event on each board, identical token counts → equal cost.
		// Project total = boardA + boardB → board A's share is 0.5.
		await seedRow({ sessionId: "s-a-only", cardId: CARD_A, recordedAt: today });
		await seedRow({ sessionId: "s-b-only", cardId: CARD_B, recordedAt: today });

		const result = await tokenUsageService.getDailyCostShareSeries(PROJECT_ID, BOARD_A);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.dailyShare[6]).toBeCloseTo(0.5, 6);
		expect(result.data.dailyShare[6]).toBeGreaterThanOrEqual(0);
		expect(result.data.dailyShare[6]).toBeLessThanOrEqual(1);
	});
});
