// Tests for `getProjectPigeonOverhead` (#274 — revived from #236).
//
// Project-wide aggregation of `ToolCallLog.responseTokens` priced at
// each session's primary-model output rate. Session-expansion semantics
// match `getProjectSummary` when `boardId` is set. Two scoping rules
// must hold:
//   1. Sessions outside the project don't leak in (sessionId collisions
//      across projects can't pull pricing from the wrong project).
//   2. With `boardId`, only sessions touching cards on that board count
//      (or the session-expansion siblings).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getProjectPigeonOverhead", () => {
	let testDb: TestDb;

	const PROJECT_ID = "60000000-6000-4000-8000-600000000274";
	const OTHER_PROJECT_ID = "60000000-6000-4000-8000-600000000275";
	const BOARD_ID = "60000000-6000-4000-8000-600000000277";
	const COL_ID = "60000000-6000-4000-8000-600000000278";
	const CARD_ID = "60000000-6000-4000-8000-600000000279";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.createMany({
			data: [
				{ id: PROJECT_ID, name: "Overhead", slug: "ovh-274" },
				{ id: OTHER_PROJECT_ID, name: "Other", slug: "ovh-274-other" },
			],
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Board" },
		});
		await testDb.prisma.column.create({
			data: { id: COL_ID, boardId: BOARD_ID, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_ID,
				columnId: COL_ID,
				projectId: PROJECT_ID,
				number: 1,
				title: "Card",
				position: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	async function clearRows() {
		await testDb.prisma.tokenUsageEvent.deleteMany({});
		await testDb.prisma.toolCallLog.deleteMany({});
	}

	async function seedSession(opts: {
		sessionId: string;
		projectId?: string;
		cardId?: string | null;
		model?: string;
		responseTokens?: number;
		callCount?: number;
	}) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: opts.projectId ?? PROJECT_ID,
				cardId: opts.cardId ?? null,
				agentName: "test",
				model: opts.model ?? "claude-opus-4-7",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
		const callCount = opts.callCount ?? 1;
		for (let i = 0; i < callCount; i++) {
			await testDb.prisma.toolCallLog.create({
				data: {
					toolName: "test-tool",
					toolType: "extended",
					agentName: "test",
					sessionId: opts.sessionId,
					durationMs: 5,
					success: true,
					responseTokens: opts.responseTokens ?? 1_000_000,
				},
			});
		}
	}

	it("returns 0/0 (not an error) when the project has no events", async () => {
		await clearRows();
		const result = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({ totalCostUsd: 0, callCount: 0 });
	});

	it("aggregates across all sessions in the project, priced per-session by model", async () => {
		await clearRows();
		// Two sessions, both opus. 1M response tokens each → 2M × $75/M = $150.
		await seedSession({ sessionId: "s-a", responseTokens: 1_000_000 });
		await seedSession({ sessionId: "s-b", responseTokens: 1_000_000 });

		const result = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.callCount).toBe(2);
		expect(result.data.totalCostUsd).toBeCloseTo(150, 5);
	});

	it("ignores sessions from other projects (cross-project isolation)", async () => {
		await clearRows();
		// Pin: a sessionId can collide across projects (deliberate or not).
		// Without project-scoping at the model lookup, the OTHER project's
		// rows could pull pricing from THIS project's settings — and worse,
		// could be SUMMED into this project's overhead. Both must be
		// scrubbed.
		await seedSession({ sessionId: "s-this", projectId: PROJECT_ID });
		await seedSession({ sessionId: "s-other", projectId: OTHER_PROJECT_ID });

		const result = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Only the in-project session is counted. The other-project session's
		// ToolCallLog rows are excluded by the sessionIds filter (since its
		// sessionId is not in the in-project session set).
		expect(result.data.callCount).toBe(1);
	});

	it("scopes to a board when boardId is provided (session-expansion rule)", async () => {
		await clearRows();
		// Session-on-board: attributed to a card on this board.
		await seedSession({ sessionId: "s-on-board", cardId: CARD_ID });
		// Session-not-on-board: in the same project but unattributed (cardId=null).
		await seedSession({ sessionId: "s-off-board", cardId: null });

		const projectResult = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;
		expect(projectResult.data.callCount).toBe(2); // both sessions in project scope

		const boardResult = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID, {
			boardId: BOARD_ID,
		});
		expect(boardResult.success).toBe(true);
		if (!boardResult.success) return;
		// Only the session that touched a card on the board counts.
		expect(boardResult.data.callCount).toBe(1);
	});
});
