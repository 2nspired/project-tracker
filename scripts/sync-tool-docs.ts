#!/usr/bin/env tsx
/**
 * Regenerate the Essential + Extended tool tables in README.md and the
 * docs site's tools.mdx from the MCP server's actual registry. Keeps docs
 * from drifting as tools are added, removed, or re-categorized.
 *
 *   npm run docs:sync           # rewrite tables in place
 *   npm run docs:sync -- --check  # exit 1 if files would change (for CI)
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Populate the registry by importing every tool module. Order matches server.ts.
import "../src/mcp/extended-tools.js";
import "../src/mcp/tools/claim-tools.js";
import "../src/mcp/tools/context-tools.js";
import "../src/mcp/tools/decision-tools.js";
import "../src/mcp/tools/discovery-tools.js";
import "../src/mcp/tools/fact-tools.js";
import "../src/mcp/tools/git-tools.js";
import "../src/mcp/tools/instrumentation-tools.js";
import "../src/mcp/tools/knowledge-tools.js";
import "../src/mcp/tools/onboarding-tools.js";
import "../src/mcp/tools/query-tools.js";
import "../src/mcp/tools/relation-tools.js";
import "../src/mcp/tools/session-tools.js";
import "../src/mcp/tools/status-tools.js";
import "../src/mcp/tools/summary-tools.js";

import { ESSENTIAL_TOOLS } from "../src/mcp/manifest.js";
import { getAllExtendedTools } from "../src/mcp/tool-registry.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const README = resolve(REPO_ROOT, "README.md");
const TOOLS_MDX = resolve(REPO_ROOT, "docs-site/src/content/docs/tools.mdx");

type MarkerPair = { start: string; end: string };
const ESSENTIALS: MarkerPair = {
	start: "<!-- tracker:essentials:start -->",
	end: "<!-- tracker:essentials:end -->",
};
const EXTENDED: MarkerPair = {
	start: "<!-- tracker:extended:start -->",
	end: "<!-- tracker:extended:end -->",
};

function renderEssentialsTable(opts: { heading?: string } = {}): string {
	const header = "| Tool | What it does |\n| --- | --- |";
	const rows = ESSENTIAL_TOOLS.map((t) => `| \`${t.name}\` | ${t.description} |`).join("\n");
	const parts: string[] = [ESSENTIALS.start];
	if (opts.heading) parts.push(opts.heading, "");
	parts.push(header, rows, ESSENTIALS.end);
	return parts.join("\n");
}

function renderExtendedTable(opts: { heading?: string } = {}): string {
	const tools = getAllExtendedTools();
	const byCategory = new Map<string, string[]>();
	for (const t of tools) {
		const list = byCategory.get(t.category) ?? [];
		list.push(t.name);
		byCategory.set(t.category, list);
	}
	const categories = Array.from(byCategory.entries()).sort(([a], [b]) => a.localeCompare(b));
	const header = "| Category | Count | Tools |\n| --- | --- | --- |";
	const rows = categories
		.map(([cat, names]) => {
			const sorted = names.slice().sort();
			const formatted = sorted.map((n) => `\`${n}\``).join(", ");
			return `| \`${cat}\` | ${sorted.length} | ${formatted} |`;
		})
		.join("\n");
	const parts: string[] = [EXTENDED.start];
	if (opts.heading) parts.push(opts.heading, "");
	parts.push(header, rows, EXTENDED.end);
	return parts.join("\n");
}

function replaceBlock(source: string, marker: MarkerPair, replacement: string): string {
	const startIdx = source.indexOf(marker.start);
	const endIdx = source.indexOf(marker.end);
	if (startIdx === -1 && endIdx === -1) {
		// Target file doesn't use this block — leave it untouched.
		return source;
	}
	if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
		throw new Error(`Marker block ${marker.start} ... ${marker.end} is malformed`);
	}
	const before = source.slice(0, startIdx);
	const after = source.slice(endIdx + marker.end.length);
	return before + replacement + after;
}

type Target = {
	path: string;
	render: () => Promise<string>;
};

async function syncTarget(target: Target, check: boolean): Promise<boolean> {
	const original = await readFile(target.path, "utf8");
	const next = await target.render();
	const rel = relative(REPO_ROOT, target.path);

	if (next === original) {
		console.log(`✓ tool tables in ${rel} are up to date`);
		return false;
	}

	if (check) {
		console.error(`✗ ${rel} tool tables are out of date — run \`npm run docs:sync\``);
		return true;
	}

	await writeFile(target.path, next);
	console.log(`✓ regenerated tool tables in ${rel}`);
	return true;
}

async function main() {
	const check = process.argv.includes("--check");

	const targets: Target[] = [
		{
			path: README,
			render: async () => {
				const original = await readFile(README, "utf8");
				let next = replaceBlock(
					original,
					ESSENTIALS,
					renderEssentialsTable({
						heading: `### Essential Tools (${ESSENTIAL_TOOLS.length})`,
					})
				);
				next = replaceBlock(
					next,
					EXTENDED,
					renderExtendedTable({ heading: "### Extended Tools (by category)" })
				);
				return next;
			},
		},
		{
			path: TOOLS_MDX,
			render: async () => {
				const original = await readFile(TOOLS_MDX, "utf8");
				let next = replaceBlock(original, ESSENTIALS, renderEssentialsTable());
				next = replaceBlock(next, EXTENDED, renderExtendedTable());
				return next;
			},
		},
	];

	let drift = false;
	for (const target of targets) {
		if (await syncTarget(target, check)) drift = true;
	}

	if (check && drift) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
