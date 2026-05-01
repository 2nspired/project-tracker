// Locks down the high-risk shapes of token-usage-service surfaced in the
// #190 design sprint:
//   T1 — resolvePricing fail-soft + override merge
//   T2 — computeCost 5-class split + unknown-model zero
//   T3 — aggregateTranscript JSONL parser (cache_creation, legacy fallback,
//        non-assistant skip, malformed-line counting)
//   T4 — getCardSummary session-expansion attribution rule (DB fixture)
//   T5 — configHasTokenHook coverage (mcp_tool, missing hooks, nested
//        command shape)

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeCost, resolvePricing } from "@/lib/token-pricing-defaults";
import { createTestDb, type TestDb } from "@/server/services/__tests__/test-db";

// ─── T4 mock plumbing ───────────────────────────────────────────────
//
// `tokenUsageService.getCardSummary` reads from the singleton `db` exported
// from `@/server/db`. We swap that export for the test fixture's Prisma
// instance via `vi.mock`. The hoisted ref lets `beforeAll` populate it
// after the async fixture is built — the mock factory only reads from it
// when service code touches `db`, well after setup.
const dbRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/server/db", () => ({
	get db() {
		return dbRef.current;
	},
}));

// Imports must come AFTER vi.mock so the mock is installed before the
// service module loads its `db` import.
const { tokenUsageService, __testing__ } = await import("@/server/services/token-usage-service");
const { configHasTokenHook, aggregateTranscript } = __testing__;

// ─── T1: resolvePricing fail-soft + merge ───────────────────────────

describe("resolvePricing", () => {
	it("returns defaults when stored JSON is null", () => {
		const out = resolvePricing(null);
		expect(out["claude-opus-4-7"].inputPerMTok).toBe(15);
		expect(out["claude-sonnet-4-6"].outputPerMTok).toBe(15);
	});

	it("returns defaults when stored JSON is malformed", () => {
		const out = resolvePricing("{not valid json");
		// Must not throw — defaults still present, no NaN sneaks in.
		expect(out["claude-opus-4-7"].inputPerMTok).toBe(15);
		expect(out.gpt4o ?? out["gpt-4o"]).toBeDefined();
	});

	it("merges a single-model override while preserving defaults for others", () => {
		const overrides = JSON.stringify({
			"claude-opus-4-7": { inputPerMTok: 99, outputPerMTok: 200 },
		});
		const out = resolvePricing(overrides);
		// Overridden model picks up override values.
		expect(out["claude-opus-4-7"].inputPerMTok).toBe(99);
		expect(out["claude-opus-4-7"].outputPerMTok).toBe(200);
		// Unspecified fields fall back to that model's defaults.
		expect(out["claude-opus-4-7"].cacheReadPerMTok).toBe(1.5);
		// Other models retain defaults.
		expect(out["claude-sonnet-4-6"].inputPerMTok).toBe(3);
		expect(out["claude-haiku-4-5"].inputPerMTok).toBe(1);
	});
});

// ─── T2: computeCost 5-class split ──────────────────────────────────

describe("computeCost", () => {
	it("sums all five token classes against the matching model rates", () => {
		const pricing = resolvePricing(null);
		const event = {
			model: "claude-opus-4-7",
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			cacheReadTokens: 1_000_000,
			cacheCreation1hTokens: 1_000_000,
			cacheCreation5mTokens: 1_000_000,
		};
		// Hand-calc: 15 + 75 + 1.5 + 30 + 18.75 = 140.25 USD per million × 5 classes
		const cost = computeCost(event, pricing);
		expect(cost).toBeCloseTo(15 + 75 + 1.5 + 30 + 18.75, 5);
	});

	it("respects an override where 1h pricing differs from 5m", () => {
		const pricing = resolvePricing(
			JSON.stringify({
				"claude-opus-4-7": {
					inputPerMTok: 0,
					outputPerMTok: 0,
					cacheReadPerMTok: 0,
					cacheCreation1hPerMTok: 50,
					cacheCreation5mPerMTok: 10,
				},
			})
		);
		const event = {
			model: "claude-opus-4-7",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreation1hTokens: 2_000_000, // 2M × $50/M = $100
			cacheCreation5mTokens: 500_000, // 0.5M × $10/M = $5
		};
		const cost = computeCost(event, pricing);
		expect(cost).toBeCloseTo(105, 5);
	});

	it("returns 0 (not NaN, not exception) for an unknown model", () => {
		const pricing = resolvePricing(null);
		const event = {
			model: "made-up-model-9000",
			inputTokens: 10_000_000,
			outputTokens: 10_000_000,
			cacheReadTokens: 10_000_000,
			cacheCreation1hTokens: 10_000_000,
			cacheCreation5mTokens: 10_000_000,
		};
		const cost = computeCost(event, pricing);
		expect(cost).toBe(0);
		expect(Number.isFinite(cost)).toBe(true);
	});
});

// ─── T3: aggregateTranscript JSONL parser ──────────────────────────

describe("aggregateTranscript", () => {
	let tmpDir: string;

	beforeAll(() => {
		tmpDir = mkdtempSync(path.join(tmpdir(), "pigeon-jsonl-"));
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeJsonl(name: string, lines: string[]): string {
		const p = path.join(tmpDir, name);
		writeFileSync(p, lines.join("\n"), "utf8");
		return p;
	}

	it("accumulates ephemeral_1h_input_tokens into cacheCreation1hTokens", async () => {
		const filePath = writeJsonl("ephemeral-1h.jsonl", [
			JSON.stringify({
				message: {
					role: "assistant",
					model: "claude-opus-4-7",
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 75 },
					},
				},
			}),
			JSON.stringify({
				message: {
					role: "assistant",
					model: "claude-opus-4-7",
					usage: {
						input_tokens: 10,
						output_tokens: 5,
						cache_creation: { ephemeral_1h_input_tokens: 20 },
					},
				},
			}),
		]);
		const totals = new Map();
		const result = await aggregateTranscript(filePath, totals);
		expect(result.parseErrors).toBe(0);
		expect(result.messagesSeen).toBe(2);
		const acc = totals.get("claude-opus-4-7");
		expect(acc).toBeDefined();
		expect(acc?.inputTokens).toBe(110);
		expect(acc?.outputTokens).toBe(55);
		expect(acc?.cacheCreation1hTokens).toBe(220);
		expect(acc?.cacheCreation5mTokens).toBe(75);
	});

	it("falls back to cache_creation_input_tokens as the 5m bucket when ephemeral split is absent", async () => {
		const filePath = writeJsonl("legacy-cache.jsonl", [
			JSON.stringify({
				message: {
					role: "assistant",
					model: "claude-sonnet-4-6",
					usage: {
						input_tokens: 1,
						output_tokens: 2,
						cache_creation_input_tokens: 999,
					},
				},
			}),
		]);
		const totals = new Map();
		const result = await aggregateTranscript(filePath, totals);
		expect(result.parseErrors).toBe(0);
		const acc = totals.get("claude-sonnet-4-6");
		expect(acc?.cacheCreation5mTokens).toBe(999);
		expect(acc?.cacheCreation1hTokens).toBe(0);
	});

	it("counts malformed lines in parseErrors without throwing", async () => {
		const filePath = writeJsonl("malformed.jsonl", [
			"not valid json {{",
			JSON.stringify({
				message: {
					role: "assistant",
					model: "claude-opus-4-7",
					usage: { input_tokens: 7, output_tokens: 3 },
				},
			}),
			"{still broken",
			"", // blank lines are skipped, not counted
			"  ", // whitespace-only same
		]);
		const totals = new Map();
		const result = await aggregateTranscript(filePath, totals);
		expect(result.parseErrors).toBe(2);
		expect(result.messagesSeen).toBe(1);
		expect(totals.get("claude-opus-4-7")?.inputTokens).toBe(7);
	});

	it("skips lines whose role !== 'assistant'", async () => {
		const filePath = writeJsonl("mixed-roles.jsonl", [
			JSON.stringify({
				message: {
					role: "user",
					model: "claude-opus-4-7",
					usage: { input_tokens: 9999, output_tokens: 9999 },
				},
			}),
			JSON.stringify({
				message: {
					role: "system",
					model: "claude-opus-4-7",
					usage: { input_tokens: 9999, output_tokens: 9999 },
				},
			}),
			JSON.stringify({
				message: {
					role: "assistant",
					model: "claude-opus-4-7",
					usage: { input_tokens: 5, output_tokens: 1 },
				},
			}),
		]);
		const totals = new Map();
		const result = await aggregateTranscript(filePath, totals);
		expect(result.messagesSeen).toBe(1);
		expect(totals.get("claude-opus-4-7")?.inputTokens).toBe(5);
		expect(totals.get("claude-opus-4-7")?.outputTokens).toBe(1);
	});
});

// ─── T4: getCardSummary attribution expansion (DB fixture) ──────────

describe("getCardSummary attribution", () => {
	let testDb: TestDb;

	const PROJECT_ID = "10000000-1000-4000-8000-100000000001";
	const BOARD_ID = "20000000-2000-4000-8000-200000000001";
	const COLUMN_ID = "30000000-3000-4000-8000-300000000001";
	const CARD_X = "40000000-4000-4000-8000-400000000001";
	const CARD_Y = "40000000-4000-4000-8000-400000000002";
	const SHARED_SESSION = "shared-session-id";

	beforeAll(async () => {
		testDb = await createTestDb();
		dbRef.current = testDb.prisma;

		// Seed: project + board + column + two cards (X and Y).
		await testDb.prisma.project.create({
			data: { id: PROJECT_ID, name: "Test", slug: "test" },
		});
		await testDb.prisma.board.create({
			data: { id: BOARD_ID, projectId: PROJECT_ID, name: "Test board" },
		});
		await testDb.prisma.column.create({
			data: { id: COLUMN_ID, boardId: BOARD_ID, name: "Todo", position: 0 },
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_X,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 1,
				title: "Card X",
				position: 0,
			},
		});
		await testDb.prisma.card.create({
			data: {
				id: CARD_Y,
				columnId: COLUMN_ID,
				projectId: PROJECT_ID,
				number: 2,
				title: "Card Y",
				position: 1,
			},
		});

		// Two TokenUsageEvent rows sharing a sessionId. Row A is attributed
		// to CARD_X. Row B has cardId=null but shares the session with A —
		// session-expansion should pull it into getCardSummary(CARD_X).
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SHARED_SESSION,
				projectId: PROJECT_ID,
				cardId: CARD_X,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
		await testDb.prisma.tokenUsageEvent.create({
			data: {
				sessionId: SHARED_SESSION,
				projectId: PROJECT_ID,
				cardId: null,
				agentName: "test-agent",
				model: "claude-opus-4-7",
				inputTokens: 2000,
				outputTokens: 1000,
				cacheReadTokens: 0,
				cacheCreation1hTokens: 0,
				cacheCreation5mTokens: 0,
			},
		});
	});

	afterAll(async () => {
		dbRef.current = null;
		await testDb.cleanup();
	});

	it("includes the null-cardId sibling event when their session is anchored to this card", async () => {
		const result = await tokenUsageService.getCardSummary(CARD_X);
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Both events show up in the breakdown (3000 input + 1500 output total).
		expect(result.data.eventCount).toBe(2);
		const opus = result.data.byModel.find((m) => m.model === "claude-opus-4-7");
		expect(opus?.inputTokens).toBe(3000);
		expect(opus?.outputTokens).toBe(1500);
		expect(result.data.totalCostUsd).toBeGreaterThan(0);
	});

	it("returns zero cost for a card whose session was never anchored to it", async () => {
		const result = await tokenUsageService.getCardSummary(CARD_Y);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.totalCostUsd).toBe(0);
		expect(result.data.eventCount).toBe(0);
	});
});

// ─── T5: configHasTokenHook coverage extensions ─────────────────────

describe("configHasTokenHook (extended cases)", () => {
	it("returns false for the legacy mcp_tool Stop hook shape", () => {
		const cfg = {
			hooks: {
				Stop: [
					{
						hooks: [
							{
								type: "mcp_tool",
								server: "pigeon",
								tool: "recordTokenUsageFromTranscript",
							},
						],
					},
				],
			},
		};
		expect(configHasTokenHook(cfg)).toBe(false);
	});

	it("returns false when the `hooks` key is missing entirely", () => {
		expect(configHasTokenHook({})).toBe(false);
		expect(configHasTokenHook({ otherKey: "value" })).toBe(false);
	});

	it("returns true for a nested command hook ending in stop-hook.sh", () => {
		const cfg = {
			hooks: {
				Stop: [
					{
						hooks: [
							{ type: "command", command: "/some/other.sh" },
							{ type: "command", command: "/abs/path/to/scripts/stop-hook.sh" },
						],
					},
				],
			},
		};
		expect(configHasTokenHook(cfg)).toBe(true);
	});

	it("returns true for a Windows-style backslash path ending in stop-hook.sh", () => {
		const cfg = {
			hooks: {
				Stop: [
					{
						hooks: [
							{
								type: "command",
								command: "C:\\Users\\alice\\pigeon\\scripts\\stop-hook.sh",
							},
						],
					},
				],
			},
		};
		expect(configHasTokenHook(cfg)).toBe(true);
	});
});
