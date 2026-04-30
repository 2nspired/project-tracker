import { describe, expect, it } from "vitest";
import { __testing__ } from "@/server/services/token-usage-service";

const { configHasTokenHook } = __testing__;

describe("configHasTokenHook", () => {
	it("recognizes a command-style Stop hook pointing at scripts/stop-hook.sh", () => {
		const cfg = {
			hooks: {
				Stop: [
					{
						hooks: [
							{
								type: "command",
								command: "/Users/alice/Projects/pigeon/scripts/stop-hook.sh",
							},
						],
					},
				],
			},
		};
		expect(configHasTokenHook(cfg)).toBe(true);
	});

	it("does NOT recognize the legacy mcp_tool Stop hook (silently no-ops in CC 2.1.x)", () => {
		const cfg = {
			hooks: {
				Stop: [
					{
						hooks: [
							{
								type: "mcp_tool",
								server: "pigeon",
								tool: "recordTokenUsageFromTranscript",
								// biome-ignore lint/suspicious/noTemplateCurlyInString: ${transcript_path} is Claude Code's substitution token — must remain a literal string for the hook config
								input: { transcriptPath: "${transcript_path}" },
							},
						],
					},
				],
			},
		};
		expect(configHasTokenHook(cfg)).toBe(false);
	});

	it("ignores command hooks pointing at unrelated scripts", () => {
		const cfg = {
			hooks: {
				Stop: [
					{
						hooks: [{ type: "command", command: "/usr/local/bin/some-other-script.sh" }],
					},
				],
			},
		};
		expect(configHasTokenHook(cfg)).toBe(false);
	});

	it("returns false for malformed inputs without throwing", () => {
		expect(configHasTokenHook(null)).toBe(false);
		expect(configHasTokenHook(undefined)).toBe(false);
		expect(configHasTokenHook("not an object")).toBe(false);
		expect(configHasTokenHook({})).toBe(false);
		expect(configHasTokenHook({ hooks: {} })).toBe(false);
		expect(configHasTokenHook({ hooks: { Stop: "wrong type" } })).toBe(false);
		expect(configHasTokenHook({ hooks: { Stop: [{ hooks: "wrong" }] } })).toBe(false);
	});

	it("returns true if any of multiple Stop entries matches (merged hooks)", () => {
		const cfg = {
			hooks: {
				Stop: [
					{ hooks: [{ type: "command", command: "/some/other/thing.sh" }] },
					{ hooks: [{ type: "command", command: "/path/to/scripts/stop-hook.sh" }] },
				],
			},
		};
		expect(configHasTokenHook(cfg)).toBe(true);
	});
});
