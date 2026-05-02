/**
 * Parity test for the briefMe payload extraction (#192 F3 step 0).
 *
 * Documents the wire shape of `buildBriefPayload` so any future refactor
 * has a guard against silent drops/renames. Uses dependency mocks rather
 * than a live SQLite — the assembly logic is pure once the DB calls
 * resolve, so the focus here is on shape, not query behavior.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the staleness module — keeps the parity test focused on payload
// shape rather than the staleness evaluator's git-shell-out path.
// Module path moved from `@/mcp/staleness` to `@/lib/services/staleness`
// in #228 (server↔mcp layer-violation fix).
vi.mock("@/lib/services/staleness", () => ({
	checkStaleness: vi.fn(async () => []),
	formatStalenessWarnings: vi.fn(() => null),
}));

vi.mock("@/server/services/stale-cards", () => ({
	findStaleInProgress: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/services/handoff", () => ({
	getLatestHandoff: vi.fn(async () => null),
	parseHandoff: vi.fn(),
}));

vi.mock("@/lib/services/board-diff", () => ({
	computeBoardDiff: vi.fn(async () => null),
}));

vi.mock("@/lib/services/decisions", () => ({
	isRecentDecision: vi.fn(() => true),
}));

vi.mock("@/lib/services/relations", () => ({
	getBlockers: vi.fn(async () => []),
}));

vi.mock("@/lib/services/tracker-policy", () => ({
	loadTrackerPolicy: vi.fn(async () => ({
		policy: { intent_required_on: [] },
		warnings: [],
	})),
}));

vi.mock("@/server/services/token-usage-service", () => ({
	tokenUsageService: {
		getProjectSummary: vi.fn(async () => ({
			success: true,
			data: { trackingSince: null, totalCostUsd: 0, sessionCount: 0 },
		})),
	},
}));

import { buildBriefPayload } from "@/server/services/brief-payload-service";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function makeMockDb() {
	return {
		board: {
			findUnique: vi.fn(async () => ({
				id: BOARD_ID,
				name: "Tutorial Board",
				project: { id: PROJECT_ID, name: "Tutorial", repoPath: null },
				columns: [
					{
						id: "col-1",
						name: "Backlog",
						role: "backlog",
						isParking: false,
						position: 0,
						cards: [
							{
								id: "card-1",
								number: 1,
								title: "First card",
								position: 0,
								priority: "HIGH",
								updatedAt: new Date(),
								dueDate: null,
								checklists: [],
								relationsTo: [],
								relationsFrom: [],
							},
						],
					},
					{
						id: "col-2",
						name: "Done",
						role: "done",
						isParking: false,
						position: 1,
						cards: [],
					},
				],
			})),
		},
		claim: { findMany: vi.fn(async () => []) },
		activity: { findMany: vi.fn(async () => []) },
	} as unknown as Parameters<typeof buildBriefPayload>[1];
}

describe("buildBriefPayload (#192 F3 shape parity)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the canonical briefMe payload keys for an empty board", async () => {
		const payload = await buildBriefPayload(BOARD_ID, makeMockDb());

		// Stable keys that are always present.
		expect(payload).toHaveProperty("pulse");
		expect(payload).toHaveProperty("policy");
		expect(payload).toHaveProperty("handoff");
		expect(payload).toHaveProperty("diff");
		expect(payload).toHaveProperty("topWork");
		expect(payload).toHaveProperty("blockers");
		expect(payload).toHaveProperty("recentDecisions");
		expect(payload).toHaveProperty("stale");
		expect(payload).toHaveProperty("_hint");

		// Pulse string format: `${project} / ${board} · ${counts}`
		expect(payload.pulse).toMatch(/^Tutorial \/ Tutorial Board · /);

		// Empty collections are arrays, not undefined.
		expect(Array.isArray(payload.topWork)).toBe(true);
		expect(Array.isArray(payload.blockers)).toBe(true);
		expect(Array.isArray(payload.recentDecisions)).toBe(true);
	});

	it("propagates MCP-context options into the payload", async () => {
		const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), {
			serverVersion: "9.9.9",
			isLegacyBrand: true,
			legacyBrandDeprecation: "DEPRECATED",
			autoResolved: { projectName: "P", boardName: "B" },
		});
		expect(payload._serverVersion).toBe("9.9.9");
		expect(payload._brandDeprecation).toBe("DEPRECATED");
		expect(payload.resolvedFromCwd).toEqual({
			projectName: "P",
			boardName: "B",
			boardId: BOARD_ID,
		});
	});

	it("emits _versionMismatch only when boot/head SHAs differ", async () => {
		const same = await buildBriefPayload(BOARD_ID, makeMockDb(), {
			bootSha: "abc1234567",
			headSha: "abc1234567",
		});
		expect(same).not.toHaveProperty("_versionMismatch");

		const drift = await buildBriefPayload(BOARD_ID, makeMockDb(), {
			bootSha: "aaaaaaaa",
			headSha: "bbbbbbbb",
		});
		expect(drift).toHaveProperty("_versionMismatch");
	});

	describe("_upgrade field (#210 PR-A)", () => {
		const checkedAt = new Date("2026-05-01T00:00:00.000Z").toISOString();

		it("emits _upgrade with commands when upgradeInfo is outdated", async () => {
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), {
				upgradeInfo: {
					current: "6.0.0",
					latest: "6.1.0",
					isOutdated: true,
					checkedAt,
				},
			});
			expect(payload._upgrade).toEqual({
				current: "6.0.0",
				latest: "6.1.0",
				isOutdated: true,
				commands: ["git pull", "npm run service:update"],
			});
		});

		it("omits _upgrade when upgradeInfo reports in-sync", async () => {
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), {
				upgradeInfo: {
					current: "6.1.0",
					latest: "6.1.0",
					isOutdated: false,
					checkedAt,
				},
			});
			expect(payload).not.toHaveProperty("_upgrade");
		});

		it("omits _upgrade when upgradeInfo is undefined", async () => {
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), {});
			expect(payload).not.toHaveProperty("_upgrade");
		});

		it("omits _upgrade when latest is null (offline / opt-out)", async () => {
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), {
				upgradeInfo: {
					current: "6.0.0",
					latest: null,
					isOutdated: false,
					checkedAt,
				},
			});
			expect(payload).not.toHaveProperty("_upgrade");
		});
	});

	describe("_upgradeReport field (#215)", () => {
		const completedAt = new Date("2026-05-01T22:00:00.000Z").toISOString();

		function makeReport(overrides: {
			fail?: number;
			warn?: number;
			pass?: number;
			skip?: number;
			checks?: Array<{
				name: string;
				status: "pass" | "fail" | "warn" | "skip";
				message: string;
				fix?: string;
			}>;
		}) {
			const summary = {
				pass: overrides.pass ?? 0,
				fail: overrides.fail ?? 0,
				warn: overrides.warn ?? 0,
				skip: overrides.skip ?? 0,
			};
			return {
				completedAt,
				targetVersion: "6.1.0",
				doctor: {
					summary,
					checks: overrides.checks ?? [],
				},
			};
		}

		it("emits _upgradeReport with only failed/warn checks when there are failures", async () => {
			const report = makeReport({
				fail: 1,
				pass: 7,
				checks: [
					{ name: "MCP registration", status: "pass", message: "ok" },
					{
						name: "Hook drift",
						status: "fail",
						message: "Stop hook missing.",
						fix: "Re-run `npm run setup`.",
					},
				],
			});
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), { upgradeReport: report });
			expect(payload._upgradeReport).toEqual({
				completedAt,
				targetVersion: "6.1.0",
				summary: { pass: 7, fail: 1, warn: 0, skip: 0 },
				failed: [
					{
						name: "Hook drift",
						status: "fail",
						message: "Stop hook missing.",
						fix: "Re-run `npm run setup`.",
					},
				],
			});
		});

		it("includes warn-status checks alongside fail-status checks", async () => {
			const report = makeReport({
				warn: 1,
				pass: 7,
				checks: [
					{ name: "WAL hygiene", status: "warn", message: "WAL >100MB." },
					{ name: "Other", status: "pass", message: "ok" },
				],
			});
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), { upgradeReport: report });
			expect((payload._upgradeReport as { failed: unknown[] }).failed).toHaveLength(1);
		});

		it("omits _upgradeReport when all checks pass", async () => {
			const report = makeReport({
				pass: 8,
				checks: [{ name: "X", status: "pass", message: "ok" }],
			});
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), { upgradeReport: report });
			expect(payload).not.toHaveProperty("_upgradeReport");
		});

		it("omits _upgradeReport when upgradeReport is undefined", async () => {
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), {});
			expect(payload).not.toHaveProperty("_upgradeReport");
		});

		it("omits the `fix` key when a check has none (no `fix: undefined` on the wire)", async () => {
			const report = makeReport({
				fail: 1,
				checks: [{ name: "Some check", status: "fail", message: "broken" }],
			});
			const payload = await buildBriefPayload(BOARD_ID, makeMockDb(), { upgradeReport: report });
			const failed = (payload._upgradeReport as { failed: Array<Record<string, unknown>> }).failed;
			expect(failed[0]).not.toHaveProperty("fix");
		});
	});

	it("throws when the board can't be loaded", async () => {
		const db = {
			board: { findUnique: vi.fn(async () => null) },
			claim: { findMany: vi.fn(async () => []) },
			activity: { findMany: vi.fn(async () => []) },
		} as unknown as Parameters<typeof buildBriefPayload>[1];
		await expect(buildBriefPayload(BOARD_ID, db)).rejects.toThrow(/not found/);
	});
});
