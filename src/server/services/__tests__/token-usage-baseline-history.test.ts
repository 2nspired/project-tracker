// Tests for `getBaselineHistory` (#293).
//
// Time-series read backing the briefMe-payload trend chart in the Costs
// page's `<SavingsSection>`. Three properties to lock:
//   1. Empty array when the project has no snapshots
//   2. Returns rows ordered by `measuredAt` ascending (chart renders L→R)
//   3. Project-scoped — sibling projects don't leak

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

describe("getBaselineHistory", () => {
	let testDb: TestDb;

	const PROJECT_ID = "80000000-8000-4000-8000-800000000293";
	const SIBLING_PROJECT_ID = "80000000-8000-4000-8000-800000000294";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.createMany({
			data: [
				{ id: PROJECT_ID, name: "BH", slug: "baseline-history" },
				{ id: SIBLING_PROJECT_ID, name: "BH Sibling", slug: "baseline-history-sibling" },
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	beforeEach(async () => {
		await testDb.prisma.baselineSnapshot.deleteMany({});
	});

	async function seedSnapshot(
		projectId: string,
		opts: {
			briefMeTokens: number;
			naiveBootstrapTokens: number;
			latestHandoffTokens?: number | null;
			measuredAt: Date;
		}
	) {
		await testDb.prisma.baselineSnapshot.create({
			data: {
				projectId,
				briefMeTokens: opts.briefMeTokens,
				naiveBootstrapTokens: opts.naiveBootstrapTokens,
				latestHandoffTokens: opts.latestHandoffTokens ?? null,
				measuredAt: opts.measuredAt,
			},
		});
	}

	it("returns an empty array when the project has no snapshots", async () => {
		const result = await tokenUsageService.getBaselineHistory(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual([]);
	});

	it("returns rows ordered ascending by measuredAt", async () => {
		// Seed out of order to verify the order-by, not insertion order.
		await seedSnapshot(PROJECT_ID, {
			briefMeTokens: 1500,
			naiveBootstrapTokens: 6000,
			measuredAt: new Date("2026-05-01T00:00:00.000Z"),
		});
		await seedSnapshot(PROJECT_ID, {
			briefMeTokens: 1000,
			naiveBootstrapTokens: 5000,
			measuredAt: new Date("2026-04-01T00:00:00.000Z"),
		});
		await seedSnapshot(PROJECT_ID, {
			briefMeTokens: 1200,
			naiveBootstrapTokens: 5500,
			measuredAt: new Date("2026-04-15T00:00:00.000Z"),
		});

		const result = await tokenUsageService.getBaselineHistory(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.map((r) => r.measuredAt)).toEqual([
			"2026-04-01T00:00:00.000Z",
			"2026-04-15T00:00:00.000Z",
			"2026-05-01T00:00:00.000Z",
		]);
		expect(result.data.map((r) => r.briefMeTokens)).toEqual([1000, 1200, 1500]);
	});

	it("isolates by projectId — sibling projects' snapshots don't leak", async () => {
		await seedSnapshot(PROJECT_ID, {
			briefMeTokens: 1000,
			naiveBootstrapTokens: 5000,
			measuredAt: new Date("2026-04-01T00:00:00.000Z"),
		});
		await seedSnapshot(SIBLING_PROJECT_ID, {
			briefMeTokens: 9999,
			naiveBootstrapTokens: 99999,
			measuredAt: new Date("2026-04-02T00:00:00.000Z"),
		});

		const result = await tokenUsageService.getBaselineHistory(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toHaveLength(1);
		expect(result.data[0].briefMeTokens).toBe(1000);
	});

	it("preserves nullable latestHandoffTokens (no defaulting to 0)", async () => {
		await seedSnapshot(PROJECT_ID, {
			briefMeTokens: 1000,
			naiveBootstrapTokens: 5000,
			latestHandoffTokens: null,
			measuredAt: new Date("2026-04-01T00:00:00.000Z"),
		});
		await seedSnapshot(PROJECT_ID, {
			briefMeTokens: 1200,
			naiveBootstrapTokens: 5500,
			latestHandoffTokens: 800,
			measuredAt: new Date("2026-04-15T00:00:00.000Z"),
		});

		const result = await tokenUsageService.getBaselineHistory(PROJECT_ID);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data[0].latestHandoffTokens).toBeNull();
		expect(result.data[1].latestHandoffTokens).toBe(800);
	});
});
