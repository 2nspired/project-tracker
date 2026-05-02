// Tests for the `attributionBreakdown` field on `getProjectSummary` (#213).
//
// The breakdown is the feedback loop for the Attribution Engine (#269)
// and the gating signal for re-evaluating #270 (historical backfill) and
// #272 (tail signals 3+4). Three buckets must stay distinct — a single
// opaque "unattributed" number conflates orchestrator-mode sessions with
// pre-engine drag, which silently misleads the deferral re-evaluation.
//
// Per-session bucketing rules (sticky-true within a session):
//   - attributed   — any row has cardId set
//   - unattributed — all rows cardId NULL AND any row has signal set
//   - preEngine    — all rows cardId NULL AND signal NULL on every row
//
// Cost per bucket sums all events in sessions that fell in that bucket.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getProjectSummary — attributionBreakdown", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000213";
	const BOARD_ID = "20000000-2000-4000-8000-200000000213";
	const COLUMN_ID = "30000000-3000-4000-8000-300000000213";
	const CARD_ID = "40000000-4000-4000-8000-400000000213";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Breakdown", slug: "breakdown" },
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
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	async function seedRow(opts: {
		sessionId: string;
		model?: string;
		cardId?: string | null;
		signal?: string | null;
		inputTokens?: number;
		outputTokens?: number;
	}) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: PROJECT_ID,
				cardId: opts.cardId ?? null,
				agentName: "test",
				model: opts.model ?? "claude-opus-4-7",
				inputTokens: opts.inputTokens ?? 1000,
				outputTokens: opts.outputTokens ?? 500,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				signal: opts.signal ?? null,
				signalConfidence: opts.signal === "single-in-progress" ? "high" : null,
			},
		});
	}

	async function clearRows() {
		await testDb.prisma.tokenUsageEvent.deleteMany({ where: { projectId: PROJECT_ID } });
	}

	it("buckets sessions correctly when all three states are present", async () => {
		await clearRows();
		// Attributed session — cardId set, signal=single-in-progress (post-engine).
		await seedRow({ sessionId: "s-attributed", cardId: CARD_ID, signal: "single-in-progress" });
		// Unattributed session — engine ran, decided null (multi-In-Progress).
		await seedRow({ sessionId: "s-unattributed", cardId: null, signal: "unattributed" });
		// Pre-engine session — both cardId and signal are null.
		await seedRow({ sessionId: "s-preengine", cardId: null, signal: null });

		const result = await tokenUsageService.getProjectSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		const { attributionBreakdown } = result.data;
		expect(attributionBreakdown.attributed.sessionCount).toBe(1);
		expect(attributionBreakdown.unattributed.sessionCount).toBe(1);
		expect(attributionBreakdown.preEngine.sessionCount).toBe(1);

		// Sum of bucket counts equals total session count (no double-counting).
		const totalBucketCount =
			attributionBreakdown.attributed.sessionCount +
			attributionBreakdown.unattributed.sessionCount +
			attributionBreakdown.preEngine.sessionCount;
		expect(totalBucketCount).toBe(result.data.sessionCount);

		// Each bucket carries a non-zero cost (token counts > 0 above).
		expect(attributionBreakdown.attributed.costUsd).toBeGreaterThan(0);
		expect(attributionBreakdown.unattributed.costUsd).toBeGreaterThan(0);
		expect(attributionBreakdown.preEngine.costUsd).toBeGreaterThan(0);
	});

	it("a session with ANY row carrying cardId counts as attributed (sticky-true within session)", async () => {
		// Multi-row session: one row has cardId set, another row in the same
		// session has cardId=null. The session counts as attributed once.
		// Pins the per-session aggregation rule so a future refactor doesn't
		// silently regress to per-row bucketing.
		await clearRows();
		await seedRow({
			sessionId: "s-multi",
			model: "claude-opus-4-7",
			cardId: CARD_ID,
			signal: "single-in-progress",
		});
		await seedRow({
			sessionId: "s-multi",
			model: "claude-sonnet-4-6",
			cardId: null,
			signal: null,
		});

		const result = await tokenUsageService.getProjectSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.attributionBreakdown.attributed.sessionCount).toBe(1);
		expect(result.data.attributionBreakdown.preEngine.sessionCount).toBe(0);
		expect(result.data.attributionBreakdown.unattributed.sessionCount).toBe(0);
	});

	it("returns zero counts for all buckets when there are no events", async () => {
		await clearRows();
		const result = await tokenUsageService.getProjectSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.attributionBreakdown).toEqual({
			attributed: { sessionCount: 0, costUsd: 0 },
			unattributed: { sessionCount: 0, costUsd: 0 },
			preEngine: { sessionCount: 0, costUsd: 0 },
		});
	});

	it("classifies signal=`unattributed` rows correctly (engine ran, returned null)", async () => {
		// Pins the difference between the two null-cardId buckets.
		// Two sessions: both have cardId=null, but one has signal set
		// (engine returned 'unattributed') and the other has signal=null
		// (pre-engine row). They land in DIFFERENT buckets.
		await clearRows();
		await seedRow({ sessionId: "s-engine-null", cardId: null, signal: "unattributed" });
		await seedRow({ sessionId: "s-preengine-null", cardId: null, signal: null });

		const result = await tokenUsageService.getProjectSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.attributionBreakdown.unattributed.sessionCount).toBe(1);
		expect(result.data.attributionBreakdown.preEngine.sessionCount).toBe(1);
		expect(result.data.attributionBreakdown.attributed.sessionCount).toBe(0);
	});
});
