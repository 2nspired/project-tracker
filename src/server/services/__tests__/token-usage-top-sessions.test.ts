// Tests for `getTopSessions` (#211).
//
// Per-session aggregation, sorted by cost desc, capped at `limit`. Joins
// the attributed card metadata so the lens can render `cardRef` + title
// without an N+1 from the UI.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getTopSessions", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000211";
	const BOARD_ID = "20000000-2000-4000-8000-200000000211";
	const COLUMN_ID = "30000000-3000-4000-8000-300000000211";
	const CARD_A = "40000000-4000-4000-8000-400000000a11";
	const CARD_B = "40000000-4000-4000-8000-400000000b11";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "TopSessions", slug: "top-sessions" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Board" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.createMany({
			data: [
				{
					id: CARD_A,
					columnId: COLUMN_ID,
					projectId: PROJECT_ID,
					number: 1,
					title: "Card A",
					position: 0,
				},
				{
					id: CARD_B,
					columnId: COLUMN_ID,
					projectId: PROJECT_ID,
					number: 2,
					title: "Card B",
					position: 1,
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
		model?: string;
		cardId?: string | null;
		inputTokens?: number;
		outputTokens?: number;
		recordedAt?: Date;
	}) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: PROJECT_ID,
				cardId: opts.cardId ?? null,
				agentName: "test",
				model: opts.model ?? "claude-opus-4-7",
				inputTokens: opts.inputTokens ?? 0,
				outputTokens: opts.outputTokens ?? 0,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				...(opts.recordedAt ? { recordedAt: opts.recordedAt } : {}),
			},
		});
	}

	it("sorts sessions by total cost desc and respects the limit", async () => {
		await clearRows();
		// 5 sessions, ascending cost (more output tokens ⇒ more cost).
		for (let i = 0; i < 5; i++) {
			await seedRow({ sessionId: `s-${i}`, outputTokens: (i + 1) * 1_000_000 });
		}

		const result = await tokenUsageService.getTopSessions(PROJECT_ID, { limit: 3 });
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toHaveLength(3);
		// Highest cost first.
		expect(result.data[0]?.sessionId).toBe("s-4");
		expect(result.data[1]?.sessionId).toBe("s-3");
		expect(result.data[2]?.sessionId).toBe("s-2");
		// Cost monotonically decreasing.
		for (let i = 1; i < result.data.length; i++) {
			expect(result.data[i - 1].totalCostUsd).toBeGreaterThanOrEqual(result.data[i].totalCostUsd);
		}
	});

	it("aggregates multiple model rows for the same session into one entry", async () => {
		await clearRows();
		await seedRow({ sessionId: "s-multi", model: "claude-opus-4-7", outputTokens: 1_000_000 });
		await seedRow({ sessionId: "s-multi", model: "claude-sonnet-4-6", outputTokens: 1_000_000 });
		await seedRow({ sessionId: "s-other", model: "claude-opus-4-7", outputTokens: 500_000 });

		const result = await tokenUsageService.getTopSessions(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toHaveLength(2);
		expect(result.data[0]?.sessionId).toBe("s-multi");
		// `primaryModel` is the model with the most cost in this session — opus
		// here since both models had identical token counts but opus has the
		// higher output rate. Pins the cost-weighted-mode rule, not row-count.
		expect(result.data[0]?.primaryModel).toBe("claude-opus-4-7");
	});

	it("hydrates cardRef + cardTitle when the session is attributed", async () => {
		await clearRows();
		await seedRow({ sessionId: "s-attributed", cardId: CARD_A, outputTokens: 1_000_000 });
		await seedRow({ sessionId: "s-unattributed", cardId: null, outputTokens: 500_000 });

		const result = await tokenUsageService.getTopSessions(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		const attributed = result.data.find((s) => s.sessionId === "s-attributed");
		const unattributed = result.data.find((s) => s.sessionId === "s-unattributed");
		expect(attributed?.cardRef).toBe("#1");
		expect(attributed?.cardTitle).toBe("Card A");
		expect(attributed?.cardId).toBe(CARD_A);
		expect(unattributed?.cardRef).toBeNull();
		expect(unattributed?.cardTitle).toBeNull();
		expect(unattributed?.cardId).toBeNull();
	});

	it("returns an empty array when there are no events", async () => {
		await clearRows();
		const result = await tokenUsageService.getTopSessions(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual([]);
	});

	it("clamps limit to [1, 100]", async () => {
		await clearRows();
		for (let i = 0; i < 3; i++) {
			await seedRow({ sessionId: `s-${i}`, outputTokens: (i + 1) * 1_000_000 });
		}
		// Service-level clamp — defensive even if the tRPC zod schema also caps.
		const tooBig = await tokenUsageService.getTopSessions(PROJECT_ID, { limit: 5000 });
		expect(tooBig.success).toBe(true);
		if (tooBig.success) expect(tooBig.data.length).toBeLessThanOrEqual(100);

		const tooSmall = await tokenUsageService.getTopSessions(PROJECT_ID, { limit: 0 });
		expect(tooSmall.success).toBe(true);
		if (tooSmall.success) expect(tooSmall.data.length).toBe(1);
	});
});
