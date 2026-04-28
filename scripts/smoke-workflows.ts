#!/usr/bin/env tsx
/**
 * Smoke test for the workflow registry (card #90).
 *
 * Validates structural invariants of src/mcp/workflows.ts against the live
 * tool registry — catches drift when a tool gets renamed or removed without
 * the workflow record being updated.
 *
 * Checks:
 *   1. Workflow `name` values are unique.
 *   2. Every step's `tool` resolves to a registered MCP tool (essential
 *      from manifest.ts ESSENTIAL_TOOLS, or extended from tool-registry).
 *   3. Slash-command references (when present) point at files that exist
 *      in .claude/commands/.
 *
 * Run: `tsx scripts/smoke-workflows.ts` — exits 0 on success, 1 on failure.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Side-effect imports: populate the extended tool registry. Mirrors the order
// in src/mcp/server.ts so the registry sees the same surface the running
// server does.
import "../src/mcp/extended-tools.js";
import "../src/mcp/tools/discovery-tools.js";
import "../src/mcp/tools/relation-tools.js";
import "../src/mcp/tools/session-tools.js";
import "../src/mcp/tools/decision-tools.js";
import "../src/mcp/tools/context-tools.js";
import "../src/mcp/tools/query-tools.js";
import "../src/mcp/tools/git-tools.js";
import "../src/mcp/tools/summary-tools.js";
import "../src/mcp/tools/onboarding-tools.js";
import "../src/mcp/tools/status-tools.js";
import "../src/mcp/tools/fact-tools.js";
import "../src/mcp/tools/claim-tools.js";
import "../src/mcp/tools/knowledge-tools.js";
import "../src/mcp/tools/instrumentation-tools.js";

import { ESSENTIAL_TOOLS } from "../src/mcp/manifest.js";
import { getAllExtendedTools } from "../src/mcp/tool-registry.js";
import { WORKFLOWS } from "../src/mcp/workflows.js";

const failures: string[] = [];

// ─── Build the universe of valid tool names ────────────────────────
const essentialNames = new Set(ESSENTIAL_TOOLS.map((t) => t.name));
const extendedNames = new Set(getAllExtendedTools().map((t) => t.name));
const allTools = new Set([...essentialNames, ...extendedNames]);

console.log(
	`Registered: ${essentialNames.size} essential + ${extendedNames.size} extended = ${allTools.size} total tools`
);
console.log(`Workflows:  ${WORKFLOWS.length}`);

// ─── Check 1: workflow names are unique ───────────────────────────
const seen = new Set<string>();
for (const w of WORKFLOWS) {
	if (seen.has(w.name)) {
		failures.push(`Duplicate workflow name: "${w.name}"`);
	}
	seen.add(w.name);
}

// ─── Check 2: every step.tool resolves ────────────────────────────
for (const w of WORKFLOWS) {
	for (let i = 0; i < w.steps.length; i++) {
		const step = w.steps[i];
		if (!allTools.has(step.tool)) {
			failures.push(
				`Workflow "${w.name}" step ${i + 1} references unknown tool: "${step.tool}". ` +
					`Available: essential=[${[...essentialNames].sort().join(", ")}], ` +
					`extended-count=${extendedNames.size}`
			);
		}
	}
}

// ─── Check 3: slash-command files exist ───────────────────────────
// Scripts run from repo root by convention (`tsx scripts/...`).
const repoRoot = process.cwd();
for (const w of WORKFLOWS) {
	if (!w.slashCommand) continue;
	// Slash command "/brief-me" → file ".claude/commands/brief-me.md"
	const fileName = w.slashCommand.replace(/^\//, "") + ".md";
	const fullPath = resolve(repoRoot, ".claude/commands", fileName);
	if (!existsSync(fullPath)) {
		failures.push(
			`Workflow "${w.name}" references slashCommand "${w.slashCommand}" but ${fullPath} does not exist.`
		);
	}
}

// ─── Report ─────────────────────────────────────────────────────────
if (failures.length === 0) {
	console.log(`\nAll ${WORKFLOWS.length} workflows valid.`);
	process.exit(0);
} else {
	console.error(`\n${failures.length} validation failure(s):`);
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
