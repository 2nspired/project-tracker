// Tests for `getCardDeliveryMetrics` (#275 — revived from #236).
//
// Per-card aggregation via direct cardId attribution (NOT session-
// expansion). Median computed across cards in `role: "done"` columns
// only. Top-N ranks by aggregated cost regardless of column.

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

	const PROJECT_ID = "80000000-8000-4000-8000-800000000275";
	const BOARD_ID = "80000000-8000-4000-8000-800000000276";
	const TODO_COL = "80000000-8000-4000-8000-800000000a75";
	const DONE_COL = "80000000-8000-4000-8000-800000000b75";
	const TODO_CARD = "80000000-8000-4000-8000-800000000a76";
	const DONE_CARD_A = "80000000-8000-4000-8000-800000000b76";
	const DONE_CARD_B = "80000000-8000-4000-8000-800000000b77";
	const DONE_CARD_C = "80000000-8000-4000-8000-800000000b78";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Delivery", slug: "delivery-275" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Board" },
		});
		await testDb.prisma.column.createMany({
			data: [
				{ id: TODO_COL, boardId: BOARD_ID, name: "Todo", position: 0, role: "todo" },
				{ id: DONE_COL, boardId: BOARD_ID, name: "Done", position: 1, role: "done" },
			],
		});
		await testDb.prisma.card.createMany({
			data: [
				{
					id: TODO_CARD,
					columnId: TODO_COL,
					projectId: PROJECT_ID,
					number: 1,
					title: "Todo card",
					position: 0,
				},
				{
					id: DONE_CARD_A,
					columnId: DONE_COL,
					projectId: PROJECT_ID,
					number: 2,
					title: "Done card A",
					position: 0,
				},
				{
					id: DONE_CARD_B,
					columnId: DONE_COL,
					projectId: PROJECT_ID,
					number: 3,
					title: "Done card B",
					position: 1,
				},
				{
					id: DONE_CARD_C,
					columnId: DONE_COL,
					projectId: PROJECT_ID,
					number: 4,
					title: "Done card C",
					position: 2,
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

	async function seedRow(opts: {
		sessionId: string;
		cardId: string | null;
		outputTokens?: number;
	}) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: PROJECT_ID,
				cardId: opts.cardId,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: opts.outputTokens ?? 1_000_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
	}

	it("returns empty metrics when no events", async () => {
		await clearRows();
		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({
			topCards: [],
			shippedCardCount: 0,
			medianShippedCardCostUsd: null,
		});
	});

	it("ignores rows with cardId=null (no session-expansion)", async () => {
		await clearRows();
		// One unattributed session — must not appear anywhere.
		await seedRow({ sessionId: "s-null", cardId: null });
		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.topCards).toEqual([]);
		expect(result.data.shippedCardCount).toBe(0);
	});

	it("aggregates per cardId across multiple sessions", async () => {
		await clearRows();
		// Card A: 3 sessions × $75 each = $225
		await seedRow({ sessionId: "s-a1", cardId: DONE_CARD_A });
		await seedRow({ sessionId: "s-a2", cardId: DONE_CARD_A });
		await seedRow({ sessionId: "s-a3", cardId: DONE_CARD_A });
		// Card B: 1 session × $75
		await seedRow({ sessionId: "s-b1", cardId: DONE_CARD_B });

		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		const cardA = result.data.topCards.find((c) => c.cardId === DONE_CARD_A);
		expect(cardA?.sessionCount).toBe(3);
		expect(cardA?.totalCostUsd).toBeCloseTo(225, 5);
		const cardB = result.data.topCards.find((c) => c.cardId === DONE_CARD_B);
		expect(cardB?.sessionCount).toBe(1);
	});

	it("computes median across shipped cards only (Todo cards excluded)", async () => {
		await clearRows();
		// 3 Done cards with costs $75, $150, $225 → median = $150
		await seedRow({ sessionId: "s-a", cardId: DONE_CARD_A, outputTokens: 1_000_000 });
		await seedRow({ sessionId: "s-b", cardId: DONE_CARD_B, outputTokens: 2_000_000 });
		await seedRow({ sessionId: "s-c", cardId: DONE_CARD_C, outputTokens: 3_000_000 });
		// 1 Todo card with very high cost — must NOT factor into the median.
		await seedRow({ sessionId: "s-todo", cardId: TODO_CARD, outputTokens: 10_000_000 });

		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.shippedCardCount).toBe(3);
		// Median of $75, $150, $225 = $150
		expect(result.data.medianShippedCardCostUsd).toBeCloseTo(150, 5);
		// Top card overall is the Todo card ($750) since topCards ignores
		// shipped status — pin this so a refactor doesn't accidentally
		// filter top-N to only shipped.
		expect(result.data.topCards[0]?.cardId).toBe(TODO_CARD);
		expect(result.data.topCards[0]?.isShipped).toBe(false);
	});

	it("returns null median when no shipped cards have attributed cost", async () => {
		await clearRows();
		await seedRow({ sessionId: "s-todo", cardId: TODO_CARD });
		const result = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.shippedCardCount).toBe(0);
		expect(result.data.medianShippedCardCostUsd).toBeNull();
		// But the Todo card still appears in topCards
		expect(result.data.topCards).toHaveLength(1);
	});

	it("clamps limit to [1, 100]", async () => {
		await clearRows();
		await seedRow({ sessionId: "s-a", cardId: DONE_CARD_A });
		await seedRow({ sessionId: "s-b", cardId: DONE_CARD_B });
		const tooSmall = await tokenUsageService.getCardDeliveryMetrics(PROJECT_ID, { limit: 0 });
		expect(tooSmall.success).toBe(true);
		if (tooSmall.success) expect(tooSmall.data.topCards.length).toBe(1);
	});
});
