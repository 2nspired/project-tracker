import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type ClaudeConfigPath = {
	path: string;
	source: "CLAUDE_CONFIG_DIR" | "claude-alt" | "claude";
};

/**
 * Resolve all Claude Code config paths the user might have. Order matters:
 * the first existing one is the active config; the others are inspected for
 * legacy drift but not assumed authoritative.
 */
export function resolveClaudeConfigPaths(env: NodeJS.ProcessEnv = process.env): ClaudeConfigPath[] {
	const paths: ClaudeConfigPath[] = [];

	const overrideDir = env.CLAUDE_CONFIG_DIR;
	if (overrideDir) {
		paths.push({
			path: resolve(overrideDir, ".claude.json"),
			source: "CLAUDE_CONFIG_DIR",
		});
	}

	const home = homedir();
	paths.push({ path: resolve(home, ".claude-alt", ".claude.json"), source: "claude-alt" });
	paths.push({ path: resolve(home, ".claude.json"), source: "claude" });

	return paths;
}

export function findExistingConfigs(env: NodeJS.ProcessEnv = process.env): ClaudeConfigPath[] {
	const seen = new Set<string>();
	const out: ClaudeConfigPath[] = [];
	for (const p of resolveClaudeConfigPaths(env)) {
		if (seen.has(p.path)) continue;
		if (!existsSync(p.path)) continue;
		seen.add(p.path);
		out.push(p);
	}
	return out;
}
