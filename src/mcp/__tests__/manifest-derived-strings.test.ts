import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildConnectSnippet } from "../../../scripts/print-connect-snippet";
import { ESSENTIAL_TOOLS } from "../manifest";
import { getAllExtendedTools } from "../tool-registry";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVER_TS = readFileSync(resolve(REPO_ROOT, "src/mcp/server.ts"), "utf8");

describe("manifest-derived user-facing strings (#187)", () => {
	describe("server.ts prompts string", () => {
		it("routes every prompt through registerPromptTracked (no raw server.registerPrompt left)", () => {
			const rawCalls = SERVER_TS.match(/^server\.registerPrompt\(/gm);
			expect(rawCalls).toBeNull();
		});

		it("registers prompts via the tracking wrapper", () => {
			const tracked = SERVER_TS.match(/^registerPromptTracked\(/gm);
			expect(tracked).not.toBeNull();
			// Boot-time check that we still have the seven prompts the v6.0.0
			// docs/site copy expects. If a prompt is added or removed, update
			// this number — the user-facing string is derived, but this
			// fixture catches accidental drops.
			expect(tracked).toHaveLength(7);
		});

		it("checkOnboarding's prompts string interpolates REGISTERED_PROMPTS", () => {
			expect(SERVER_TS).toMatch(
				/prompts:\s*`\$\{REGISTERED_PROMPTS\.length\} MCP prompts are available \(\$\{REGISTERED_PROMPTS\.join\(", "\)\}\)/
			);
		});

		it("does not contain the old hand-maintained 'N MCP prompts are available (...)' literal", () => {
			// Guard against re-introducing the historical hand-maintained string in
			// either its original (resume-session) or post-#169 (resume-board) form.
			expect(SERVER_TS).not.toMatch(/"7 MCP prompts are available \(resume-session, onboarding/);
			expect(SERVER_TS).not.toMatch(/"7 MCP prompts are available \(resume-board, onboarding/);
		});
	});

	describe("connect.sh CLAUDE.md tip", () => {
		it("includes the live ESSENTIAL_TOOLS count + every essential name", () => {
			const snippet = buildConnectSnippet();
			expect(snippet).toContain(`${ESSENTIAL_TOOLS.length} essential tools`);
			for (const tool of ESSENTIAL_TOOLS) {
				expect(snippet).toContain(tool.name);
			}
		});

		it("includes the live extended-tool count", () => {
			const snippet = buildConnectSnippet();
			const extendedCount = getAllExtendedTools().length;
			expect(snippet).toContain(`${extendedCount} extended tools`);
		});

		it("connect.sh delegates to the print script (no inline heredoc count)", () => {
			const connectSh = readFileSync(resolve(REPO_ROOT, "scripts/connect.sh"), "utf8");
			expect(connectSh).toContain("scripts/print-connect-snippet.ts");
			expect(connectSh).not.toMatch(/10 essential tools are always visible/);
			expect(connectSh).not.toMatch(/~60 extended tools/);
		});
	});
});
