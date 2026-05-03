/**
 * Card #232 — read-only short-circuit for policy enforcement.
 *
 * Goal: prove that `wrapEssentialHandler` (instrumentation.ts) and
 * `executeTool` (tool-registry.ts) skip `resolvePolicyForCall` entirely
 * when the tool is annotated `readOnlyHint: true`. Read-only tools can't
 * trigger an `intent_required_on` violation, so the per-call
 * `git rev-parse` subprocess (+ DB lookup) is wasted work.
 *
 * Strategy: stub `policy-enforcement.ts` and `db.ts` with vi.mock so the
 * test never spawns a real subprocess or touches Prisma. The test then
 * asserts `resolvePolicyForCall` is *not* called for read-only paths and
 * *is* called for non-read-only paths.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock policy-enforcement so we can spy on resolvePolicyForCall. This is
// the function that today does `git rev-parse` + DB lookup.
vi.mock("@/mcp/policy-enforcement", () => ({
	resolvePolicyForCall: vi.fn().mockResolvedValue(null),
	requireIntentIfPolicyRequires: vi.fn().mockReturnValue({ ok: true }),
}));

// Mock db.ts so importing instrumentation.ts (which writes to toolCallLog)
// doesn't drag in Prisma. We only need a no-op create.
vi.mock("@/mcp/db", () => ({
	db: {
		toolCallLog: {
			create: vi.fn().mockResolvedValue(undefined),
		},
		project: {
			findUnique: vi.fn().mockResolvedValue(null),
		},
	},
}));

// Mock resolveProjectIdFromCwd so instrumentation.ts's per-process
// projectId resolver doesn't spawn `git rev-parse` in unit tests
// (#277 — project_id stamping on tool_call_log writes).
vi.mock("@/lib/services/resolve-project", () => ({
	resolveProjectIdFromCwd: vi.fn().mockResolvedValue(null),
}));

// Mock utils err/AGENT_NAME so we don't pull in the rest of utils
// transitively. ok() isn't needed because handlers we pass are tiny stubs.
vi.mock("@/mcp/utils", () => ({
	AGENT_NAME: "test-agent",
	err: (msg: string) => ({
		content: [{ type: "text", text: msg }],
		isError: true,
	}),
}));

import { z } from "zod";
import { wrapEssentialHandler } from "@/mcp/instrumentation";
import { resolvePolicyForCall } from "@/mcp/policy-enforcement";
import { executeTool, registerExtendedTool } from "@/mcp/tool-registry";

const mockedResolve = vi.mocked(resolvePolicyForCall);

describe("wrapEssentialHandler — read-only short-circuit (card #232)", () => {
	beforeEach(() => {
		mockedResolve.mockClear();
	});

	it("skips resolvePolicyForCall when readOnlyHint=true", async () => {
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		const wrapped = wrapEssentialHandler("briefMe", handler, { readOnlyHint: true });

		await wrapped({ boardId: "abc" });

		expect(mockedResolve).not.toHaveBeenCalled();
		expect(handler).toHaveBeenCalledOnce();
	});

	it("skips resolvePolicyForCall for read-only tool with no params (briefMe-style)", async () => {
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		const wrapped = wrapEssentialHandler("checkOnboarding", handler, { readOnlyHint: true });

		await wrapped({});

		expect(mockedResolve).not.toHaveBeenCalled();
	});

	it("calls resolvePolicyForCall when readOnlyHint is omitted (mutating tool)", async () => {
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		const wrapped = wrapEssentialHandler("createCard", handler);

		await wrapped({ boardId: "abc", title: "x" });

		expect(mockedResolve).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledOnce();
	});

	it("calls resolvePolicyForCall when readOnlyHint is explicitly false", async () => {
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		const wrapped = wrapEssentialHandler("moveCard", handler, { readOnlyHint: false });

		await wrapped({ cardId: "#1" });

		expect(mockedResolve).toHaveBeenCalledOnce();
	});
});

describe("executeTool — read-only short-circuit (card #232)", () => {
	beforeEach(() => {
		mockedResolve.mockClear();
	});

	it("skips resolvePolicyForCall when extended tool is annotated readOnlyHint=true", async () => {
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		registerExtendedTool("__test_readonly_tool__", {
			category: "discovery",
			description: "test read-only tool",
			parameters: z.object({}),
			annotations: { readOnlyHint: true },
			handler,
		});

		await executeTool("__test_readonly_tool__", {});

		expect(mockedResolve).not.toHaveBeenCalled();
		expect(handler).toHaveBeenCalledOnce();
	});

	it("calls resolvePolicyForCall when extended tool has no readOnlyHint", async () => {
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		registerExtendedTool("__test_writing_tool__", {
			category: "cards",
			description: "test write tool",
			parameters: z.object({}),
			handler,
		});

		await executeTool("__test_writing_tool__", {});

		expect(mockedResolve).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledOnce();
	});

	it("calls resolvePolicyForCall when readOnlyHint is explicitly false", async () => {
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		registerExtendedTool("__test_explicit_false_tool__", {
			category: "cards",
			description: "test write tool",
			parameters: z.object({}),
			annotations: { readOnlyHint: false },
			handler,
		});

		await executeTool("__test_explicit_false_tool__", {});

		expect(mockedResolve).toHaveBeenCalledOnce();
	});
});
