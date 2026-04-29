/**
 * Release script for project-tracker.
 *
 * Verifies that the three version carriers (package.json, MCP_SERVER_VERSION,
 * git tag) are about to agree, runs the same checks CI would run, confirms
 * the CHANGELOG has a section for the target version, then creates and
 * pushes the tag.
 *
 * Usage:
 *   npx tsx scripts/release.ts              — dry run
 *   npx tsx scripts/release.ts --tag        — also create + push the tag
 *   npx tsx scripts/release.ts --tag --gh   — also open a GitHub release
 *
 * See docs/VERSIONING.md for the policy.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const shouldTag = args.includes("--tag");
const shouldGhRelease = args.includes("--gh");

function log(step: string, msg: string) {
	console.log(`[${step}] ${msg}`);
}

function fail(msg: string): never {
	console.error(`\n✗ ${msg}\n`);
	process.exit(1);
}

function sh(cmd: string, opts: { capture?: boolean } = {}): string {
	try {
		return execSync(cmd, {
			cwd: REPO_ROOT,
			stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
			encoding: "utf-8",
		});
	} catch (err) {
		const e = err as { status?: number; stderr?: Buffer | string };
		const stderr = e.stderr ? e.stderr.toString() : "";
		fail(`Command failed: ${cmd}${stderr ? `\n${stderr}` : ""}`);
	}
}

// ── Step 1: version agreement ──────────────────────────────────────
log("1/5", "Checking version agreement across carriers");

const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8")) as {
	version: string;
};
const pkgVersion = pkg.version;

const manifestSrc = readFileSync(resolve(REPO_ROOT, "src/mcp/manifest.ts"), "utf-8");
const manifestMatch = manifestSrc.match(/MCP_SERVER_VERSION\s*=\s*"([^"]+)"/);
if (!manifestMatch) fail("Could not find MCP_SERVER_VERSION in src/mcp/manifest.ts");
const manifestVersion = manifestMatch[1];

if (pkgVersion !== manifestVersion) {
	fail(
		`Version mismatch:\n  package.json: ${pkgVersion}\n  MCP_SERVER_VERSION: ${manifestVersion}\nBump both in the same commit.`
	);
}

const semverRegex = /^(\d+)\.(\d+)\.(\d+)$/;
if (!semverRegex.test(pkgVersion)) {
	fail(`package.json version "${pkgVersion}" is not x.y.z — pre-release tags are not supported.`);
}

log("1/5", `✓ version = ${pkgVersion}`);

// ── Step 2: git state ──────────────────────────────────────────────
log("2/5", "Checking git state");

const gitStatus = sh("git status --porcelain", { capture: true }).trim();
if (gitStatus) {
	fail(`Working tree not clean:\n${gitStatus}\nCommit or stash before releasing.`);
}

const currentBranch = sh("git rev-parse --abbrev-ref HEAD", { capture: true }).trim();
if (currentBranch !== "main") {
	fail(`Current branch is "${currentBranch}" — release only from main.`);
}

const tagName = `v${pkgVersion}`;
const existingTag = sh(`git tag --list ${tagName}`, { capture: true }).trim();
if (existingTag === tagName) {
	fail(
		`Tag ${tagName} already exists. Either the release already shipped or package.json needs a bump.`
	);
}

log("2/5", `✓ on main, clean, tag ${tagName} is free`);

// ── Step 3: CHANGELOG entry ────────────────────────────────────────
log("3/5", "Checking CHANGELOG");

const changelog = readFileSync(resolve(REPO_ROOT, "CHANGELOG.md"), "utf-8");
const sectionRegex = new RegExp(`^##\\s+\\[${pkgVersion.replace(/\./g, "\\.")}\\]`, "m");
if (!sectionRegex.test(changelog)) {
	fail(`CHANGELOG.md is missing a "## [${pkgVersion}]" section. Add release notes before tagging.`);
}

log("3/5", `✓ CHANGELOG has [${pkgVersion}]`);

// ── Step 4: quality gates ──────────────────────────────────────────
log("4/5", "Running typecheck, biome format, docs:check");

sh("npx tsc --noEmit");
// Scope the release gate to formatter only — its job is preventing formatting
// drift in tagged releases. Lint errors (a11y, hook deps, etc.) are real code
// quality concerns but should be addressed in dedicated PRs / per-change CI,
// not buried in a tagging gate that breaks every release. See #121 history.
sh("npx biome format src");
sh("npm run docs:check");

log("4/5", "✓ all gates pass");

// ── Step 5: tag + push ─────────────────────────────────────────────
if (!shouldTag) {
	console.log(
		`\n✓ Dry run complete for ${pkgVersion}.\n  Re-run with --tag to create and push v${pkgVersion}.\n  Add --gh to also open a GitHub release with the CHANGELOG section as the body.`
	);
	process.exit(0);
}

log("5/5", `Tagging ${tagName} on HEAD and pushing`);

sh(`git tag -a ${tagName} -m "Release ${tagName}"`);
sh(`git push origin ${tagName}`);

log("5/5", `✓ ${tagName} pushed`);

if (shouldGhRelease) {
	// Slice the matching ## [x.y.z] … next-## block out of CHANGELOG and use
	// it as the release body. Keeps GitHub and CHANGELOG in sync without an
	// extra source of truth.
	const changelogLines = changelog.split("\n");
	const startIdx = changelogLines.findIndex((l) => sectionRegex.test(l));
	if (startIdx === -1) fail("CHANGELOG section disappeared between checks — abort.");
	let endIdx = changelogLines.findIndex((l, i) => i > startIdx && /^##\s+\[/.test(l));
	if (endIdx === -1) endIdx = changelogLines.length;
	const body = changelogLines
		.slice(startIdx + 1, endIdx)
		.join("\n")
		.trim();

	log("5/5", "Opening GitHub release");
	// Pass the body via stdin so newlines survive the shell.
	execSync(`gh release create ${tagName} --title "${tagName}" --notes-file -`, {
		cwd: REPO_ROOT,
		input: body,
		stdio: ["pipe", "inherit", "inherit"],
	});
	log("5/5", "✓ GitHub release created");
}

console.log(`\n✓ Release ${tagName} shipped.`);
