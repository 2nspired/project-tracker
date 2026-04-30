import { readFileSync } from "node:fs";
import { type ClaudeConfigPath, findExistingConfigs } from "../config-paths.js";
import type { Check, CheckResult } from "../types.js";

const CHECK_NAME = "MCP registration";

export function evaluateMcpRegistration(configs: ClaudeConfigPath[]): CheckResult {
	if (configs.length === 0) {
		return {
			name: CHECK_NAME,
			status: "fail",
			message: "No Claude Code config found at ~/.claude.json or ~/.claude-alt/.claude.json.",
			fix: "Open Claude Code once to create the config, then add an `mcpServers.pigeon` entry pointing at scripts/pigeon-start.sh.",
		};
	}

	const findings: Array<{ path: string; pigeon: boolean; legacy: boolean }> = [];

	for (const cfg of configs) {
		let parsed: { mcpServers?: Record<string, unknown> } | null = null;
		try {
			parsed = JSON.parse(readFileSync(cfg.path, "utf-8")) as {
				mcpServers?: Record<string, unknown>;
			};
		} catch {
			findings.push({ path: cfg.path, pigeon: false, legacy: false });
			continue;
		}

		const servers = parsed?.mcpServers ?? {};
		findings.push({
			path: cfg.path,
			pigeon: "pigeon" in servers,
			legacy: "project-tracker" in servers,
		});
	}

	const anyPigeon = findings.some((f) => f.pigeon);
	const anyLegacy = findings.some((f) => f.legacy);
	const located = findings
		.filter((f) => f.pigeon || f.legacy)
		.map((f) => `${f.path} (${f.pigeon ? "pigeon" : "project-tracker"})`)
		.join(", ");

	if (anyPigeon && !anyLegacy) {
		return {
			name: CHECK_NAME,
			status: "pass",
			message: `mcpServers.pigeon registered in ${located}.`,
		};
	}

	if (anyPigeon && anyLegacy) {
		const legacyAt = findings
			.filter((f) => f.legacy)
			.map((f) => f.path)
			.join(", ");
		return {
			name: CHECK_NAME,
			status: "warn",
			message: `Both pigeon and legacy project-tracker keys are registered. Legacy at ${legacyAt}.`,
			fix: "Remove the `mcpServers.project-tracker` entry — it shadows nothing useful and triggers deprecation warnings on every call.",
		};
	}

	if (anyLegacy) {
		const legacyAt = findings
			.filter((f) => f.legacy)
			.map((f) => f.path)
			.join(", ");
		return {
			name: CHECK_NAME,
			status: "fail",
			message: `Only the legacy mcpServers.project-tracker key is registered (${legacyAt}). Removed in v6.0.`,
			fix: "Rename `mcpServers.project-tracker` → `mcpServers.pigeon` and swap `scripts/mcp-start.sh` → `scripts/pigeon-start.sh` in the command path.",
		};
	}

	return {
		name: CHECK_NAME,
		status: "fail",
		message: `No mcpServers entry for pigeon found in ${configs.map((c) => c.path).join(", ")}.`,
		fix: 'Add `"pigeon": { "command": "/absolute/path/to/scripts/pigeon-start.sh" }` under mcpServers.',
	};
}

export const mcpRegistrationCheck: Check = {
	name: CHECK_NAME,
	run(): CheckResult {
		return evaluateMcpRegistration(findExistingConfigs());
	},
};
