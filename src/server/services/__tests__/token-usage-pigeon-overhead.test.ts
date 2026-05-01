// Locks down the per-tool aggregation + pricing arithmetic of the
// Pigeon-overhead lens (#194). Uses the established DB-backed fixture
// (`test-db.ts`, F1 #190) so the period-window + session-expansion +
// per-session model resolution all run against real Prisma queries —
// not a mock — which is the layer most likely to drift if someone
// changes the underlying TokenUsageEvent / ToolCallLog shape.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

const PROJECT_ID = "10000000-1000-4000-8000-100000000094";
const BOARD_ID = "20000000-2000-4000-8000-200000000094";
const COLUMN_ID = "30000000-3000-4000-8000-300000000094";
const CARD_X = "40000000-4000-4000-8000-400000000094";
const CARD_Y = "40000000-4000-4000-8000-400000000095";

const SESSION_RECENT = "session-recent";
const SESSION_OLD = "session-old";
const SESSION_OTHER = "session-other-project";

describe("getPigeonOverhead", () => {
	let testDb: TestDb;

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Project + board + column + card scaffolding so FKs resolve.
		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Test", slug: "test-194" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Test board" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_X,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 1,
				title: "Card X",
				position: 0,
			},
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_Y,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 2,
				title: "Card Y",
				position: 1,
			},
		});

		const now = Date.now();
		const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);

		// Recent session: model = claude-opus-4-7 (output rate $75/M).
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_RECENT,
				projectId: PROJECT_ID,
				cardId: CARD_X,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// Old session: model = claude-sonnet-4-6 (output rate $15/M),
		// recordedAt back-dated to 8 days ago — outside the 7d window,
		// inside the 30d window and lifetime.
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_OLD,
				projectId: PROJECT_ID,
				cardId: CARD_Y,
				agentName: "test-agent",
				model: "claude-sonnet-4-6",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: eightDaysAgo,
			},
		});

		// Different project — must NOT bleed into this project's overhead.
		const OTHER_PROJECT = "10000000-1000-4000-8000-100000000099";
		await testDb.prisma.project.create({
			data: { id: OTHER_PROJECT, name: "Other", slug: "other-194" },
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_OTHER,
				projectId: OTHER_PROJECT,
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

		// ToolCallLog rows — each session gets a couple of calls. The
		// SESSION_OTHER call is the negative control; it must not
		// contribute to PROJECT_ID's totals.
		await testDb.prisma.toolCallLog.createMany({
			data: [
				// SESSION_RECENT — opus pricing
				{
					toolName: "getCardContext",
					toolType: "extended",
					agentName: "test-agent",
					sessionId: SESSION_RECENT,
					durationMs: 5,
					success: true,
					responseTokens: 1_000_000, // $75 of overhead
				},
				{
					toolName: "getCardContext",
					toolType: "extended",
					agentName: "test-agent",
					sessionId: SESSION_RECENT,
					durationMs: 5,
					success: true,
					responseTokens: 0, // adds nothing, still counts as a call
				},
				{
					toolName: "saveHandoff",
					toolType: "essential",
					agentName: "test-agent",
					sessionId: SESSION_RECENT,
					durationMs: 5,
					success: true,
					responseTokens: 500_000, // $37.50
				},
				// SESSION_OLD — sonnet pricing (output rate 15/M)
				{
					toolName: "getCardContext",
					toolType: "extended",
					agentName: "test-agent",
					sessionId: SESSION_OLD,
					durationMs: 5,
					success: true,
					responseTokens: 1_000_000, // $15 of overhead at sonnet rate
				},
				// SESSION_OTHER — must be excluded from PROJECT_ID totals
				{
					toolName: "getCardContext",
					toolType: "extended",
					agentName: "test-agent",
					sessionId: SESSION_OTHER,
					durationMs: 5,
					success: true,
					responseTokens: 1_000_000,
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("7d window: only sessions whose token events landed in the window contribute", async () => {
		const result = await tokenUsageService.getPigeonOverhead(PROJECT_ID, "7d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// SESSION_RECENT contributes (opus rates):
		//   getCardContext: 1M+0 → $75 + $0 = $75, 2 calls
		//   saveHandoff:    500k → $37.50, 1 call
		// SESSION_OLD is older than 7d → excluded.
		expect(result.data.sessionCount).toBe(1);
		expect(result.data.totalCostUsd).toBeCloseTo(75 + 37.5, 5);
		expect(result.data.totalResponseTokens).toBe(1_500_000);

		const byTool = new Map(result.data.byTool.map((t) => [t.toolName, t]));
		expect(byTool.get("getCardContext")?.callCount).toBe(2);
		expect(byTool.get("getCardContext")?.totalCostUsd).toBeCloseTo(75, 5);
		expect(byTool.get("getCardContext")?.avgResponseTokens).toBe(500_000); // (1M+0)/2
		expect(byTool.get("saveHandoff")?.callCount).toBe(1);
		expect(byTool.get("saveHandoff")?.totalCostUsd).toBeCloseTo(37.5, 5);
	});

	it("30d window: pulls in the older session at its model's rate", async () => {
		const result = await tokenUsageService.getPigeonOverhead(PROJECT_ID, "30d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Both sessions contribute. SESSION_OLD adds $15 (sonnet output rate).
		expect(result.data.sessionCount).toBe(2);
		expect(result.data.totalCostUsd).toBeCloseTo(75 + 37.5 + 15, 5);
		// byTool sorts by totalCostUsd desc — getCardContext should be first:
		// (75 + 15) = 90 vs saveHandoff 37.50.
		expect(result.data.byTool[0]?.toolName).toBe("getCardContext");
		expect(result.data.byTool[0]?.callCount).toBe(3);
	});

	it("lifetime: all-time sessions, no period cutoff", async () => {
		const result = await tokenUsageService.getPigeonOverhead(PROJECT_ID, "lifetime");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Same set as 30d here (both events are within 30d), but the
		// branch coverage matters: no recordedAt filter means we don't
		// accidentally drop ancient rows when the column is added later.
		expect(result.data.sessionCount).toBe(2);
		expect(result.data.totalCostUsd).toBeCloseTo(75 + 37.5 + 15, 5);
	});

	it("does not bleed in tool calls from other projects", async () => {
		const result = await tokenUsageService.getPigeonOverhead(PROJECT_ID, "lifetime");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// SESSION_OTHER contributed 1M response tokens at opus rate ($75).
		// If it leaked, totalCostUsd would be $75 higher and sessionCount = 3.
		expect(result.data.sessionCount).toBe(2);
	});

	it("returns empty totals (not an error) for a project with no token events", async () => {
		const EMPTY_PROJECT = "10000000-1000-4000-8000-100000000098";
		await testDb.prisma.project.create({
			data: { id: EMPTY_PROJECT, name: "Empty", slug: "empty-194" },
		});
		const result = await tokenUsageService.getPigeonOverhead(EMPTY_PROJECT, "7d");
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.sessionCount).toBe(0);
		expect(result.data.totalCostUsd).toBe(0);
		expect(result.data.totalResponseTokens).toBe(0);
		expect(result.data.byTool).toEqual([]);
	});
});

describe("getSessionPigeonOverhead", () => {
	let testDb: TestDb;
	const SESSION = "ovh-session-1";
	const SESSION_EMPTY = "ovh-session-empty";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		const PROJ = "60000000-6000-4000-8000-600000000001";
		await testDb.prisma.project.create({
			data: { id: PROJ, name: "P", slug: "p-194-session" },
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION,
				projectId: PROJ,
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
			data: [
				{
					toolName: "getCardContext",
					toolType: "extended",
					agentName: "test-agent",
					sessionId: SESSION,
					durationMs: 5,
					success: true,
					responseTokens: 1_000_000,
				},
				{
					toolName: "saveHandoff",
					toolType: "essential",
					agentName: "test-agent",
					sessionId: SESSION,
					durationMs: 5,
					success: true,
					responseTokens: 100_000,
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("returns the per-session cost using the session's model rate", async () => {
		const result = await tokenUsageService.getSessionPigeonOverhead(SESSION);
		expect(result.success).toBe(true);
		if (!result.success) return;
		// 1.1M response tokens × $75/M output = $82.50
		expect(result.data.callCount).toBe(2);
		expect(result.data.totalCostUsd).toBeCloseTo(82.5, 5);
	});

	it("returns 0/0 (not an error) for a session with no ToolCallLog rows", async () => {
		const result = await tokenUsageService.getSessionPigeonOverhead(SESSION_EMPTY);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.callCount).toBe(0);
		expect(result.data.totalCostUsd).toBe(0);
	});
});
