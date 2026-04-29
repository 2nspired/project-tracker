import { describe, expect, it } from "vitest";
import type { TrackerPolicy } from "@/lib/services/tracker-policy";
import { requireIntentIfPolicyRequires } from "@/mcp/policy-check";

function policy(intent_required_on: string[]): TrackerPolicy {
	return {
		prompt: "",
		intent_required_on,
		columns: {},
		schema_version: 1,
	};
}

describe("requireIntentIfPolicyRequires", () => {
	describe("when policy is null (no tracker.md)", () => {
		it("passes for moveCard with no intent (back-compat — schema is the safety net)", () => {
			const result = requireIntentIfPolicyRequires(null, "moveCard", {
				cardId: "#1",
				columnName: "Done",
			});
			expect(result.ok).toBe(true);
		});

		it("passes for any tool regardless of params", () => {
			expect(requireIntentIfPolicyRequires(null, "deleteCard", {}).ok).toBe(true);
			expect(requireIntentIfPolicyRequires(null, "addComment", {}).ok).toBe(true);
		});
	});

	describe("when policy.intent_required_on is empty", () => {
		it("passes for moveCard with no intent (no policy says it must require)", () => {
			const result = requireIntentIfPolicyRequires(policy([]), "moveCard", {
				cardId: "#1",
				columnName: "Done",
			});
			expect(result.ok).toBe(true);
		});
	});

	describe("when tool is listed in intent_required_on", () => {
		const p = policy(["moveCard", "deleteCard"]);

		it("passes when intent is a non-empty string", () => {
			const result = requireIntentIfPolicyRequires(p, "moveCard", {
				cardId: "#1",
				columnName: "Done",
				intent: "promoting to Done",
			});
			expect(result.ok).toBe(true);
		});

		it("fails when intent is missing", () => {
			const result = requireIntentIfPolicyRequires(p, "moveCard", {
				cardId: "#1",
				columnName: "Done",
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.message).toMatch(/moveCard/);
				expect(result.message).toMatch(/intent/);
				expect(result.message).toMatch(/tracker\.md/);
			}
		});

		it("fails when intent is an empty string", () => {
			const result = requireIntentIfPolicyRequires(p, "deleteCard", {
				cardId: "#1",
				intent: "",
			});
			expect(result.ok).toBe(false);
		});

		it("fails when intent is whitespace-only", () => {
			const result = requireIntentIfPolicyRequires(p, "deleteCard", {
				cardId: "#1",
				intent: "   \n  ",
			});
			expect(result.ok).toBe(false);
		});

		it("fails when intent is a non-string value", () => {
			const result = requireIntentIfPolicyRequires(p, "moveCard", {
				cardId: "#1",
				columnName: "Done",
				intent: 42,
			});
			expect(result.ok).toBe(false);
		});

		it("fails when intent is null", () => {
			const result = requireIntentIfPolicyRequires(p, "moveCard", {
				cardId: "#1",
				columnName: "Done",
				intent: null,
			});
			expect(result.ok).toBe(false);
		});

		it("fails when params is null/undefined entirely", () => {
			expect(requireIntentIfPolicyRequires(p, "moveCard", null).ok).toBe(false);
			expect(requireIntentIfPolicyRequires(p, "moveCard", undefined).ok).toBe(false);
		});
	});

	describe("when tool is NOT listed in intent_required_on", () => {
		const p = policy(["moveCard"]);

		it("passes for deleteCard with no intent (only moveCard is policy-required here)", () => {
			const result = requireIntentIfPolicyRequires(p, "deleteCard", {
				cardId: "#1",
			});
			expect(result.ok).toBe(true);
		});

		it("passes for an introspection tool (e.g. getTools) with no params", () => {
			const result = requireIntentIfPolicyRequires(p, "getTools", {});
			expect(result.ok).toBe(true);
		});

		it("passes for a custom tool name not in the list", () => {
			const result = requireIntentIfPolicyRequires(p, "addComment", {
				cardId: "#1",
				content: "hi",
			});
			expect(result.ok).toBe(true);
		});
	});

	describe("policy can extend enforcement to additional tools", () => {
		it("requires intent on addComment when project policy lists it", () => {
			const p = policy(["addComment"]);
			const missing = requireIntentIfPolicyRequires(p, "addComment", {
				cardId: "#1",
				content: "lgtm",
			});
			expect(missing.ok).toBe(false);

			const present = requireIntentIfPolicyRequires(p, "addComment", {
				cardId: "#1",
				content: "lgtm",
				intent: "approving the diff",
			});
			expect(present.ok).toBe(true);
		});
	});
});
