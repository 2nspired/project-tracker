import { readFileSync } from "node:fs";
import { type ClaudeConfigPath, findExistingConfigs } from "../config-paths.js";
import type { Check, CheckResult } from "../types.js";

const CHECK_NAME = "Hook drift";

type HookEntry = {
	type?: string;
	server?: string;
	[k: string]: unknown;
};

type Hook = {
	hooks?: HookEntry[];
	[k: string]: unknown;
};

type ClaudeConfig = {
	hooks?: Record<string, Hook[]>;
	[k: string]: unknown;
};

export function evaluateHookDrift(configs: ClaudeConfigPath[]): CheckResult {
	if (configs.length === 0) {
		return {
			name: CHECK_NAME,
			status: "skip",
			message: "No Claude Code config to inspect.",
		};
	}

	const drift: Array<{ path: string; event: string; index: number }> = [];

	for (const cfg of configs) {
		let parsed: ClaudeConfig;
		try {
			parsed = JSON.parse(readFileSync(cfg.path, "utf-8")) as ClaudeConfig;
		} catch {
			continue;
		}

		const hooks = parsed.hooks ?? {};
		for (const [event, list] of Object.entries(hooks)) {
			if (!Array.isArray(list)) continue;
			list.forEach((hook, hookIdx) => {
				const entries = hook?.hooks;
				if (!Array.isArray(entries)) return;
				entries.forEach((entry, entryIdx) => {
					if (entry?.type === "mcp_tool" && entry?.server === "project-tracker") {
						drift.push({
							path: cfg.path,
							event,
							index: hookIdx * 100 + entryIdx,
						});
					}
				});
			});
		}
	}

	if (drift.length === 0) {
		return {
			name: CHECK_NAME,
			status: "pass",
			message: "No hooks reference the legacy project-tracker server name.",
		};
	}

	const summary = drift.map((d) => `${d.path} → hooks.${d.event} entry #${d.index}`).join("; ");

	return {
		name: CHECK_NAME,
		status: "fail",
		message: `${drift.length} hook${drift.length === 1 ? "" : "s"} reference the legacy server name and silently no-op: ${summary}.`,
		fix: 'Open the config and change every `"server": "project-tracker"` to `"server": "pigeon"` inside the affected mcp_tool hooks.',
	};
}

export const hookDriftCheck: Check = {
	name: CHECK_NAME,
	run(): CheckResult {
		return evaluateHookDrift(findExistingConfigs());
	},
};
