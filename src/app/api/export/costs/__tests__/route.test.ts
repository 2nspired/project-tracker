// Tests for the Costs export Route Handler (#136).
//
// Spans both shapes a Route Handler exposes:
//   - HTTP-level: query-string validation (malformed projectId → 400),
//     headers (`Content-Type`, `Content-Disposition`), filename pattern.
//   - Body-level: CSV preamble + RFC 4180 quoting; Markdown preamble +
//     GFM table; empty-data behavior surfaces a "no shipped cards yet"
//     line in the summary while CSV stays headers-only.
//
// We mount the same DB-backed fixture the service tests use so the route
// runs against a real SQLite + Prisma stack — no mocking of
// `getCardDeliveryMetrics`, since the value of an integration test here
// is catching drift between the service shape and the serializer.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

const { GET } = await import("@/app/api/export/costs/route");

describe("GET /api/export/costs", () => {
	let testDb: TestDb;

	const PROJECT_ID = "80000000-8000-4000-8000-800000000136";
	const BOARD_ID = "80000000-8000-4000-8000-800000000137";
	const TODO_COL = "80000000-8000-4000-8000-80000000a136";
	const DONE_COL = "80000000-8000-4000-8000-80000000b136";
	const TODO_CARD = "80000000-8000-4000-8000-80000000a137";
	const DONE_CARD_A = "80000000-8000-4000-8000-80000000b137";
	const DONE_CARD_B = "80000000-8000-4000-8000-80000000b138";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Acme & Co — Billable", slug: "acme-co" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Main" },
		});
		await testDb.prisma.column.createMany({
			data: [
				{ id: TODO_COL, boardId: BOARD_ID, name: "Todo", position: 0, role: "todo" },
				{ id: DONE_COL, boardId: BOARD_ID, name: "Done", position: 1, role: "done" },
			],
		});
		await testDb.prisma.card.createMany({
			data: [
				{
					id: TODO_CARD,
					columnId: TODO_COL,
					projectId: PROJECT_ID,
					number: 1,
					title: 'Card with, comma and "quotes"',
					position: 0,
				},
				{
					id: DONE_CARD_A,
					columnId: DONE_COL,
					projectId: PROJECT_ID,
					number: 2,
					title: "Shipped card A",
					position: 0,
				},
				{
					id: DONE_CARD_B,
					columnId: DONE_COL,
					projectId: PROJECT_ID,
					number: 3,
					title: "Shipped card B",
					position: 1,
				},
			],
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	async function clearRows() {
		await testDb.prisma.tokenUsageEvent.deleteMany({ where: { projectId: PROJECT_ID } });
	}

	async function seedRow(opts: { sessionId: string; cardId: string; outputTokens?: number }) {
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: opts.sessionId,
				projectId: PROJECT_ID,
				cardId: opts.cardId,
				agentName: "test",
				model: "claude-opus-4-7",
				inputTokens: 0,
				outputTokens: opts.outputTokens ?? 1_000_000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
	}

	it("returns 400 when projectId is missing", async () => {
		const res = await GET(new Request("http://test.local/api/export/costs"));
		expect(res.status).toBe(400);
	});

	it("returns 400 when projectId is malformed", async () => {
		const res = await GET(new Request("http://test.local/api/export/costs?projectId=not-a-uuid"));
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/projectId/i);
	});

	it("returns 400 when format is invalid", async () => {
		const res = await GET(
			new Request(`http://test.local/api/export/costs?projectId=${PROJECT_ID}&format=xlsx`)
		);
		expect(res.status).toBe(400);
	});

	it("returns 400 when boardId is malformed", async () => {
		const res = await GET(
			new Request(`http://test.local/api/export/costs?projectId=${PROJECT_ID}&boardId=oops`)
		);
		expect(res.status).toBe(400);
	});

	it("returns 404 when project does not exist", async () => {
		const res = await GET(
			new Request(
				`http://test.local/api/export/costs?projectId=00000000-0000-4000-8000-000000000000`
			)
		);
		expect(res.status).toBe(404);
	});

	it("emits CSV with attachment headers and matching filename pattern", async () => {
		await clearRows();
		await seedRow({ sessionId: "s-a", cardId: DONE_CARD_A, outputTokens: 1_000_000 });
		await seedRow({ sessionId: "s-b", cardId: DONE_CARD_B, outputTokens: 2_000_000 });

		const res = await GET(
			new Request(`http://test.local/api/export/costs?projectId=${PROJECT_ID}`)
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toMatch(/^text\/csv/);

		const disposition = res.headers.get("Content-Disposition") ?? "";
		expect(disposition).toMatch(/^attachment;/);
		// Filename: pigeon-costs-<slug>-YYYY-MM-DD.csv. Slug is from slugify
		// of "Acme & Co — Billable", which kebab-cases to "acme-co-billable".
		expect(disposition).toMatch(/filename="pigeon-costs-acme-co-billable-\d{4}-\d{2}-\d{2}\.csv"/);

		const body = await res.text();
		// Header row
		expect(body).toContain("card_ref,card_title,status,session_count,total_cost_usd,completed_at");
		// Both shipped rows present
		expect(body).toContain("#2,Shipped card A,shipped,1,");
		expect(body).toContain("#3,Shipped card B,shipped,1,");
		// Preamble
		expect(body).toMatch(/# Shipped cards: 2/);
	});

	it("RFC 4180-quotes fields with commas and embedded quotes", async () => {
		await clearRows();
		// TODO_CARD has title `Card with, comma and "quotes"` — both
		// triggers (comma + double quote) are present so the row MUST come
		// out fully quoted with internal quotes doubled.
		await seedRow({ sessionId: "s-todo", cardId: TODO_CARD });

		const res = await GET(
			new Request(`http://test.local/api/export/costs?projectId=${PROJECT_ID}&format=csv`)
		);
		const body = await res.text();
		// Quoted title — comma and "" escaped quotes
		expect(body).toContain(`#1,"Card with, comma and ""quotes""",in_flight,`);
	});

	it("emits Markdown with GFM table and md filename", async () => {
		await clearRows();
		await seedRow({ sessionId: "s-a", cardId: DONE_CARD_A, outputTokens: 1_000_000 });

		const res = await GET(
			new Request(`http://test.local/api/export/costs?projectId=${PROJECT_ID}&format=md`)
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toMatch(/^text\/markdown/);
		expect(res.headers.get("Content-Disposition")).toMatch(/\.md"$/);

		const body = await res.text();
		expect(body).toMatch(/^# Pigeon Costs — Acme & Co — Billable/);
		expect(body).toContain("| Card | Title | Status | Sessions | Cost (USD) | Completed |");
		expect(body).toContain("| #2 | Shipped card A | shipped |");
		expect(body).toContain("- Shipped cards: 1");
	});

	it("returns headers-only CSV with summary 'no shipped cards yet' line when empty", async () => {
		await clearRows();
		const res = await GET(
			new Request(`http://test.local/api/export/costs?projectId=${PROJECT_ID}`)
		);
		expect(res.status).toBe(200);

		const body = await res.text();
		// Summary preamble surfaces the empty state.
		expect(body).toContain("# Median shipped card cost (USD): no shipped cards yet");
		expect(body).toContain("# Shipped cards: 0");
		// Header row is still present
		expect(body).toContain("card_ref,card_title,status,session_count,total_cost_usd,completed_at");
		// No data lines beyond the header (everything else is preamble or
		// the trailing newline). Split on \n, drop comment lines + empty,
		// and we should have exactly one row left: the header.
		const dataLines = body.split("\n").filter((line) => line.length > 0 && !line.startsWith("#"));
		expect(dataLines).toHaveLength(1);
	});
});
