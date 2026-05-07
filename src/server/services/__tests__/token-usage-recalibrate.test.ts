/**
 * Unit tests for tokenUsageService.recalibrateBaseline (#192 F3, #293
 * BaselineSnapshot history).
 *
 * Covered:
 *   - inserts a `BaselineSnapshot` row each call (history grows)
 *   - clears the legacy `Project.metadata.tokenBaseline` singleton on first call
 *     (one-shot forward-migrate from the pre-#293 schema)
 *   - preserves other keys on `Project.metadata`
 *   - happy-path response shape and savings math
 *   - omits `latestHandoffTokens` when no handoff exists
 *   - returns BOARD_NOT_FOUND when the project has no boards
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));
const mocks = vi.hoisted(() => ({ buildBriefPayload: vi.fn() }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

vi.mock("@/server/services/brief-payload-service", () => ({
	buildBriefPayload: mocks.buildBriefPayload,
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

const BRIEF_PAYLOAD = { pulse: "tiny", topWork: [], blockers: [] };

describe("tokenUsageService.recalibrateBaseline", () => {
	let testDb: TestDb;

	const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
	const BOARD_ID = "11111111-1111-4111-8111-111111111111";
	const COLUMN_ID = "55555555-5555-4555-8555-555555555555";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.buildBriefPayload.mockResolvedValue(BRIEF_PAYLOAD);

		// Reset project + board state between tests so each starts clean.
		await testDb.prisma.baselineSnapshot.deleteMany({});
		await testDb.prisma.handoff.deleteMany({});
		await testDb.prisma.card.deleteMany({});
		await testDb.prisma.column.deleteMany({});
		await testDb.prisma.board.deleteMany({});
		await testDb.prisma.project.deleteMany({});

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Recal", slug: "recal", metadata: "{}" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Main" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Backlog", position: 0 },
		});
	});

	it("inserts a snapshot row and returns the canonical baseline shape", async () => {
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toMatchObject({
			briefMeTokens: expect.any(Number),
			naiveBootstrapTokens: expect.any(Number),
			savings: expect.any(Number),
			savingsPct: expect.any(Number),
			measuredAt: expect.any(String),
		});

		// chars/4 estimator on the brief payload.
		const expectedBrief = Math.ceil(JSON.stringify(BRIEF_PAYLOAD).length / 4);
		expect(result.data.briefMeTokens).toBe(expectedBrief);

		const snapshots = await testDb.prisma.baselineSnapshot.findMany({
			where: { projectId: PROJECT_ID },
		});
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0].briefMeTokens).toBe(result.data.briefMeTokens);
		expect(snapshots[0].naiveBootstrapTokens).toBe(result.data.naiveBootstrapTokens);
	});

	it("each call appends a new snapshot row (history grows, doesn't overwrite)", async () => {
		await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		await tokenUsageService.recalibrateBaseline(PROJECT_ID);

		const snapshots = await testDb.prisma.baselineSnapshot.findMany({
			where: { projectId: PROJECT_ID },
			orderBy: { measuredAt: "asc" },
		});
		expect(snapshots).toHaveLength(3);
	});

	it("first call clears the legacy `metadata.tokenBaseline` singleton (one-shot forward-migrate)", async () => {
		// Simulate a project that pre-dates #293 — it has a stale singleton
		// and other agent-written keys we must preserve.
		await testDb.prisma.project.update({
			where: { id: PROJECT_ID },
			data: {
				metadata: JSON.stringify({
					tokenBaseline: {
						briefMeTokens: 1,
						naiveBootstrapTokens: 2,
						measuredAt: "2026-01-01T00:00:00.000Z",
					},
					existingKey: "preserved",
					nested: { keep: true },
				}),
			},
		});

		await tokenUsageService.recalibrateBaseline(PROJECT_ID);

		const project = await testDb.prisma.project.findUnique({
			where: { id: PROJECT_ID },
			select: { metadata: true },
		});
		const meta = JSON.parse(project?.metadata ?? "{}");
		expect(meta.tokenBaseline).toBeUndefined();
		expect(meta.existingKey).toBe("preserved");
		expect(meta.nested).toEqual({ keep: true });
	});

	it("savings math: savings = naive - briefMe, savingsPct = savings/naive", async () => {
		// Seed enough cards to bulk up the naive payload past briefMe.
		await testDb.prisma.card.createMany({
			data: Array.from({ length: 40 }, (_, i) => ({
				id: `card-${i.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: i + 1,
				title: `Card ${i} with a fairly descriptive title`,
				description:
					"A meaningful description that adds tokens to the naive payload to keep the savings math directional.",
				position: i,
			})),
		});

		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		const { briefMeTokens, naiveBootstrapTokens, savings, savingsPct } = result.data;
		expect(savings).toBe(naiveBootstrapTokens - briefMeTokens);
		expect(savingsPct).toBeCloseTo(savings / naiveBootstrapTokens);
		expect(briefMeTokens).toBeLessThan(naiveBootstrapTokens);
	});

	it("omits latestHandoffTokens when no handoff exists", async () => {
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).not.toHaveProperty("latestHandoffTokens");

		const snapshot = await testDb.prisma.baselineSnapshot.findFirst({
			where: { projectId: PROJECT_ID },
		});
		expect(snapshot?.latestHandoffTokens).toBeNull();
	});

	it("includes latestHandoffTokens when a handoff exists for the canonical board", async () => {
		await testDb.prisma.handoff.create({
			data: {
				boardId: BOARD_ID,
				projectId: PROJECT_ID,
				agentName: "claude-code",
				summary: "did stuff",
				workingOn: '["#1"]',
				findings: '["found a thing"]',
				nextSteps: '["onward"]',
				blockers: "[]",
			},
		});
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.latestHandoffTokens).toEqual(expect.any(Number));
		expect(result.data.latestHandoffTokens).toBeGreaterThan(0);

		const snapshot = await testDb.prisma.baselineSnapshot.findFirst({
			where: { projectId: PROJECT_ID },
		});
		expect(snapshot?.latestHandoffTokens).toBe(result.data.latestHandoffTokens);
	});

	it("returns BOARD_NOT_FOUND when the project has no boards", async () => {
		await testDb.prisma.column.deleteMany({ where: { boardId: BOARD_ID } });
		await testDb.prisma.board.delete({ where: { id: BOARD_ID } });

		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("BOARD_NOT_FOUND");

		const snapshots = await testDb.prisma.baselineSnapshot.findMany({
			where: { projectId: PROJECT_ID },
		});
		expect(snapshots).toHaveLength(0);
	});

	it("safeParseJson tolerates malformed metadata without erroring", async () => {
		await testDb.prisma.project.update({
			where: { id: PROJECT_ID },
			data: { metadata: "not valid json {{{" },
		});
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);

		const project = await testDb.prisma.project.findUnique({
			where: { id: PROJECT_ID },
			select: { metadata: true },
		});
		const meta = JSON.parse(project?.metadata ?? "{}");
		// Garbage parsed → empty object → tokenBaseline absent. Snapshot still written.
		expect(meta.tokenBaseline).toBeUndefined();

		const snapshots = await testDb.prisma.baselineSnapshot.findMany({
			where: { projectId: PROJECT_ID },
		});
		expect(snapshots).toHaveLength(1);
	});
});
