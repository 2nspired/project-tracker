import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateMcpRegistration } from "@/lib/doctor/checks/mcp-registration";
import type { ClaudeConfigPath } from "@/lib/doctor/config-paths";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(resolve(tmpdir(), "doctor-mcp-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, contents: unknown): ClaudeConfigPath {
	const path = resolve(tmp, name);
	writeFileSync(path, JSON.stringify(contents, null, 2));
	return { path, source: "claude" };
}

describe("evaluateMcpRegistration", () => {
	it("fails when no configs are provided", () => {
		const result = evaluateMcpRegistration([]);
		expect(result.status).toBe("fail");
		expect(result.message).toMatch(/No Claude Code config/);
		expect(result.fix).toBeDefined();
	});

	it("passes when only the new pigeon key is present", () => {
		const cfg = writeConfig("a.json", {
			mcpServers: { pigeon: { command: "/path/to/pigeon-start.sh" } },
		});
		const result = evaluateMcpRegistration([cfg]);
		expect(result.status).toBe("pass");
		expect(result.message).toMatch(/pigeon/);
	});

	it("warns when both pigeon and legacy keys are present", () => {
		const cfg = writeConfig("a.json", {
			mcpServers: {
				pigeon: { command: "/p" },
				"project-tracker": { command: "/p" },
			},
		});
		const result = evaluateMcpRegistration([cfg]);
		expect(result.status).toBe("warn");
		expect(result.message).toMatch(/Both pigeon and legacy/);
		expect(result.fix).toMatch(/Remove/);
	});

	it("fails when only the legacy key is present", () => {
		const cfg = writeConfig("a.json", {
			mcpServers: { "project-tracker": { command: "/p" } },
		});
		const result = evaluateMcpRegistration([cfg]);
		expect(result.status).toBe("fail");
		expect(result.message).toMatch(/legacy/);
		expect(result.fix).toMatch(/Rename/);
	});

	it("fails when mcpServers exists but neither key is present", () => {
		const cfg = writeConfig("a.json", { mcpServers: { other: { command: "/x" } } });
		const result = evaluateMcpRegistration([cfg]);
		expect(result.status).toBe("fail");
		expect(result.message).toMatch(/No mcpServers entry for pigeon/);
	});

	it("treats malformed JSON as 'no key found' rather than throwing", () => {
		const path = resolve(tmp, "broken.json");
		writeFileSync(path, "{ not valid json");
		const cfg: ClaudeConfigPath = { path, source: "claude" };
		const result = evaluateMcpRegistration([cfg]);
		expect(result.status).toBe("fail");
	});

	it("aggregates findings across multiple configs", () => {
		const a = writeConfig("a.json", {
			mcpServers: { pigeon: { command: "/a" } },
		});
		const b = writeConfig("b.json", {
			mcpServers: { "project-tracker": { command: "/b" } },
		});
		const result = evaluateMcpRegistration([a, b]);
		expect(result.status).toBe("warn");
		expect(result.message).toContain(b.path);
	});
});
