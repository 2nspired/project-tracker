import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearUpgradeReport,
	readUpgradeReport,
	type UpgradeReport,
	writeUpgradeReport,
} from "@/lib/upgrade-report";

// `upgrade-report.ts` resolves the report path against the *current* cwd.
// Tests therefore chdir into a fresh temp directory, build the expected
// `data/` subdirectory, and let the module write/read inside it. Restoring
// cwd in `afterEach` keeps the rest of the suite unaffected.
let originalCwd: string;
let tmp: string;

beforeEach(async () => {
	originalCwd = process.cwd();
	tmp = await mkdtemp(path.join(tmpdir(), "pigeon-upgrade-report-"));
	const dataDir = path.join(tmp, "data");
	const { mkdir } = await import("node:fs/promises");
	await mkdir(dataDir, { recursive: true });
	process.chdir(tmp);
});

afterEach(async () => {
	process.chdir(originalCwd);
	await rm(tmp, { recursive: true, force: true });
});

const SAMPLE: UpgradeReport = {
	completedAt: "2026-05-01T22:00:00.000Z",
	targetVersion: "6.1.0",
	doctor: {
		summary: { pass: 7, fail: 1, warn: 0, skip: 0 },
		checks: [{ name: "Hook drift", status: "fail", message: "missing" }],
	},
};

describe("upgrade-report (#215)", () => {
	it("round-trips a report through write → read", async () => {
		await writeUpgradeReport(SAMPLE);
		const round = await readUpgradeReport();
		expect(round).toEqual(SAMPLE);
	});

	it("returns null when the file is missing", async () => {
		expect(await readUpgradeReport()).toBeNull();
	});

	it("returns null when the file is unparseable JSON", async () => {
		const { writeFile } = await import("node:fs/promises");
		await writeFile(path.join(tmp, "data", "last-upgrade.json"), "{not-json", "utf8");
		expect(await readUpgradeReport()).toBeNull();
	});

	it("returns null when the JSON parses but is missing required fields", async () => {
		const { writeFile } = await import("node:fs/promises");
		await writeFile(
			path.join(tmp, "data", "last-upgrade.json"),
			JSON.stringify({ completedAt: "x" }),
			"utf8"
		);
		expect(await readUpgradeReport()).toBeNull();
	});

	it("clearUpgradeReport removes the file", async () => {
		await writeUpgradeReport(SAMPLE);
		await clearUpgradeReport();
		expect(await readUpgradeReport()).toBeNull();
	});

	it("clearUpgradeReport is idempotent on a missing file", async () => {
		await expect(clearUpgradeReport()).resolves.toBeUndefined();
		await expect(clearUpgradeReport()).resolves.toBeUndefined();
	});

	it("writes pretty JSON with a trailing newline", async () => {
		await writeUpgradeReport(SAMPLE);
		const raw = await readFile(path.join(tmp, "data", "last-upgrade.json"), "utf8");
		expect(raw).toMatch(/}\n$/);
		expect(raw).toContain("\n  ");
	});
});
