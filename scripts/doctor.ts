#!/usr/bin/env -S npx tsx
/**
 * pigeon doctor — install health check.
 *
 * Runs the 8 doctor checks and pretty-prints results with status glyphs and
 * copy-pasteable fix commands. Exits 0 when nothing failed (warns are OK),
 * 1 when at least one check is in `fail`.
 *
 * Reuses src/lib/doctor; the same check set powers the `doctor` MCP tool.
 */

import { runDoctor } from "@/lib/doctor/index.js";
import type { CheckResult, CheckStatus } from "@/lib/doctor/types.js";

const COLORS = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};

const noColor = process.env.NO_COLOR === "1" || !process.stdout.isTTY;

function color(c: keyof typeof COLORS, s: string): string {
	return noColor ? s : `${COLORS[c]}${s}${COLORS.reset}`;
}

function glyph(status: CheckStatus): string {
	switch (status) {
		case "pass":
			return color("green", "✓");
		case "fail":
			return color("red", "✗");
		case "warn":
			return color("yellow", "!");
		case "skip":
			return color("gray", "·");
	}
}

function statusLabel(status: CheckStatus): string {
	switch (status) {
		case "pass":
			return color("green", "PASS");
		case "fail":
			return color("red", "FAIL");
		case "warn":
			return color("yellow", "WARN");
		case "skip":
			return color("gray", "SKIP");
	}
}

function printHeader() {
	const title = "Pigeon Doctor — install health check";
	const rule = "─".repeat(title.length);
	console.log("");
	console.log(color("bold", title));
	console.log(color("dim", rule));
}

function printResult(r: CheckResult) {
	console.log(`${glyph(r.status)} ${color("bold", r.name.padEnd(28))} ${statusLabel(r.status)}`);
	console.log(`  ${r.message}`);
	if (r.fix) {
		console.log(`  ${color("cyan", "→ fix:")} ${r.fix}`);
	}
}

function printFooter(summary: { pass: number; fail: number; warn: number; skip: number }) {
	const parts: string[] = [];
	if (summary.pass) parts.push(color("green", `${summary.pass} pass`));
	if (summary.warn) parts.push(color("yellow", `${summary.warn} warn`));
	if (summary.fail) parts.push(color("red", `${summary.fail} fail`));
	if (summary.skip) parts.push(color("gray", `${summary.skip} skip`));

	console.log("");
	console.log(parts.join(" · "));

	if (summary.fail === 0 && summary.warn === 0) {
		console.log(color("green", "All checks passed."));
	} else if (summary.fail === 0) {
		console.log(color("yellow", "No failures, but worth a look at the warnings."));
	} else {
		console.log(color("red", `${summary.fail} issue${summary.fail === 1 ? "" : "s"} found.`));
	}
	console.log("");
}

async function main() {
	printHeader();
	const report = await runDoctor();
	for (const r of report.checks) printResult(r);
	printFooter(report.summary);
	process.exit(report.summary.fail > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(color("red", "doctor crashed:"), err);
	process.exit(2);
});
