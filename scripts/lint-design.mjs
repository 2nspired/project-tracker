#!/usr/bin/env node
/**
 * Design-system lint — fails PRs that introduce known anti-patterns.
 *
 *   npm run lint:design                      # check (CI gate)
 *   npm run lint:design -- --update-baseline # rewrite the known-violations baseline (use sparingly)
 *
 * Five rules, all matched by regex against `src/**\/*.{ts,tsx}`:
 *
 * 1. arbitrary-text-size  : `text-\[\d+(?:px|rem)\]` — bypasses the type scale.
 * 2. raw-priority-color   : `text-(?:emerald|green|amber|orange|red)-\d+` outside priority-colors.ts.
 * 3. raw-animate-pulse    : `animate-pulse` outside the Skeleton primitive.
 * 4. raw-transition-all   : `transition-all` outside ui/button.tsx — too broad; use an
 *                           explicit transition list (`transition-[box-shadow,opacity]`,
 *                           `transition-[width]`, `transition-transform`, …) so layout-y
 *                           properties don't get pulled into the animation by accident.
 * 5. raw-violet-class     : `(stroke|fill|bg|border|text)-violet-\d+` — use `--accent-violet` token (`bg-accent-violet`, `stroke-accent-violet`, …) or the <Dot tone="agent"> / <Sparkline tone="cost"> primitives. Allowlisted in `priority-colors.ts` (palette mapping) and `project-colors.ts` (user-pickable project palette).
 *
 * Ratchet pattern (Stripe/Linear): existing violations are recorded in
 * `scripts/design-lint-baseline.json` and ignored. New violations fail the
 * lint. Per-line escape hatch: `// design-lint-allow:<rule>` comment on
 * the same or previous line. Removing a violation is rewarded — re-running
 * with --update-baseline shrinks the baseline.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SRC_DIR = resolve(REPO_ROOT, "src");
const BASELINE_PATH = resolve(SCRIPT_DIR, "design-lint-baseline.json");

const RULES = [
	{
		id: "arbitrary-text-size",
		pattern: /text-\[\d+(?:px|rem)\]/g,
		reason: "use the type scale (text-2xs / text-xs / text-sm / …) — arbitrary px/rem bypasses tokens",
		allowFiles: [],
	},
	{
		id: "raw-priority-color",
		pattern: /text-(?:emerald|green|amber|orange|red)-\d+/g,
		reason: "use semantic vars from src/lib/priority-colors.ts instead of raw color tokens",
		allowFiles: ["src/lib/priority-colors.ts"],
	},
	{
		id: "raw-animate-pulse",
		pattern: /animate-pulse/g,
		reason: "use the <Skeleton> primitive from src/components/ui/skeleton.tsx instead of raw animate-pulse",
		allowFiles: ["src/components/ui/skeleton.tsx"],
	},
	{
		id: "raw-transition-all",
		pattern: /transition-all\b/g,
		reason: "use an explicit transition list (transition-[box-shadow,opacity], transition-[width], transition-transform, …) — `transition-all` is too broad and animates layout properties by accident",
		allowFiles: ["src/components/ui/button.tsx"],
	},
	{
		id: "raw-violet-class",
		pattern: /(?:stroke|fill|bg|border|text)-violet-\d+/g,
		reason:
			"use the --accent-violet token (`bg-accent-violet`, `stroke-accent-violet`, …) or the <Dot tone=\"agent\"> / <Sparkline tone=\"cost\"> primitives instead of raw violet-* classes",
		allowFiles: ["src/lib/priority-colors.ts", "src/lib/project-colors.ts"],
	},
];

/** Recursively collect .ts and .tsx files under a directory. */
function collectFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (name === "node_modules" || name === ".next" || name === "dist") continue;
			out.push(...collectFiles(full));
			continue;
		}
		if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
	}
	return out;
}

/**
 * Walk a file and collect every regex match for every rule.
 * Honors `// design-lint-allow:<rule>` on the same line or the previous line.
 */
function collectViolations(file) {
	const rel = relative(REPO_ROOT, file);
	const text = readFileSync(file, "utf8");
	const lines = text.split("\n");
	const violations = [];

	for (const rule of RULES) {
		if (rule.allowFiles.includes(rel)) continue;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const prev = i > 0 ? lines[i - 1] : "";
			const allowToken = `design-lint-allow:${rule.id}`;
			if (line.includes(allowToken) || prev.includes(allowToken)) continue;

			rule.pattern.lastIndex = 0;
			let match;
			while ((match = rule.pattern.exec(line)) !== null) {
				violations.push({
					file: rel,
					line: i + 1,
					col: match.index + 1,
					match: match[0],
					rule: rule.id,
					reason: rule.reason,
				});
			}
		}
	}

	return violations;
}

function loadBaseline() {
	try {
		const raw = readFileSync(BASELINE_PATH, "utf8");
		return JSON.parse(raw);
	} catch {
		return { generatedAt: null, violations: [] };
	}
}

function violationKey(v) {
	return `${v.file}::${v.line}::${v.rule}::${v.match}`;
}

function main() {
	const args = process.argv.slice(2);
	const updateBaseline = args.includes("--update-baseline");

	const files = collectFiles(SRC_DIR);
	const all = [];
	for (const f of files) all.push(...collectViolations(f));

	if (updateBaseline) {
		const baseline = {
			generatedAt: new Date().toISOString(),
			note: "Auto-generated by `npm run lint:design -- --update-baseline`. New violations fail the lint; existing entries are grandfathered until each cleanup card lands.",
			violations: all
				.map((v) => ({ file: v.file, line: v.line, rule: v.rule, match: v.match }))
				.sort((a, b) =>
					a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule)
				),
		};
		writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, "\t")}\n`);
		console.log(`✓ wrote ${relative(REPO_ROOT, BASELINE_PATH)} (${all.length} entries)`);
		return;
	}

	const baseline = loadBaseline();
	// Baseline keys ignore line number — refactors that move a known violation
	// shouldn't fail the lint. Match on file + rule + match.
	const baselineLooseKeys = new Set(
		baseline.violations.map((v) => `${v.file}::${v.rule}::${v.match}`)
	);
	const baselineCounts = new Map();
	for (const v of baseline.violations) {
		const k = `${v.file}::${v.rule}::${v.match}`;
		baselineCounts.set(k, (baselineCounts.get(k) ?? 0) + 1);
	}

	const newViolations = [];
	const seenCounts = new Map();
	for (const v of all) {
		const k = `${v.file}::${v.rule}::${v.match}`;
		const allowed = baselineCounts.get(k) ?? 0;
		const seen = seenCounts.get(k) ?? 0;
		if (seen < allowed) {
			seenCounts.set(k, seen + 1);
			continue;
		}
		newViolations.push(v);
	}

	if (newViolations.length === 0) {
		const baselineSize = baseline.violations.length;
		console.log(
			`✓ design lint clean (${all.length} matches, ${baselineSize} grandfathered in baseline)`
		);
		return;
	}

	console.error(`✗ design lint found ${newViolations.length} new violation(s):`);
	for (const v of newViolations) {
		console.error(`  ${v.file}:${v.line}:${v.col}  [${v.rule}]  ${v.match}`);
		console.error(`    → ${v.reason}`);
	}
	console.error("");
	console.error("Fix the violation, or add `// design-lint-allow:<rule> — <reason or card ref>`");
	console.error("on the offending line if there's a justified one-off.");
	process.exit(1);
}

main();
