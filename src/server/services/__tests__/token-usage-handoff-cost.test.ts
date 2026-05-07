// Tests for the #292 service layer: `queryCostWindow` (generic primitive),
// `mapHandoffConfidence` (per-event signal → handoff label), and
// `getHandoffCost` (the first consumer wiring the two together).
//
// Coverage rationale:
//   - queryCostWindow: pin scope semantics — projectId baseline, agentName
//     narrow, cardId narrow (acceptance: equal-set for single-card session,
//     strictly smaller for multi-card window), and (from, to] window math
//     (exclusive lower / inclusive upper bound).
//   - mapHandoffConfidence: pure-function table — `attributed` beats
//     `estimated` beats `no-data`; mixed-signal rows pick the strongest.
//   - getHandoffCost: end-to-end window resolution. Boundary-locked first
//     handoff (windowStart null), subsequent handoff (windowStart =
//     prevHandoff.createdAt scoped by boardId), single-card narrowing,
//     multi-card fallback, and cross-board/cross-project isolation.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService, __testing__ } = await import("@/server/services/token-usage-service");
const { queryCostWindow, mapHandoffConfidence } = __testing__;

// ─── queryCostWindow — scope semantics ─────────────────────────────────

describe("queryCostWindow — scope", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000292";
	const OTHER_PROJECT_ID = "10000000-1000-4000-8000-1000000002ff";
	const BOARD_ID = "20000000-2000-4000-8000-200000000292";
	const COLUMN_ID = "30000000-3000-4000-8000-300000000292";
	const CARD_A = "40000000-4000-4000-8000-400000000292";
	const CARD_B = "40000000-4000-4000-8000-400000000293";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.createMany({
			data: [
				{ id: PROJECT_ID, name: "QCW", slug: "qcw" },
				{ id: OTHER_PROJECT_ID, name: "Other", slug: "other" },
			],
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Board" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.createMany({
			data: [
				{
					id: CARD_A,
					columnId: COLUMN_ID,
					projectId: PROJECT_ID,
					number: 1,
					title: "A",
					position: 0,
				},
				{
					id: CARD_B,
					columnId: COLUMN_ID,
					projectId: PROJECT_ID,
					number: 2,
					title: "B",
					position: 1,
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	async function seed(opts: {
		sessionId: string;
		projectId?: string;
		cardId?: string | null;
		agentName?: string;
		recordedAt?: Date;
		signal?: string | null;
	}) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: opts.projectId ?? PROJECT_ID,
				cardId: opts.cardId ?? null,
				agentName: opts.agentName ?? "claude-code",
				model: "claude-opus-4-7",
				inputTokens: 1000,
				outputTokens: 100,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: opts.recordedAt ?? new Date(),
				signal: opts.signal ?? null,
			},
		});
	}

	it("filters by projectId only when no other narrows are passed", async () => {
		await seed({ sessionId: "qcw-base-1", cardId: CARD_A });
		await seed({ sessionId: "qcw-base-2", cardId: CARD_B });
		await seed({ sessionId: "qcw-base-other", projectId: OTHER_PROJECT_ID });

		const rows = await queryCostWindow(testDb.prisma, { projectId: PROJECT_ID });
		const sessionIds = rows.map((r) => r.sessionId).sort();

		expect(sessionIds).toContain("qcw-base-1");
		expect(sessionIds).toContain("qcw-base-2");
		expect(sessionIds).not.toContain("qcw-base-other");
	});

	it("agentName narrow drops sibling agents", async () => {
		await seed({ sessionId: "qcw-agent-claude", agentName: "claude-code" });
		await seed({ sessionId: "qcw-agent-codex", agentName: "codex" });

		const rows = await queryCostWindow(testDb.prisma, {
			projectId: PROJECT_ID,
			agentName: "claude-code",
		});
		const sessions = new Set(rows.map((r) => r.sessionId));
		expect(sessions.has("qcw-agent-claude")).toBe(true);
		expect(sessions.has("qcw-agent-codex")).toBe(false);
	});

	it("cardId narrow returns equal set for single-card window, strictly smaller set for multi-card window", async () => {
		// Single-card window: a sibling session that touched only CARD_A. The
		// project+agent query and the cardId-narrowed query should agree.
		await seed({ sessionId: "qcw-narrow-single", agentName: "narrow-single", cardId: CARD_A });

		const fullSingle = await queryCostWindow(testDb.prisma, {
			projectId: PROJECT_ID,
			agentName: "narrow-single",
		});
		const narrowedSingle = await queryCostWindow(testDb.prisma, {
			projectId: PROJECT_ID,
			agentName: "narrow-single",
			cardId: CARD_A,
		});
		expect(narrowedSingle.length).toBe(fullSingle.length);
		expect(narrowedSingle.length).toBeGreaterThan(0);

		// Multi-card window: a single agentName covered both cards. Narrowing
		// to CARD_A must drop the CARD_B-attributed rows.
		await seed({ sessionId: "qcw-narrow-multi-a", agentName: "narrow-multi", cardId: CARD_A });
		await seed({ sessionId: "qcw-narrow-multi-b", agentName: "narrow-multi", cardId: CARD_B });

		const fullMulti = await queryCostWindow(testDb.prisma, {
			projectId: PROJECT_ID,
			agentName: "narrow-multi",
		});
		const narrowedMulti = await queryCostWindow(testDb.prisma, {
			projectId: PROJECT_ID,
			agentName: "narrow-multi",
			cardId: CARD_A,
		});
		expect(narrowedMulti.length).toBeLessThan(fullMulti.length);
		expect(narrowedMulti.every((r) => r.cardId === CARD_A)).toBe(true);
	});

	it("(from, to] window is exclusive on lower bound and inclusive on upper", async () => {
		const t0 = new Date("2026-01-01T10:00:00Z");
		const t1 = new Date("2026-01-01T10:00:01Z");
		const t2 = new Date("2026-01-01T10:00:02Z");
		const t3 = new Date("2026-01-01T10:00:03Z");

		await seed({ sessionId: "qcw-win-t0", agentName: "window-test", recordedAt: t0 });
		await seed({ sessionId: "qcw-win-t1", agentName: "window-test", recordedAt: t1 });
		await seed({ sessionId: "qcw-win-t2", agentName: "window-test", recordedAt: t2 });
		await seed({ sessionId: "qcw-win-t3", agentName: "window-test", recordedAt: t3 });

		const rows = await queryCostWindow(testDb.prisma, {
			projectId: PROJECT_ID,
			agentName: "window-test",
			from: t0,
			to: t2,
		});
		const sessions = new Set(rows.map((r) => r.sessionId));
		// t0 is excluded (gt), t2 is included (lte).
		expect(sessions.has("qcw-win-t0")).toBe(false);
		expect(sessions.has("qcw-win-t1")).toBe(true);
		expect(sessions.has("qcw-win-t2")).toBe(true);
		expect(sessions.has("qcw-win-t3")).toBe(false);
	});
});

// ─── mapHandoffConfidence — pure mapping ───────────────────────────────

describe("mapHandoffConfidence — signal rollup", () => {
	it("returns no-data for empty input", () => {
		expect(mapHandoffConfidence([])).toBe("no-data");
	});

	it("returns no-data when every signal is null or unattributed", () => {
		expect(
			mapHandoffConfidence([{ signal: null }, { signal: "unattributed" }, { signal: null }])
		).toBe("no-data");
	});

	it("returns estimated when any heuristic signal is present", () => {
		expect(mapHandoffConfidence([{ signal: "single-in-progress" }, { signal: null }])).toBe(
			"estimated"
		);
		expect(mapHandoffConfidence([{ signal: "session-recent-touch" }])).toBe("estimated");
		expect(mapHandoffConfidence([{ signal: "session-commit" }])).toBe("estimated");
	});

	it("returns attributed when any explicit signal is present, even mixed with weaker ones", () => {
		expect(
			mapHandoffConfidence([
				{ signal: "session-recent-touch" },
				{ signal: "explicit" },
				{ signal: null },
			])
		).toBe("attributed");
	});
});

// ─── getHandoffCost — end-to-end ───────────────────────────────────────

describe("getHandoffCost", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000400";
	const OTHER_PROJECT_ID = "10000000-1000-4000-8000-100000000401";
	const BOARD_ID = "20000000-2000-4000-8000-200000000400";
	const SIBLING_BOARD_ID = "20000000-2000-4000-8000-200000000401";
	const COLUMN_ID = "30000000-3000-4000-8000-300000000400";
	const CARD_A = "40000000-4000-4000-8000-400000000400";
	const CARD_B = "40000000-4000-4000-8000-400000000401";

	const T_FIRST = new Date("2026-02-01T08:00:00Z");
	const T_BETWEEN = new Date("2026-02-01T09:00:00Z");
	const T_SECOND = new Date("2026-02-01T10:00:00Z");
	const T_AFTER = new Date("2026-02-01T11:00:00Z");

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.createMany({
			data: [
				{ id: PROJECT_ID, name: "HC", slug: "hc" },
				{ id: OTHER_PROJECT_ID, name: "Other", slug: "other-hc" },
			],
		});
		await testDb.prisma.board.createMany({
			data: [
				{ id: BOARD_ID, projectId: PROJECT_ID, name: "Main" },
				{ id: SIBLING_BOARD_ID, projectId: PROJECT_ID, name: "Sibling" },
			],
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.createMany({
			data: [
				{
					id: CARD_A,
					columnId: COLUMN_ID,
					projectId: PROJECT_ID,
					number: 1,
					title: "A",
					position: 0,
				},
				{
					id: CARD_B,
					columnId: COLUMN_ID,
					projectId: PROJECT_ID,
					number: 2,
					title: "B",
					position: 1,
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	async function seedEvent(opts: {
		sessionId: string;
		recordedAt: Date;
		cardId?: string | null;
		signal?: string | null;
		agentName?: string;
		projectId?: string;
		inputTokens?: number;
	}) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: opts.projectId ?? PROJECT_ID,
				cardId: opts.cardId ?? null,
				agentName: opts.agentName ?? "claude-code",
				model: "claude-opus-4-7",
				inputTokens: opts.inputTokens ?? 1000,
				outputTokens: 100,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
				recordedAt: opts.recordedAt,
				signal: opts.signal ?? null,
			},
		});
	}

	async function createHandoff(opts: {
		boardId: string;
		createdAt: Date;
		workingOn: string[];
		agentName?: string;
	}) {
		const row = await testDb.prisma.handoff.create({
			data: {
				boardId: opts.boardId,
				projectId: PROJECT_ID,
				agentName: opts.agentName ?? "claude-code",
				summary: "test",
				workingOn: JSON.stringify(opts.workingOn),
				findings: "[]",
				nextSteps: "[]",
				blockers: "[]",
				createdAt: opts.createdAt,
			},
		});
		return row.id;
	}

	it("first handoff has windowStart=null and includes every prior event", async () => {
		await seedEvent({
			sessionId: "hc-first-pre",
			recordedAt: new Date("2026-01-31T23:00:00Z"),
			cardId: CARD_A,
			signal: "explicit",
		});
		const handoffId = await createHandoff({
			boardId: BOARD_ID,
			createdAt: T_FIRST,
			workingOn: [CARD_A],
		});

		const result = await tokenUsageService.getHandoffCost(handoffId);
		if (!result.success) throw new Error("expected success");

		expect(result.data.windowStart).toBeNull();
		expect(result.data.windowEnd).toEqual(T_FIRST);
		expect(result.data.cardScoped).toBe(true);
		expect(result.data.eventCount).toBeGreaterThanOrEqual(1);
		expect(result.data.confidence).toBe("attributed");
	});

	it("subsequent handoff opens window at prevHandoff.createdAt (exclusive)", async () => {
		await seedEvent({
			sessionId: "hc-second-in-window",
			recordedAt: T_BETWEEN,
			cardId: CARD_A,
			signal: "single-in-progress",
		});
		// Boundary event recorded exactly at prevHandoff time — must be
		// excluded by the (from, to] semantics.
		await seedEvent({
			sessionId: "hc-second-on-boundary",
			recordedAt: T_FIRST,
			cardId: CARD_A,
			signal: "explicit",
			inputTokens: 999_999, // distinguishable size
		});
		const handoffId = await createHandoff({
			boardId: BOARD_ID,
			createdAt: T_SECOND,
			workingOn: [CARD_A],
		});

		const result = await tokenUsageService.getHandoffCost(handoffId);
		if (!result.success) throw new Error("expected success");

		expect(result.data.windowStart).toEqual(T_FIRST);
		expect(result.data.windowEnd).toEqual(T_SECOND);
		// Boundary row (sessionId hc-second-on-boundary, 999_999 input tokens)
		// must not appear in the rollup.
		expect(result.data.inputTokens).toBeLessThan(999_999);
		// In-window row signal was 'single-in-progress' (heuristic).
		expect(result.data.confidence).toBe("estimated");
	});

	it("multi-card workingOn falls back to project+agent scope (cardScoped=false)", async () => {
		// Seed a future window with both cards' rows.
		await seedEvent({
			sessionId: "hc-multi-a",
			recordedAt: new Date("2026-02-01T10:30:00Z"),
			cardId: CARD_A,
			signal: "explicit",
		});
		await seedEvent({
			sessionId: "hc-multi-b",
			recordedAt: new Date("2026-02-01T10:45:00Z"),
			cardId: CARD_B,
			signal: "explicit",
		});
		const handoffId = await createHandoff({
			boardId: BOARD_ID,
			createdAt: T_AFTER,
			workingOn: [CARD_A, CARD_B],
		});

		const result = await tokenUsageService.getHandoffCost(handoffId);
		if (!result.success) throw new Error("expected success");

		expect(result.data.cardScoped).toBe(false);
		// Both card rows should be summed.
		const sessions = result.data.sessionCount;
		expect(sessions).toBeGreaterThanOrEqual(2);
	});

	it("sibling board's prior handoff does NOT close this board's window", async () => {
		// Fresh test scope: spread events across boards under the same project.
		const otherTestDb = await createTestDb();
		dbRef.current = otherTestDb.prisma;
		try {
			await otherTestDb.prisma.project.create({
				data: { id: PROJECT_ID, name: "HCB", slug: "hcb" },
			});
			await otherTestDb.prisma.board.createMany({
				data: [
					{ id: BOARD_ID, projectId: PROJECT_ID, name: "Main" },
					{ id: SIBLING_BOARD_ID, projectId: PROJECT_ID, name: "Sibling" },
				],
			});

			const tSibling = new Date("2026-02-02T08:00:00Z");
			const tMain = new Date("2026-02-02T10:00:00Z");
			const tEvent = new Date("2026-02-02T07:00:00Z");

			await otherTestDb.prisma.tokenUsageEvent.create({
				data: {
					sessionId: "hc-cross-board-event",
					projectId: PROJECT_ID,
					cardId: null,
					agentName: "claude-code",
					model: "claude-opus-4-7",
					inputTokens: 1000,
					outputTokens: 100,
					cacheReadTokens: 0,
					cacheCreation1hTokens: 0,
					cacheCreation5mTokens: 0,
					recordedAt: tEvent,
					signal: "session-recent-touch",
				},
			});

			// Sibling-board handoff lands BEFORE the event we want to count.
			// If `getHandoffCost` keyed off `projectId` for the prevHandoff
			// lookup, it would squeeze the window past the event and undercount.
			await otherTestDb.prisma.handoff.create({
				data: {
					boardId: SIBLING_BOARD_ID,
					projectId: PROJECT_ID,
					agentName: "claude-code",
					summary: "sibling",
					workingOn: "[]",
					findings: "[]",
					nextSteps: "[]",
					blockers: "[]",
					createdAt: tSibling,
				},
			});
			const main = await otherTestDb.prisma.handoff.create({
				data: {
					boardId: BOARD_ID,
					projectId: PROJECT_ID,
					agentName: "claude-code",
					summary: "main",
					workingOn: "[]",
					findings: "[]",
					nextSteps: "[]",
					blockers: "[]",
					createdAt: tMain,
				},
			});

			const result = await tokenUsageService.getHandoffCost(main.id);
			if (!result.success) throw new Error("expected success");
			expect(result.data.windowStart).toBeNull();
			expect(result.data.eventCount).toBe(1);
		} finally {
			dbRef.current = null;
			await otherTestDb.cleanup();
			dbRef.current = testDb.prisma;
		}
	});
});
