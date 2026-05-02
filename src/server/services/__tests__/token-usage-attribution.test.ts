// Integration tests for the Attribution Engine wiring (#269).
//
// Covers `recordManual` and `recordFromTranscript` end-to-end against a
// real SQLite fixture so the column.role join (single-In-Progress
// resolution) and the snapshot/restore interaction with fresh attribution
// are both exercised. The pure attribute() function and the snapshot
// builder have their own focused unit tests under
// `src/lib/services/__tests__/`.
//
// Existing T4b in `token-usage-service.test.ts` covers the
// preserve-on-re-run behavior when the transcript has no card context
// AND no In-Progress card exists — that case still passes after #269 and
// is left in place. The two re-run tests below add #269-specific
// assertions: (a) fresh single-In-Progress overrides a preserved cardId
// (the v6.3 acceptance win), (b) multi-In-Progress short-circuits cleanly
// without losing prior attribution.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { tokenUsageService } = await import("@/server/services/token-usage-service");

// ─── recordManual ──────────────────────────────────────────────────

describe("recordManual — Attribution Engine wiring", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000269";
	const BOARD_ID = "20000000-2000-4000-8000-200000000269";
	const TODO_COL_ID = "30000000-3000-4000-8000-300000000a69";
	const ACTIVE_COL_ID = "30000000-3000-4000-8000-300000000b69";
	const ACTIVE_COL_2_ID = "30000000-3000-4000-8000-300000000c69";
	const TODO_CARD_ID = "40000000-4000-4000-8000-400000000a69";
	const ACTIVE_CARD_ID = "40000000-4000-4000-8000-400000000b69";
	const ACTIVE_CARD_2_ID = "40000000-4000-4000-8000-400000000c69";
	const EXPLICIT_CARD_ID = "40000000-4000-4000-8000-400000000d69";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Test #269", slug: "test-269" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Test board" },
		});
		await testDb.prisma.column.create({
			data: { id: TODO_COL_ID, boardId: BOARD_ID, name: "Todo", position: 0, role: "todo" },
		});
		await testDb.prisma.column.create({
			data: {
				id: ACTIVE_COL_ID,
				boardId: BOARD_ID,
				name: "In Progress",
				position: 1,
				role: "active",
			},
		});
		await testDb.prisma.column.create({
			data: {
				id: ACTIVE_COL_2_ID,
				boardId: BOARD_ID,
				name: "In Review",
				position: 2,
				role: "active",
			},
		});
		await testDb.prisma.card.createMany({
			data: [
				{
					id: TODO_CARD_ID,
					columnId: TODO_COL_ID,
					projectId: PROJECT_ID,
					number: 1,
					title: "Todo card",
					position: 0,
				},
				{
					id: EXPLICIT_CARD_ID,
					columnId: TODO_COL_ID,
					projectId: PROJECT_ID,
					number: 2,
					title: "Explicit-target card",
					position: 1,
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	async function readRow(sessionId: string) {
		return testDb.prisma.tokenUsageEvent.findFirst({
			where: { sessionId },
			select: { cardId: true, signal: true, signalConfidence: true },
		});
	}

	it("explicit input.cardId → signal=`explicit`, confidence=`high` (no In-Progress query needed)", async () => {
		const session = "manual-explicit";
		const result = await tokenUsageService.recordManual({
			projectId: PROJECT_ID,
			sessionId: session,
			cardId: EXPLICIT_CARD_ID,
			model: "claude-opus-4-7",
			inputTokens: 100,
			outputTokens: 50,
		});
		expect(result.success).toBe(true);

		const row = await readRow(session);
		expect(row?.cardId).toBe(EXPLICIT_CARD_ID);
		expect(row?.signal).toBe("explicit");
		expect(row?.signalConfidence).toBe("high");
	});

	it("single In-Progress card on the board → signal=`single-in-progress`, cardId attributed", async () => {
		// Move ACTIVE_CARD_ID into the active-role column so it's the only
		// In-Progress card.
		await testDb.prisma.card.create({
			data: {
				id: ACTIVE_CARD_ID,
				columnId: ACTIVE_COL_ID,
				projectId: PROJECT_ID,
				number: 3,
				title: "Single active card",
				position: 0,
			},
		});

		const session = "manual-single-active";
		const result = await tokenUsageService.recordManual({
			projectId: PROJECT_ID,
			sessionId: session,
			model: "claude-opus-4-7",
			inputTokens: 200,
			outputTokens: 100,
		});
		expect(result.success).toBe(true);

		const row = await readRow(session);
		expect(row?.cardId).toBe(ACTIVE_CARD_ID);
		expect(row?.signal).toBe("single-in-progress");
		expect(row?.signalConfidence).toBe("high");
	});

	it("multi-In-Progress → cardId=null, signal=`unattributed` (orchestrator gate)", async () => {
		// Add a second active-column card. Two In-Progress cards on the same
		// project ⇒ orchestrator-mode gate fires.
		await testDb.prisma.card.create({
			data: {
				id: ACTIVE_CARD_2_ID,
				columnId: ACTIVE_COL_2_ID,
				projectId: PROJECT_ID,
				number: 4,
				title: "Second active card",
				position: 0,
			},
		});

		const session = "manual-multi-active";
		const result = await tokenUsageService.recordManual({
			projectId: PROJECT_ID,
			sessionId: session,
			model: "claude-opus-4-7",
			inputTokens: 50,
			outputTokens: 25,
		});
		expect(result.success).toBe(true);

		const row = await readRow(session);
		expect(row?.cardId).toBeNull();
		expect(row?.signal).toBe("unattributed");
		expect(row?.signalConfidence).toBeNull();
	});
});

// ─── recordFromTranscript ──────────────────────────────────────────

describe("recordFromTranscript — Attribution Engine wiring", () => {
	let testDb: TestDb;
	let tmpDir: string;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000270";
	const BOARD_ID = "20000000-2000-4000-8000-200000000270";
	const TODO_COL_ID = "30000000-3000-4000-8000-300000000a70";
	const ACTIVE_COL_ID = "30000000-3000-4000-8000-300000000b70";
	const ACTIVE_COL_2_ID = "30000000-3000-4000-8000-300000000c70";
	const PRIOR_CARD_ID = "40000000-4000-4000-8000-400000000a70";
	const FRESH_ACTIVE_CARD_ID = "40000000-4000-4000-8000-400000000b70";
	const SECOND_ACTIVE_CARD_ID = "40000000-4000-4000-8000-400000000c70";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;
		tmpDir = mkdtempSync(path.join(tmpdir(), "pigeon-269-"));

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Test #269 transcript", slug: "test-269-tx" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Test board" },
		});
		await testDb.prisma.column.create({
			data: { id: TODO_COL_ID, boardId: BOARD_ID, name: "Todo", position: 0, role: "todo" },
		});
		await testDb.prisma.column.create({
			data: {
				id: ACTIVE_COL_ID,
				boardId: BOARD_ID,
				name: "In Progress",
				position: 1,
				role: "active",
			},
		});
		await testDb.prisma.column.create({
			data: {
				id: ACTIVE_COL_2_ID,
				boardId: BOARD_ID,
				name: "In Review",
				position: 2,
				role: "active",
			},
		});
		await testDb.prisma.card.create({
			data: {
				id: PRIOR_CARD_ID,
				columnId: TODO_COL_ID,
				projectId: PROJECT_ID,
				number: 1,
				title: "Prior card",
				position: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeTranscript(name: string, lines: object[]): string {
		const p = path.join(tmpDir, name);
		writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
		return p;
	}

	const minimalTranscript = [
		{
			message: {
				role: "assistant",
				model: "claude-opus-4-7",
				usage: { input_tokens: 100, output_tokens: 50 },
			},
		},
	];

	it("re-run with fresh single-In-Progress overrides a preserved (stale) cardId", async () => {
		// This is the v6.3 acceptance win: when the agent moves a card to
		// In-Progress between the original Stop-hook fire and a re-run, the
		// re-run picks up the fresh attribution instead of restoring the old
		// one. Pre-#269 this would silently restore PRIOR_CARD_ID.
		const session = "tx-fresh-overrides-stale";
		const transcriptPath = writeTranscript("tx1.jsonl", minimalTranscript);

		// 1. Initial Stop-hook fire (no In-Progress yet) → unattributed.
		await tokenUsageService.recordFromTranscript({
			projectId: PROJECT_ID,
			sessionId: session,
			transcriptPath,
		});
		// 2. Old attributeSession write to PRIOR_CARD_ID.
		await tokenUsageService.attributeSession(session, PRIOR_CARD_ID);
		const beforeRerun = await testDb.prisma.tokenUsageEvent.findFirst({
			where: { sessionId: session },
			select: { cardId: true, signal: true },
		});
		expect(beforeRerun?.cardId).toBe(PRIOR_CARD_ID);

		// 3. Agent moves a card to In-Progress.
		await testDb.prisma.card.create({
			data: {
				id: FRESH_ACTIVE_CARD_ID,
				columnId: ACTIVE_COL_ID,
				projectId: PROJECT_ID,
				number: 2,
				title: "Fresh active card",
				position: 0,
			},
		});

		// 4. Stop-hook re-runs → fresh `single-in-progress` wins.
		await tokenUsageService.recordFromTranscript({
			projectId: PROJECT_ID,
			sessionId: session,
			transcriptPath,
		});
		const afterRerun = await testDb.prisma.tokenUsageEvent.findFirst({
			where: { sessionId: session },
			select: { cardId: true, signal: true, signalConfidence: true },
		});
		expect(afterRerun?.cardId).toBe(FRESH_ACTIVE_CARD_ID);
		expect(afterRerun?.signal).toBe("single-in-progress");
		expect(afterRerun?.signalConfidence).toBe("high");
	});

	it("re-run with multi-In-Progress preserves prior cardId (orchestrator gate doesn't drop attribution)", async () => {
		// A different active card is added so we're now in multi-In-Progress
		// territory. Fresh attribution returns null. The preserve logic
		// must restore the prior cardId rather than letting it regress.
		const session = "tx-multi-preserves";
		const transcriptPath = writeTranscript("tx2.jsonl", minimalTranscript);

		await tokenUsageService.recordFromTranscript({
			projectId: PROJECT_ID,
			sessionId: session,
			transcriptPath,
		});
		await tokenUsageService.attributeSession(session, PRIOR_CARD_ID);

		// Now there are TWO In-Progress cards (FRESH_ACTIVE_CARD_ID from
		// the previous test + this new one). Multi-In-Progress short-circuits
		// to unattributed.
		await testDb.prisma.card.create({
			data: {
				id: SECOND_ACTIVE_CARD_ID,
				columnId: ACTIVE_COL_2_ID,
				projectId: PROJECT_ID,
				number: 3,
				title: "Second active card",
				position: 0,
			},
		});

		await tokenUsageService.recordFromTranscript({
			projectId: PROJECT_ID,
			sessionId: session,
			transcriptPath,
		});
		const after = await testDb.prisma.tokenUsageEvent.findFirst({
			where: { sessionId: session },
			select: { cardId: true, signal: true },
		});
		// cardId restored to the prior attribution; signal honestly reports
		// that the FRESH attribution attempt was unattributed (the column
		// telemetry is about the engine's decision, not the row's final
		// cardId state).
		expect(after?.cardId).toBe(PRIOR_CARD_ID);
		expect(after?.signal).toBe("unattributed");
	});
});
