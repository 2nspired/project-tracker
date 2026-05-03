// @vitest-environment node
/**
 * Tests for the shared board-audit factory (#173).
 *
 * Each of the 5 hygiene-signal helpers gets its own block:
 *   - `findMissingTags`         — cards with zero tags, Done/Parking excluded
 *   - `findNoPriorityBacklog`   — Backlog-role cards with priority=NONE
 *   - `findOverdueMilestones`   — active + targetDate < now
 *   - `findTaxonomyDrift`       — single-use + Levenshtein-≤2 near-miss pairs
 *   - `findStaleDecisions`      — 30d activity but no decision in 60d
 *
 * Plus a smoke test on the legacy `auditBoard` entry point — it backs the
 * MCP `auditBoard` extended tool and its response shape is FROZEN.
 *
 * Strategy: each helper reads from a small set of Prisma surfaces; we
 * hand-build a duck-typed mock prisma per test the same way
 * `staleness.test.ts` does. No sqlite fixture, no real I/O.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing__, createBoardAuditService } from "@/lib/services/board-audit";

const NOW = new Date("2026-05-02T12:00:00Z");
const DAY = 1000 * 60 * 60 * 24;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * DAY);
}

// ─── Pure helpers (exposed via __testing__) ──────────────────────────

describe("findNearMissPairs — pure helper", () => {
	it("finds the canonical typo pair (`feature` / `feauture`)", () => {
		const pairs = __testing__.findNearMissPairs([
			{ tagId: "t1", slug: "feature", label: "feature" },
			{ tagId: "t2", slug: "feauture", label: "feauture" },
			{ tagId: "t3", slug: "bug", label: "bug" },
		]);
		expect(pairs).toHaveLength(1);
		expect(pairs[0].a.slug).toBe("feature");
		expect(pairs[0].b.slug).toBe("feauture");
		expect(pairs[0].distance).toBeLessThanOrEqual(2);
	});

	it("returns each pair only once (i,j with i<j)", () => {
		const pairs = __testing__.findNearMissPairs([
			{ tagId: "t1", slug: "ux", label: "ux" },
			{ tagId: "t2", slug: "ui", label: "ui" },
			{ tagId: "t3", slug: "us", label: "us" },
		]);
		// All three within distance 1 — C(3,2)=3 pairs.
		expect(pairs).toHaveLength(3);
	});

	it("skips empty slugs (defensive — shouldn't happen but the data layer can fail)", () => {
		const pairs = __testing__.findNearMissPairs([
			{ tagId: "t1", slug: "", label: "" },
			{ tagId: "t2", slug: "ui", label: "ui" },
		]);
		expect(pairs).toHaveLength(0);
	});

	it("excludes pairs with distance > 2", () => {
		const pairs = __testing__.findNearMissPairs([
			{ tagId: "t1", slug: "frontend", label: "frontend" },
			{ tagId: "t2", slug: "backend", label: "backend" },
		]);
		// edit distance = 4 (front→back) — excluded.
		expect(pairs).toHaveLength(0);
	});
});

describe("isStaleDecisionProject — pure helper", () => {
	it("flags project with 30d activity and no decision ever", () => {
		const stale = __testing__.isStaleDecisionProject({
			now: NOW,
			lastActivityAt: daysAgo(5),
			lastDecisionAt: null,
		});
		expect(stale).toBe(true);
	});

	it("flags project with 30d activity and last decision >60d ago", () => {
		const stale = __testing__.isStaleDecisionProject({
			now: NOW,
			lastActivityAt: daysAgo(5),
			lastDecisionAt: daysAgo(70),
		});
		expect(stale).toBe(true);
	});

	it("does NOT flag project with no recent activity (paused, not drifting)", () => {
		const stale = __testing__.isStaleDecisionProject({
			now: NOW,
			lastActivityAt: daysAgo(60),
			lastDecisionAt: null,
		});
		expect(stale).toBe(false);
	});

	it("does NOT flag project with recent activity AND a recent decision", () => {
		const stale = __testing__.isStaleDecisionProject({
			now: NOW,
			lastActivityAt: daysAgo(5),
			lastDecisionAt: daysAgo(20),
		});
		expect(stale).toBe(false);
	});

	it("respects custom window overrides", () => {
		// 14d activity window, 30d decision window — tighter than defaults.
		const stale = __testing__.isStaleDecisionProject({
			now: NOW,
			lastActivityAt: daysAgo(7),
			lastDecisionAt: daysAgo(45),
			activityWindowDays: 14,
			decisionWindowDays: 30,
		});
		expect(stale).toBe(true);
	});
});

// ─── findMissingTags ─────────────────────────────────────────────────

describe("findMissingTags", () => {
	it("returns only cards in non-Done/Parking columns with zero CardTag rows", async () => {
		const db = {
			card: {
				findMany: vi.fn(async () => [
					{
						id: "c1",
						number: 1,
						title: "Tagless backlog card",
						projectId: "p1",
						project: { name: "Pigeon" },
						column: { name: "Backlog", role: "backlog", boardId: "b1" },
					},
					{
						id: "c2",
						number: 2,
						title: "Done card — should be filtered",
						projectId: "p1",
						project: { name: "Pigeon" },
						column: { name: "Done", role: "done", boardId: "b1" },
					},
					{
						id: "c3",
						number: 3,
						title: "In progress untagged",
						projectId: "p1",
						project: { name: "Pigeon" },
						column: { name: "In Progress", role: "active", boardId: "b1" },
					},
				]),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;

		const svc = createBoardAuditService(db);
		const result = await svc.findMissingTags();
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.count).toBe(2);
		expect(result.data.cards.map((c) => c.cardId)).toEqual(["c1", "c3"]);
	});

	it("threads projectId through to the prisma query when provided", async () => {
		const findMany = vi.fn(async (_args?: { where?: { projectId?: string } }) => [] as unknown[]);
		// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		const db = { card: { findMany } } as any;
		const svc = createBoardAuditService(db);
		await svc.findMissingTags({ projectId: "p-scope" });
		expect(findMany).toHaveBeenCalledTimes(1);
		const arg = findMany.mock.calls[0]?.[0];
		expect(arg?.where?.projectId).toBe("p-scope");
	});
});

// ─── findNoPriorityBacklog ───────────────────────────────────────────

describe("findNoPriorityBacklog", () => {
	it("returns ONLY Backlog-role cards with priority=NONE", async () => {
		const db = {
			card: {
				findMany: vi.fn(async () => [
					{
						id: "c1",
						number: 1,
						title: "Untriaged backlog",
						projectId: "p1",
						project: { name: "Pigeon" },
						column: { name: "Backlog", role: "backlog", boardId: "b1" },
					},
					{
						id: "c2",
						number: 2,
						title: "NONE-priority In Progress — outside scope",
						projectId: "p1",
						project: { name: "Pigeon" },
						column: { name: "In Progress", role: "active", boardId: "b1" },
					},
					{
						id: "c3",
						number: 3,
						title: "Backlog by name fallback",
						projectId: "p1",
						project: { name: "Pigeon" },
						column: { name: "Backlog", role: null, boardId: "b1" },
					},
				]),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;

		const svc = createBoardAuditService(db);
		const result = await svc.findNoPriorityBacklog();
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.cards.map((c) => c.cardId)).toEqual(["c1", "c3"]);
	});
});

// ─── findOverdueMilestones ───────────────────────────────────────────

describe("findOverdueMilestones", () => {
	it("returns active milestones with targetDate < now plus open-card count", async () => {
		const db = {
			milestone: {
				findMany: vi.fn(async () => [
					{
						id: "m1",
						name: "v6.3",
						targetDate: daysAgo(7),
						projectId: "p1",
						project: { name: "Pigeon" },
						cards: [
							{ column: { role: "backlog", name: "Backlog" } },
							{ column: { role: "done", name: "Done" } },
							{ column: { role: "active", name: "In Progress" } },
						],
					},
				]),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;

		const svc = createBoardAuditService(db);
		const result = await svc.findOverdueMilestones({ now: NOW });
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.count).toBe(1);
		expect(result.data.milestones[0].overdueDays).toBe(7);
		expect(result.data.milestones[0].openCardCount).toBe(2); // backlog + active; done excluded
	});

	it("filters out milestones with null targetDate (defensive — query also filters)", async () => {
		const db = {
			milestone: {
				findMany: vi.fn(async () => [
					{
						id: "m1",
						name: "Untimed",
						targetDate: null,
						projectId: "p1",
						project: { name: "Pigeon" },
						cards: [],
					},
				]),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;
		const svc = createBoardAuditService(db);
		const result = await svc.findOverdueMilestones({ now: NOW });
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.count).toBe(0);
	});
});

// ─── findTaxonomyDrift ───────────────────────────────────────────────

describe("findTaxonomyDrift", () => {
	it("finds the example pair `feature` / `feauture` AND single-use tags", async () => {
		const db = {
			tag: {
				findMany: vi.fn(async () => [
					{
						id: "t1",
						slug: "feature",
						label: "feature",
						projectId: "p1",
						project: { name: "Pigeon" },
						_count: { cardTags: 12 },
					},
					{
						id: "t2",
						slug: "feauture",
						label: "feauture",
						projectId: "p1",
						project: { name: "Pigeon" },
						_count: { cardTags: 1 }, // also single-use
					},
					{
						id: "t3",
						slug: "infra",
						label: "infra",
						projectId: "p1",
						project: { name: "Pigeon" },
						_count: { cardTags: 5 },
					},
				]),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;

		const svc = createBoardAuditService(db);
		const result = await svc.findTaxonomyDrift();
		expect(result.success).toBe(true);
		if (!result.success) return;

		// Near-miss includes the canonical example pair.
		const pair = result.data.nearMissTagPairs.find(
			(p) =>
				(p.a.slug === "feature" && p.b.slug === "feauture") ||
				(p.a.slug === "feauture" && p.b.slug === "feature")
		);
		expect(pair).toBeDefined();
		expect(pair?.distance).toBeLessThanOrEqual(2);

		// Single-use list contains the typo tag.
		expect(result.data.singleUseTags.map((t) => t.slug)).toContain("feauture");

		// count = singleUseTags.length + nearMissTagPairs.length
		expect(result.data.count).toBe(
			result.data.singleUseTags.length + result.data.nearMissTagPairs.length
		);
	});

	it("never pairs tags across projects (slugs aren't globally unique)", async () => {
		const db = {
			tag: {
				findMany: vi.fn(async () => [
					{
						id: "t1",
						slug: "ui",
						label: "ui",
						projectId: "p1",
						project: { name: "P1" },
						_count: { cardTags: 5 },
					},
					{
						id: "t2",
						slug: "ux",
						label: "ux",
						projectId: "p2",
						project: { name: "P2" },
						_count: { cardTags: 5 },
					},
				]),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;
		const svc = createBoardAuditService(db);
		const result = await svc.findTaxonomyDrift();
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.nearMissTagPairs).toHaveLength(0);
	});
});

// ─── findStaleDecisions ──────────────────────────────────────────────

describe("findStaleDecisions", () => {
	it("flags project with 30d activity and no decision in 60d", async () => {
		const project = { id: "p1", name: "Pigeon", updatedAt: daysAgo(60) };
		const db = {
			project: { findMany: vi.fn(async () => [project]) },
			card: {
				findMany: vi.fn(async () => []), // no cards → cardToProject empty (only project.updatedAt + groupBy seed activity)
				groupBy: vi.fn(async () => [{ projectId: "p1", _max: { updatedAt: daysAgo(5) } }]),
			},
			comment: { groupBy: vi.fn(async () => []) },
			activity: { groupBy: vi.fn(async () => []) },
			handoff: { groupBy: vi.fn(async () => []) },
			claim: {
				groupBy: vi.fn(async (args: { where?: { kind?: string } }) => {
					// Two queries hit `claim.groupBy`: the activity rollup (no `kind`)
					// and the decision-only rollup (kind='decision'). Distinguish by
					// the where clause.
					if (args.where?.kind === "decision") {
						return []; // no decisions ever
					}
					return [{ projectId: "p1", _max: { updatedAt: daysAgo(5) } }];
				}),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;

		const svc = createBoardAuditService(db);
		const result = await svc.findStaleDecisions({ now: NOW });
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.count).toBe(1);
		expect(result.data.projects[0].projectId).toBe("p1");
		expect(result.data.projects[0].lastDecisionAt).toBeNull();
	});

	it("does NOT flag project with recent decision", async () => {
		const project = { id: "p1", name: "Pigeon", updatedAt: daysAgo(60) };
		const db = {
			project: { findMany: vi.fn(async () => [project]) },
			card: {
				findMany: vi.fn(async () => []),
				groupBy: vi.fn(async () => [{ projectId: "p1", _max: { updatedAt: daysAgo(5) } }]),
			},
			comment: { groupBy: vi.fn(async () => []) },
			activity: { groupBy: vi.fn(async () => []) },
			handoff: { groupBy: vi.fn(async () => []) },
			claim: {
				groupBy: vi.fn(async (args: { where?: { kind?: string } }) => {
					if (args.where?.kind === "decision") {
						return [{ projectId: "p1", _max: { createdAt: daysAgo(20) } }];
					}
					return [{ projectId: "p1", _max: { updatedAt: daysAgo(5) } }];
				}),
			},
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;

		const svc = createBoardAuditService(db);
		const result = await svc.findStaleDecisions({ now: NOW });
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.count).toBe(0);
	});

	it("does NOT flag inactive project (paused, not drifting)", async () => {
		const project = { id: "p1", name: "Stale", updatedAt: daysAgo(120) };
		const db = {
			project: { findMany: vi.fn(async () => [project]) },
			card: {
				findMany: vi.fn(async () => []),
				groupBy: vi.fn(async () => []),
			},
			comment: { groupBy: vi.fn(async () => []) },
			activity: { groupBy: vi.fn(async () => []) },
			handoff: { groupBy: vi.fn(async () => []) },
			claim: { groupBy: vi.fn(async () => []) },
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;
		const svc = createBoardAuditService(db);
		const result = await svc.findStaleDecisions({ now: NOW });
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.count).toBe(0);
	});
});

// ─── auditBoard (legacy MCP entry) ───────────────────────────────────

describe("auditBoard — preserves the MCP response shape", () => {
	it("returns the locked top-level keys agent callers depend on", async () => {
		const db = {
			board: {
				findUnique: vi.fn(async () => ({
					projectId: "p1",
					columns: [
						{
							name: "Backlog",
							role: "backlog",
							isParking: false,
							cards: [
								{
									id: "c1",
									number: 1,
									title: "Tagless",
									priority: "NONE",
									checklists: [],
									milestone: null,
									cardTags: [],
								},
							],
						},
						{
							name: "Done",
							role: "done",
							isParking: false,
							cards: [
								{
									id: "c-done",
									number: 99,
									title: "Done",
									priority: "HIGH",
									checklists: [{ id: "ck1" }],
									milestone: { name: "v6.2" },
									cardTags: [{ tagId: "t1" }],
								},
							],
						},
					],
				})),
			},
			tag: { findMany: vi.fn(async () => []) },
			milestone: { findMany: vi.fn(async () => []) },
			column: { findMany: vi.fn(async () => []) }, // findStaleInProgress
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;

		const svc = createBoardAuditService(db);
		const result = await svc.auditBoard("b1");
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Locked top-level keys — these are the FROZEN MCP API.
		expect(result.data).toHaveProperty("totalCards");
		expect(result.data).toHaveProperty("healthScore");
		expect(result.data).toHaveProperty("scoring.weights");
		expect(result.data).toHaveProperty("scoring.perDimension");
		expect(result.data).toHaveProperty("missingPriority.count");
		expect(result.data).toHaveProperty("missingTags.count");
		expect(result.data).toHaveProperty("noMilestone.count");
		expect(result.data).toHaveProperty("emptyChecklist.count");
		expect(result.data).toHaveProperty("staleInProgress.count");
		expect(result.data).toHaveProperty("taxonomy.singleUseTags.count");
		expect(result.data).toHaveProperty("taxonomy.nearMissTags.count");
		expect(result.data).toHaveProperty("taxonomy.staleActiveMilestones.count");
		// Done column excluded ⇒ totalCards = 1 (Backlog only).
		expect(result.data.totalCards).toBe(1);
	});

	it("returns NOT_FOUND when the board doesn't exist", async () => {
		const db = {
			board: { findUnique: vi.fn(async () => null) },
			// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma for tests
		} as any;
		const svc = createBoardAuditService(db);
		const result = await svc.auditBoard("missing");
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.code).toBe("NOT_FOUND");
	});
});
