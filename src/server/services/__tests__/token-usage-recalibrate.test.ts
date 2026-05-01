/**
 * Unit tests for tokenUsageService.recalibrateBaseline (#192 F3).
 *
 * Covered:
 *   - happy path: measures briefMe + naive payloads, persists on metadata
 *   - no-handoffs: omits latestHandoffTokens (no error, no null)
 *   - metadata merge preserves other keys
 *   - savings math: savings = naive - briefMe; savingsPct = savings/naive
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	boardFindFirst: vi.fn(),
	boardFindUnique: vi.fn(),
	handoffFindFirst: vi.fn(),
	projectFindUnique: vi.fn(),
	projectUpdate: vi.fn(),
	buildBriefPayload: vi.fn(),
}));

vi.mock("@/server/db", () => ({
	db: {
		board: { findFirst: mocks.boardFindFirst, findUnique: mocks.boardFindUnique },
		handoff: { findFirst: mocks.handoffFindFirst },
		project: { findUnique: mocks.projectFindUnique, update: mocks.projectUpdate },
	},
}));

vi.mock("@/server/services/brief-payload-service", () => ({
	buildBriefPayload: mocks.buildBriefPayload,
}));

import { tokenUsageService } from "@/server/services/token-usage-service";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const BOARD_ID = "11111111-1111-4111-8111-111111111111";

// Lightweight payload fixtures sized so naive >> briefMe and the math is
// deterministic across runs.
const BRIEF_PAYLOAD = { pulse: "tiny", topWork: [], blockers: [] };
const FULL_BOARD = {
	id: BOARD_ID,
	name: "B",
	project: { id: PROJECT_ID, name: "P" },
	columns: Array.from({ length: 5 }, (_, i) => ({
		id: `col-${i}`,
		name: `Column ${i}`,
		cards: Array.from({ length: 8 }, (_, j) => ({
			id: `c-${i}-${j}`,
			number: i * 10 + j,
			title: `Card ${i}-${j} with a fairly long descriptive title`,
			description:
				"A fully populated description that bulks up the naive payload to make the savings math observable.",
			checklists: [
				{ id: `chk-${i}-${j}-0`, text: "subtask one", completed: false },
				{ id: `chk-${i}-${j}-1`, text: "subtask two", completed: true },
			],
		})),
	})),
};

describe("tokenUsageService.recalibrateBaseline", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.boardFindFirst.mockResolvedValue({ id: BOARD_ID });
		mocks.boardFindUnique.mockResolvedValue(FULL_BOARD);
		mocks.buildBriefPayload.mockResolvedValue(BRIEF_PAYLOAD);
		mocks.handoffFindFirst.mockResolvedValue(null);
		mocks.projectFindUnique.mockResolvedValue({ metadata: "{}" });
		mocks.projectUpdate.mockResolvedValue({ id: PROJECT_ID });
	});

	it("happy path: returns the canonical baseline shape and persists metadata", async () => {
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

		// Persisted under Project.metadata.tokenBaseline.
		expect(mocks.projectUpdate).toHaveBeenCalledTimes(1);
		const updateArg = mocks.projectUpdate.mock.calls[0]?.[0] as {
			data: { metadata: string };
		};
		const persisted = JSON.parse(updateArg.data.metadata);
		expect(persisted.tokenBaseline).toMatchObject({
			briefMeTokens: result.data.briefMeTokens,
			naiveBootstrapTokens: result.data.naiveBootstrapTokens,
			measuredAt: result.data.measuredAt,
		});
	});

	it("savings math: savings = naive - briefMe, savingsPct = savings/naive", async () => {
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		const { briefMeTokens, naiveBootstrapTokens, savings, savingsPct } = result.data;
		expect(savings).toBe(naiveBootstrapTokens - briefMeTokens);
		expect(savingsPct).toBeCloseTo(savings / naiveBootstrapTokens);
		// Sanity directionality on the fixture (NOT a formal acceptance —
		// the spec explicitly says we don't assert this on real data).
		expect(briefMeTokens).toBeLessThan(naiveBootstrapTokens);
	});

	it("omits latestHandoffTokens when there are no handoffs", async () => {
		mocks.handoffFindFirst.mockResolvedValue(null);
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).not.toHaveProperty("latestHandoffTokens");

		// And the persisted metadata should also omit it.
		const updateArg = mocks.projectUpdate.mock.calls[0]?.[0] as {
			data: { metadata: string };
		};
		const persisted = JSON.parse(updateArg.data.metadata);
		expect(persisted.tokenBaseline).not.toHaveProperty("latestHandoffTokens");
	});

	it("includes latestHandoffTokens when a handoff exists", async () => {
		mocks.handoffFindFirst.mockResolvedValue({
			summary: "did stuff",
			workingOn: '["#1"]',
			nextSteps: '["onward"]',
			findings: '["found a thing"]',
			blockers: "[]",
		});
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.latestHandoffTokens).toEqual(expect.any(Number));
		expect(result.data.latestHandoffTokens).toBeGreaterThan(0);
	});

	it("metadata merge preserves other keys", async () => {
		mocks.projectFindUnique.mockResolvedValue({
			metadata: JSON.stringify({
				existingKey: "preserved",
				nested: { keep: true },
				tokenBaseline: { briefMeTokens: 1, naiveBootstrapTokens: 2, measuredAt: "old" },
			}),
		});
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);

		const updateArg = mocks.projectUpdate.mock.calls[0]?.[0] as {
			data: { metadata: string };
		};
		const persisted = JSON.parse(updateArg.data.metadata);
		expect(persisted.existingKey).toBe("preserved");
		expect(persisted.nested).toEqual({ keep: true });
		// tokenBaseline overwritten with the fresh measurement.
		expect(persisted.tokenBaseline.measuredAt).not.toBe("old");
	});

	it("returns BOARD_NOT_FOUND when the project has no boards", async () => {
		mocks.boardFindFirst.mockResolvedValue(null);
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("BOARD_NOT_FOUND");
		expect(mocks.projectUpdate).not.toHaveBeenCalled();
	});

	it("safeParseJson tolerates malformed metadata without erroring", async () => {
		mocks.projectFindUnique.mockResolvedValue({ metadata: "not valid json {{{" });
		const result = await tokenUsageService.recalibrateBaseline(PROJECT_ID);
		expect(result.success).toBe(true);

		const updateArg = mocks.projectUpdate.mock.calls[0]?.[0] as {
			data: { metadata: string };
		};
		const persisted = JSON.parse(updateArg.data.metadata);
		// Existing keys gone (couldn't parse), but tokenBaseline still written.
		expect(persisted.tokenBaseline).toBeDefined();
	});
});
