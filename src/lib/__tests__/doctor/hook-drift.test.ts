import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateHookDrift } from "@/lib/doctor/checks/hook-drift";
import type { ClaudeConfigPath } from "@/lib/doctor/config-paths";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(resolve(tmpdir(), "doctor-hooks-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, contents: unknown): ClaudeConfigPath {
	const path = resolve(tmp, name);
	writeFileSync(path, JSON.stringify(contents, null, 2));
	return { path, source: "claude" };
}

describe("evaluateHookDrift", () => {
	it("skips when no configs", () => {
		const result = evaluateHookDrift([]);
		expect(result.status).toBe("skip");
	});

	it("passes when no hooks reference legacy server", () => {
		const cfg = writeConfig("a.json", {
			hooks: {
				Stop: [
					{
						hooks: [{ type: "mcp_tool", server: "pigeon", tool: "endSession" }],
					},
				],
			},
		});
		const result = evaluateHookDrift([cfg]);
		expect(result.status).toBe("pass");
	});

	it("fails when a Stop hook still references project-tracker", () => {
		const cfg = writeConfig("a.json", {
			hooks: {
				Stop: [
					{
						hooks: [{ type: "mcp_tool", server: "project-tracker", tool: "endSession" }],
					},
				],
			},
		});
		const result = evaluateHookDrift([cfg]);
		expect(result.status).toBe("fail");
		expect(result.message).toMatch(/silently no-op/);
		expect(result.fix).toMatch(/pigeon/);
	});

	it("only flags mcp_tool hooks (ignores command-style hooks)", () => {
		const cfg = writeConfig("a.json", {
			hooks: {
				Stop: [
					{
						hooks: [{ type: "command", command: "echo project-tracker" }],
					},
				],
			},
		});
		const result = evaluateHookDrift([cfg]);
		expect(result.status).toBe("pass");
	});

	it("counts multiple drifts across events", () => {
		const cfg = writeConfig("a.json", {
			hooks: {
				Stop: [{ hooks: [{ type: "mcp_tool", server: "project-tracker", tool: "a" }] }],
				Start: [{ hooks: [{ type: "mcp_tool", server: "project-tracker", tool: "b" }] }],
			},
		});
		const result = evaluateHookDrift([cfg]);
		expect(result.status).toBe("fail");
		expect(result.message).toMatch(/^2 hooks/);
	});

	it("survives malformed config (treats as no drift in that file)", () => {
		const path = resolve(tmp, "broken.json");
		writeFileSync(path, "{ not json");
		const cfg: ClaudeConfigPath = { path, source: "claude" };
		const result = evaluateHookDrift([cfg]);
		expect(result.status).toBe("pass");
	});

	it("survives configs without a hooks section", () => {
		const cfg = writeConfig("a.json", { mcpServers: { pigeon: {} } });
		const result = evaluateHookDrift([cfg]);
		expect(result.status).toBe("pass");
	});
});
