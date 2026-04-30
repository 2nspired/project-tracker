import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/doctor/runner";
import type { Check } from "@/lib/doctor/types";

const passCheck: Check = {
	name: "p",
	run: () => ({ name: "p", status: "pass", message: "ok" }),
};

const failCheck: Check = {
	name: "f",
	run: () => ({ name: "f", status: "fail", message: "broke", fix: "do x" }),
};

const warnCheck: Check = {
	name: "w",
	run: () => ({ name: "w", status: "warn", message: "ish" }),
};

const skipCheck: Check = {
	name: "s",
	run: () => ({ name: "s", status: "skip", message: "n/a" }),
};

const throwsCheck: Check = {
	name: "t",
	run: () => {
		throw new Error("boom");
	},
};

describe("runChecks", () => {
	it("returns one result per check, preserving order", async () => {
		const report = await runChecks([passCheck, failCheck, warnCheck]);
		expect(report.checks.map((c) => c.name)).toEqual(["p", "f", "w"]);
	});

	it("summarizes counts per status", async () => {
		const report = await runChecks([passCheck, passCheck, failCheck, warnCheck, skipCheck]);
		expect(report.summary).toEqual({ pass: 2, fail: 1, warn: 1, skip: 1 });
	});

	it("converts a thrown error into a fail result instead of crashing", async () => {
		const report = await runChecks([throwsCheck]);
		expect(report.summary.fail).toBe(1);
		expect(report.checks[0].message).toMatch(/boom/);
	});

	it("isolates checks — one throw doesn't poison the others", async () => {
		const report = await runChecks([passCheck, throwsCheck, passCheck]);
		expect(report.summary.pass).toBe(2);
		expect(report.summary.fail).toBe(1);
	});
});
