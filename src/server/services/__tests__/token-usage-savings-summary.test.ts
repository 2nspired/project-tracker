// Tests for `getSavingsSummary` (#273 — revived from #236; #293 swapped
// the read source from `Project.metadata.tokenBaseline` to the
// `BaselineSnapshot` history table).
//
// Cheap reader for the latest `BaselineSnapshot`. Four paths to lock:
//   1. Project missing → NOT_FOUND
//   2. No snapshots for this project → null
//   3. Multi-snapshot history → returns the row with MAX(measuredAt)
//   4. `latestHandoffTokens` round-trip when present, omitted otherwise

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getSavingsSummary", () => {
	let testDb: TestDb;

	const PROJECT_ID = "70000000-7000-4000-8000-700000000273";
	const MISSING_PROJECT_ID = "70000000-7000-4000-8000-700000000274";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Savings", slug: "savings-273" },
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	beforeEach(async () => {
		// Each test starts from a clean snapshot history.
		await testDb.prisma.baselineSnapshot.deleteMany({ where: { projectId: PROJECT_ID } });
	});

	async function seedSnapshot(opts: {
		briefMeTokens: number;
		naiveBootstrapTokens: number;
		latestHandoffTokens?: number | null;
		measuredAt: Date;
	}) {
		await testDb.prisma.baselineSnapshot.create({
			data: {
				projectId: PROJECT_ID,
				briefMeTokens: opts.briefMeTokens,
				naiveBootstrapTokens: opts.naiveBootstrapTokens,
				latestHandoffTokens: opts.latestHandoffTokens ?? null,
				measuredAt: opts.measuredAt,
			},
		});
	}

	it("returns NOT_FOUND when the project doesn't exist", async () => {
		const result = await tokenUsageService.getSavingsSummary(MISSING_PROJECT_ID);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("NOT_FOUND");
	});

	it("returns null when no snapshots have been recorded yet", async () => {
		const result = await tokenUsageService.getSavingsSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toBeNull();
	});

	it("derives savings + savingsPct from the most-recent snapshot", async () => {
		await seedSnapshot({
			briefMeTokens: 3500,
			naiveBootstrapTokens: 14000,
			measuredAt: new Date("2026-05-02T12:00:00.000Z"),
		});

		const result = await tokenUsageService.getSavingsSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success || !result.data) return;
		expect(result.data.briefMeTokens).toBe(3500);
		expect(result.data.naiveBootstrapTokens).toBe(14000);
		expect(result.data.savings).toBe(10500);
		// 10500 / 14000 = 0.75
		expect(result.data.savingsPct).toBeCloseTo(0.75, 5);
		expect(result.data.measuredAt).toBe("2026-05-02T12:00:00.000Z");
	});

	it("returns the row with MAX(measuredAt) when multiple snapshots exist", async () => {
		await seedSnapshot({
			briefMeTokens: 1000,
			naiveBootstrapTokens: 5000,
			measuredAt: new Date("2026-04-01T00:00:00.000Z"),
		});
		await seedSnapshot({
			briefMeTokens: 1500,
			naiveBootstrapTokens: 6000,
			measuredAt: new Date("2026-05-01T00:00:00.000Z"),
		});
		await seedSnapshot({
			briefMeTokens: 1200,
			naiveBootstrapTokens: 5500,
			measuredAt: new Date("2026-04-15T00:00:00.000Z"),
		});

		const result = await tokenUsageService.getSavingsSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success || !result.data) return;
		// MAX(measuredAt) = 2026-05-01.
		expect(result.data.briefMeTokens).toBe(1500);
		expect(result.data.naiveBootstrapTokens).toBe(6000);
		expect(result.data.measuredAt).toBe("2026-05-01T00:00:00.000Z");
	});

	it("includes latestHandoffTokens when present, omits otherwise", async () => {
		await seedSnapshot({
			briefMeTokens: 3500,
			naiveBootstrapTokens: 14000,
			latestHandoffTokens: 1200,
			measuredAt: new Date("2026-05-02T12:00:00.000Z"),
		});
		let result = await tokenUsageService.getSavingsSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success || !result.data) return;
		expect(result.data.latestHandoffTokens).toBe(1200);

		// Replace with a snapshot that has no handoff data; expect omitted.
		await testDb.prisma.baselineSnapshot.deleteMany({ where: { projectId: PROJECT_ID } });
		await seedSnapshot({
			briefMeTokens: 3500,
			naiveBootstrapTokens: 14000,
			measuredAt: new Date("2026-05-03T12:00:00.000Z"),
		});
		result = await tokenUsageService.getSavingsSummary(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success || !result.data) return;
		expect(result.data).not.toHaveProperty("latestHandoffTokens");
	});
});
