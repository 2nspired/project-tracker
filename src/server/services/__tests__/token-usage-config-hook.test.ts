import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __testing__ } from "@/server/services/token-usage-service";

const { configHasTokenHook, resolveConfigCandidates } = __testing__;

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

describe("resolveConfigCandidates", () => {
	const FAKE_CWD = "/tmp/fake-repo";
	const home = homedir();

	it("includes project-scoped <cwd>/.claude/settings.json and settings.local.json with scope='project'", () => {
		const prevOverride = process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CLAUDE_CONFIG_DIR;
		try {
			const candidates = resolveConfigCandidates(FAKE_CWD);
			expect(candidates).toContainEqual({
				path: path.resolve(FAKE_CWD, ".claude", "settings.json"),
				scope: "project",
			});
			expect(candidates).toContainEqual({
				path: path.resolve(FAKE_CWD, ".claude", "settings.local.json"),
				scope: "project",
			});
		} finally {
			if (prevOverride === undefined) {
				delete process.env.CLAUDE_CONFIG_DIR;
			} else {
				process.env.CLAUDE_CONFIG_DIR = prevOverride;
			}
		}
	});

	it("includes user-scoped ~/.claude/settings.json and ~/.claude-alt/settings.json with scope='user'", () => {
		const prevOverride = process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CLAUDE_CONFIG_DIR;
		try {
			const candidates = resolveConfigCandidates(FAKE_CWD);
			expect(candidates).toContainEqual({
				path: path.join(home, ".claude", "settings.json"),
				scope: "user",
			});
			expect(candidates).toContainEqual({
				path: path.join(home, ".claude-alt", "settings.json"),
				scope: "user",
			});
		} finally {
			if (prevOverride === undefined) {
				delete process.env.CLAUDE_CONFIG_DIR;
			} else {
				process.env.CLAUDE_CONFIG_DIR = prevOverride;
			}
		}
	});

	it("honors CLAUDE_CONFIG_DIR env override as user-scoped", () => {
		const prevOverride = process.env.CLAUDE_CONFIG_DIR;
		const overrideDir = "/tmp/fake-claude-config";
		process.env.CLAUDE_CONFIG_DIR = overrideDir;
		try {
			const candidates = resolveConfigCandidates(FAKE_CWD);
			expect(candidates).toContainEqual({
				path: path.join(overrideDir, "settings.json"),
				scope: "user",
			});
		} finally {
			if (prevOverride === undefined) {
				delete process.env.CLAUDE_CONFIG_DIR;
			} else {
				process.env.CLAUDE_CONFIG_DIR = prevOverride;
			}
		}
	});

	it("dedupes when env override resolves to a standard path", () => {
		const prevOverride = process.env.CLAUDE_CONFIG_DIR;
		// Point env override at the user-default `~/.claude` — both paths should
		// produce the same candidate, but the result should contain it only once.
		process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
		try {
			const candidates = resolveConfigCandidates(FAKE_CWD);
			const userDefault = path.join(home, ".claude", "settings.json");
			const occurrences = candidates.filter((c) => c.path === userDefault).length;
			expect(occurrences).toBe(1);
		} finally {
			if (prevOverride === undefined) {
				delete process.env.CLAUDE_CONFIG_DIR;
			} else {
				process.env.CLAUDE_CONFIG_DIR = prevOverride;
			}
		}
	});
});
