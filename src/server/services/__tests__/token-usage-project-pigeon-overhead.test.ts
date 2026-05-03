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
		const projectId = opts.projectId ?? PROJECT_ID;
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId,
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
					projectId,
					durationMs: 5,
					success: true,
					responseTokens: opts.responseTokens ?? 1_000_000,
				},
			});
		}
	}

	// Helper: seed `tool_call_log` rows directly with `projectId` set but
	// NO corresponding `token_usage_event`. Models the #277 regression:
	// the Stop hook didn't fire (or resolved no project) so no
	// TokenUsageEvent ever landed, but the MCP server still stamped
	// `projectId` on every `tool_call_log` row at write time.
	async function seedToolCallsOnly(opts: {
		sessionId: string;
		projectId?: string;
		responseTokens?: number;
		callCount?: number;
	}) {
		const callCount = opts.callCount ?? 1;
		for (let i = 0; i < callCount; i++) {
			await testDb.prisma.toolCallLog.create({
				data: {
					toolName: "test-tool",
					toolType: "extended",
					agentName: "test",
					sessionId: opts.sessionId,
					projectId: opts.projectId ?? PROJECT_ID,
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

	// #277 regression: pre-fix `getProjectPigeonOverhead` discovered
	// project-scoped sessions by querying `token_usage_event WHERE
	// projectId = ?` first, then filtering `tool_call_log` by the
	// resulting sessionIds. When the Stop hook didn't fire (or
	// `resolveProjectIdFromCwd` returned null for that hook payload),
	// step 1 returned [] and `<PigeonOverheadSection>` self-suppressed
	// to $0/0 calls — silently hiding real MCP overhead. The fix stamps
	// `tool_call_log.projectId` directly at write time so the bridge
	// isn't needed for in-scope discovery. Pin: tool_call_log rows
	// without a matching TokenUsageEvent must still count.
	it("counts tool_call_log rows even when no token_usage_event exists for the session (#277)", async () => {
		await clearRows();
		// Two ghost sessions: 5 logs each, 1M output tokens, no
		// TokenUsageEvent. Pre-fix the bridge query returned [] and the
		// section silently rendered $0/0 calls. Post-fix the rows are
		// discovered directly via `tool_call_log.projectId` and surface
		// as 10 calls. Cost falls back to `__default__` (zero by design
		// — see `token-pricing-defaults.ts`: "honest fallback rather
		// than a wrong guess"); the user gets the count immediately,
		// the cost lights up once a TokenUsageEvent for the session
		// lands.
		await seedToolCallsOnly({ sessionId: "ghost-a", callCount: 5 });
		await seedToolCallsOnly({ sessionId: "ghost-b", callCount: 5 });

		const result = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.callCount).toBe(10);
	});

	it("prices ghost-session rows at the in-project model rate when AppSettings carries a default", async () => {
		// Mixed scenario: one session has a TokenUsageEvent (so its
		// model is known), another session has only tool_call_log rows
		// (ghost). Both contribute to callCount. The known-model
		// session prices at its model's outputPerMTok, the ghost
		// session prices at __default__ (zero by design). Pin: the
		// known-model side should still produce its full cost — the
		// ghost rows shouldn't poison pricing for the rest.
		await clearRows();
		await seedSession({ sessionId: "known", responseTokens: 1_000_000 });
		await seedToolCallsOnly({ sessionId: "ghost", callCount: 3 });

		const result = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		// 1 (known) + 3 (ghost) = 4 calls.
		expect(result.data.callCount).toBe(4);
		// Known session contributes 1M × $75/M = $75. Ghost rows
		// contribute $0 (default pricing).
		expect(result.data.totalCostUsd).toBeCloseTo(75, 5);
	});

	it("excludes tool_call_log rows whose projectId is null (orphan logs)", async () => {
		await clearRows();
		// In-scope, attributed row.
		await seedToolCallsOnly({ sessionId: "in-scope", callCount: 3 });
		// Orphan row: projectId is null (e.g. logs from before #277 that
		// the backfill couldn't recover, or MCP calls from a cwd outside
		// any registered repo). Must not leak in.
		await testDb.prisma.toolCallLog.create({
			data: {
				toolName: "orphan",
				toolType: "extended",
				agentName: "test",
				sessionId: "orphan-sess",
				projectId: null,
				durationMs: 5,
				success: true,
				responseTokens: 1_000_000,
			},
		});

		const result = await tokenUsageService.getProjectPigeonOverhead(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.callCount).toBe(3);
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
