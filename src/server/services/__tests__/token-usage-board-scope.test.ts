// Locks down `tokenUsageService` board-scoping (#200 Phase 1a).
//
// Phase 1a is backend-only: `getProjectSummary` and `getDailyCostSeries`
// gain an optional `boardId` argument that routes through a new private
// helper, `resolveBoardScopeWhere`. The helper centralizes the join so the
// shape can't drift between callsites — every cost query that gains board
// scope in later phases will also funnel through it.
//
// What this suite pins:
//   1. `resolveBoardScopeWhere` — direct shape test (undefined → project-
//      only; boardId set → projectId pinned + OR cardId/sessionId).
//   2. `getProjectSummary(projectId)` (no boardId) is unchanged from the
//      pre-#200 behavior, so existing project-scope callsites can't drift.
//   3. `getProjectSummary(projectId, boardId)` returns only that board's
//      attributed events.
//   4. Cross-project isolation: a colliding sessionId in another project
//      must NOT leak into this board's totals. This is the bug class the
//      helper exists to prevent (`projectId` is pinned at every layer).
//   5. Multi-board session contributes to BOTH boards — the "Cost
//      inequality" acceptance from #200's plan: `boardA + boardB >
//      project` is *expected*, not a bug, because session-expansion lets
//      a session that touched cards on both boards fully count toward
//      each board's total.
//   6. `getDailyCostSeries(projectId, boardId)` — single boundary check
//      that bucket counts shift correctly when the scope narrows from
//      project to board.
//
// Fixture pattern matches the existing token-usage suites: per-suite temp
// SQLite via `createTestDb`; `db` mocked via a hoisted ref.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService, __testing__ } = await import("@/server/services/token-usage-service");
const { resolveBoardScopeWhere } = __testing__;

// ─── 1. resolveBoardScopeWhere — direct shape test ────────────────────

describe("resolveBoardScopeWhere — shape", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000300";
	const BOARD_ID = "20000000-2000-4000-8000-200000000300";
	const COLUMN_ID = "30000000-3000-4000-8000-300000000300";
	const CARD_ID = "40000000-4000-4000-8000-400000000300";
	const SESSION_ID = "scope-shape-session";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Shape", slug: "shape" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Board" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_ID,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 1,
				title: "Card",
				position: 0,
			},
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_ID,
				projectId: PROJECT_ID,
				cardId: CARD_ID,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("returns just `{ projectId }` when boardId is undefined", async () => {
		const where = await resolveBoardScopeWhere(PROJECT_ID, undefined);
		expect(where).toEqual({ projectId: PROJECT_ID });
	});

	it("returns OR shape with projectId pinned when boardId is set", async () => {
		const where = await resolveBoardScopeWhere(PROJECT_ID, BOARD_ID);
		expect(where.projectId).toBe(PROJECT_ID);
		expect(Array.isArray(where.OR)).toBe(true);
		// One branch resolves direct attribution: cardId in [...].
		const cardBranch = (where.OR as Array<Record<string, unknown>>).find(
			(branch) => "cardId" in branch
		);
		expect(cardBranch).toBeDefined();
		// The session branch is present because we seeded one direct-attribution
		// event above; without that, session-expansion would be a no-op and the
		// branch is omitted.
		const sessionBranch = (where.OR as Array<Record<string, unknown>>).find(
			(branch) => "sessionId" in branch
		);
		expect(sessionBranch).toBeDefined();
	});
});

// ─── 2 + 3 + 5. getProjectSummary scope behavior ──────────────────────

describe("getProjectSummary — board scope", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000301";
	const BOARD_A = "20000000-2000-4000-8000-2000000003a1";
	const BOARD_B = "20000000-2000-4000-8000-2000000003b1";
	const COLUMN_A = "30000000-3000-4000-8000-3000000003a1";
	const COLUMN_B = "30000000-3000-4000-8000-3000000003b1";
	const CARD_A = "40000000-4000-4000-8000-4000000003a1";
	const CARD_B = "40000000-4000-4000-8000-4000000003b1";

	// claude-opus-4-7 default rates: input $15/M, output $75/M.
	// Board-A session: 1M input + 1M output → $15 + $75 = $90.
	// Board-B session: 0.5M input + 0.5M output → $7.5 + $37.5 = $45.
	// Cross-board session (touches both A and B): 0.1M output only → $7.5.
	const SESSION_A_ONLY = "session-a-only-301";
	const SESSION_B_ONLY = "session-b-only-301";
	const SESSION_BOTH = "session-both-301";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Multi-board", slug: "multi-board" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_A, projectId: PROJECT_ID, name: "Board A" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_B, projectId: PROJECT_ID, name: "Board B" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_A, boardId: BOARD_A, name: "Todo", position: 0 },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_B, boardId: BOARD_B, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_A,
				columnId: COLUMN_A,
				projectId: PROJECT_ID,
				number: 1,
				title: "Card A",
				position: 0,
			},
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_B,
				columnId: COLUMN_B,
				projectId: PROJECT_ID,
				number: 2,
				title: "Card B",
				position: 0,
			},
		});

		// Session A — direct attribution to Card A.
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_A_ONLY,
				projectId: PROJECT_ID,
				cardId: CARD_A,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// Session B — direct attribution to Card B.
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_B_ONLY,
				projectId: PROJECT_ID,
				cardId: CARD_B,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 500_000,
				outputTokens: 500_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// Multi-board session: one event attributed to Card A, one to Card B,
		// plus a third row with cardId=null sharing the session — that null row
		// should pull into BOTH boards via session-expansion.
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_BOTH,
				projectId: PROJECT_ID,
				cardId: CARD_A,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: 100_000, // 0.1M × $75 = $7.5
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SESSION_BOTH,
				projectId: PROJECT_ID,
				cardId: CARD_B,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: 100_000, // 0.1M × $75 = $7.5
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("returns project-wide totals when boardId is omitted (pre-#200 behavior)", async () => {
		const result = await tokenUsageService.getProjectSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		// All four events: 1.5M input + 1.7M output.
		// $15/M × 1.5M + $75/M × 1.7M = $22.5 + $127.5 = $150.
		expect(result.data.totalCostUsd).toBeCloseTo(150, 4);
		expect(result.data.eventCount).toBe(4);
		// Three distinct sessionIds.
		expect(result.data.sessionCount).toBe(3);
	});

	it("returns only Board A's events when scoped by boardId=A", async () => {
		const result = await tokenUsageService.getProjectSummary(PROJECT_ID, BOARD_A);
		expect(result.success).toBe(true);
		if (!result.success) return;

		// Direct attribution: SESSION_A_ONLY ($90) + SESSION_BOTH's Card A row
		// ($7.5 output). Session-expansion of SESSION_BOTH also pulls its
		// Card B row ($7.5) because they share the sessionId. SESSION_A_ONLY
		// has no other rows to pull. Total: $90 + $7.5 + $7.5 = $105.
		expect(result.data.totalCostUsd).toBeCloseTo(105, 4);
	});

	it("returns only Board B's events when scoped by boardId=B", async () => {
		const result = await tokenUsageService.getProjectSummary(PROJECT_ID, BOARD_B);
		expect(result.success).toBe(true);
		if (!result.success) return;

		// SESSION_B_ONLY ($45) + SESSION_BOTH's Card B row ($7.5). Plus
		// session-expansion of SESSION_BOTH pulls its Card A row ($7.5).
		// Total: $45 + $7.5 + $7.5 = $60.
		expect(result.data.totalCostUsd).toBeCloseTo(60, 4);
	});

	it("multi-board session contributes to BOTH board totals (cost inequality is expected)", async () => {
		// boardA + boardB = $105 + $60 = $165. project = $150. Inequality
		// holds: a session that touched cards on both boards is fully
		// counted in each board's total — that's the session-expansion rule
		// applied at the board level. Documented in the helper's doc and
		// in #200's "Cost inequality" acceptance.
		const project = await tokenUsageService.getProjectSummary(PROJECT_ID);
		const a = await tokenUsageService.getProjectSummary(PROJECT_ID, BOARD_A);
		const b = await tokenUsageService.getProjectSummary(PROJECT_ID, BOARD_B);
		expect(project.success && a.success && b.success).toBe(true);
		if (!project.success || !a.success || !b.success) return;
		expect(a.data.totalCostUsd + b.data.totalCostUsd).toBeGreaterThan(project.data.totalCostUsd);
	});
});

// ─── 4. Cross-project isolation ───────────────────────────────────────

describe("getProjectSummary — cross-project isolation", () => {
	let testDb: TestDb;

	const PROJECT_A = "10000000-1000-4000-8000-1000000003c1";
	const PROJECT_B = "10000000-1000-4000-8000-1000000003c2";
	const BOARD_A = "20000000-2000-4000-8000-2000000003c1";
	const COLUMN_A = "30000000-3000-4000-8000-3000000003c1";
	const CARD_A = "40000000-4000-4000-8000-4000000003c1";
	// Same sessionId in both projects — the bug class the helper guards
	// against. Pre-helper, a naive `OR` widening could have leaked
	// project B's cost into project A's board.
	const SHARED_SESSION = "shared-session-cross-project";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_A, name: "Project A", slug: "proj-a" },
		});
		await testDb.prisma.project.create({
			data: { id: PROJECT_B, name: "Project B", slug: "proj-b" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_A, projectId: PROJECT_A, name: "Board A" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_A, boardId: BOARD_A, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_A,
				columnId: COLUMN_A,
				projectId: PROJECT_A,
				number: 1,
				title: "Card A",
				position: 0,
			},
		});

		// Project A — direct attribution row (small cost).
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SHARED_SESSION,
				projectId: PROJECT_A,
				cardId: CARD_A,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 100_000,
				outputTokens: 0, // $1.5
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});

		// Project B — same sessionId, large cost. Must NOT show up in
		// Project A's board totals even though the sessionId collides.
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SHARED_SESSION,
				projectId: PROJECT_B,
				cardId: null,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: 10_000_000, // $750 — would dwarf Project A's total
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("does not leak Project B's session cost into Project A's board total", async () => {
		const result = await tokenUsageService.getProjectSummary(PROJECT_A, BOARD_A);
		expect(result.success).toBe(true);
		if (!result.success) return;

		// Project A's board sees only its own direct-attribution row ($1.5).
		// If `projectId` weren't pinned in the resolved where, Project B's
		// $750 row would leak in via the shared sessionId — the regression
		// this test exists to prevent.
		expect(result.data.totalCostUsd).toBeCloseTo(1.5, 4);
		expect(result.data.eventCount).toBe(1);
	});
});

// ─── 6. getDailyCostSeries — board scope boundary ─────────────────────

describe("getDailyCostSeries — board scope", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-1000000003d1";
	const BOARD_A = "20000000-2000-4000-8000-2000000003d1";
	const BOARD_B = "20000000-2000-4000-8000-2000000003d2";
	const COLUMN_A = "30000000-3000-4000-8000-3000000003d1";
	const COLUMN_B = "30000000-3000-4000-8000-3000000003d2";
	const CARD_A = "40000000-4000-4000-8000-4000000003d1";
	const CARD_B = "40000000-4000-4000-8000-4000000003d2";

	const NOW = new Date("2026-04-30T14:00:00Z");

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		vi.useFakeTimers();
		vi.setSystemTime(NOW);

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Series", slug: "series" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_A, projectId: PROJECT_ID, name: "Board A" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_B, projectId: PROJECT_ID, name: "Board B" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_A, boardId: BOARD_A, name: "Todo", position: 0 },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_B, boardId: BOARD_B, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_A,
				columnId: COLUMN_A,
				projectId: PROJECT_ID,
				number: 1,
				title: "Card A",
				position: 0,
			},
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_B,
				columnId: COLUMN_B,
				projectId: PROJECT_ID,
				number: 2,
				title: "Card B",
				position: 0,
			},
		});

		// Today (UTC), bucket 6: one event on Board A — 1M output ($75).
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: "series-a-session",
				projectId: PROJECT_ID,
				cardId: CARD_A,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: 1_000_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: new Date(NOW.getTime() - 1),
			},
		});

		// Today (UTC), bucket 6: one event on Board B — 2M output ($150).
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: "series-b-session",
				projectId: PROJECT_ID,
				cardId: CARD_B,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: 2_000_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: new Date(NOW.getTime() - 1),
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		vi.useRealTimers();
		await testDb.cleanup();
	});

	it("scopes the bucket sums to the requested board", async () => {
		// Project-wide: $75 + $150 = $225 in bucket 6.
		const project = await tokenUsageService.getDailyCostSeries(PROJECT_ID);
		expect(project.success).toBe(true);
		if (!project.success) return;
		expect(project.data.dailyCostUsd[6]).toBeCloseTo(225, 4);
		expect(project.data.weekTotalCostUsd).toBeCloseTo(225, 4);

		// Board A only: $75.
		const a = await tokenUsageService.getDailyCostSeries(PROJECT_ID, BOARD_A);
		expect(a.success).toBe(true);
		if (!a.success) return;
		expect(a.data.dailyCostUsd[6]).toBeCloseTo(75, 4);
		expect(a.data.weekTotalCostUsd).toBeCloseTo(75, 4);

		// Board B only: $150.
		const b = await tokenUsageService.getDailyCostSeries(PROJECT_ID, BOARD_B);
		expect(b.success).toBe(true);
		if (!b.success) return;
		expect(b.data.dailyCostUsd[6]).toBeCloseTo(150, 4);
		expect(b.data.weekTotalCostUsd).toBeCloseTo(150, 4);
	});
});
