import type { Check, CheckResult, CheckSummary, DoctorReport } from "./types.js";

export async function runChecks(checks: Check[]): Promise<DoctorReport> {
	const results = await Promise.all(checks.map(async (c) => safeRun(c)));
	return { checks: results, summary: summarize(results) };
}

async function safeRun(check: Check): Promise<CheckResult> {
	try {
		return await check.run();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			name: check.name,
			status: "fail",
			message: `Check threw: ${message}`,
		};
	}
}

function summarize(results: CheckResult[]): CheckSummary {
	const summary: CheckSummary = { pass: 0, fail: 0, warn: 0, skip: 0 };
	for (const r of results) summary[r.status]++;
	return summary;
}
