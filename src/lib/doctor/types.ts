export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export type CheckResult = {
	name: string;
	status: CheckStatus;
	message: string;
	fix?: string;
};

export type CheckSummary = {
	pass: number;
	fail: number;
	warn: number;
	skip: number;
};

export type DoctorReport = {
	checks: CheckResult[];
	summary: CheckSummary;
};

export type Check = {
	name: string;
	run: () => Promise<CheckResult> | CheckResult;
};
