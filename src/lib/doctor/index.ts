import { connectedReposCheck } from "./checks/connected-repos.js";
import { fts5SanityCheck } from "./checks/fts5-sanity.js";
import { hookDriftCheck } from "./checks/hook-drift.js";
import { launchdLabelCheck } from "./checks/launchd-label.js";
import { mcpRegistrationCheck } from "./checks/mcp-registration.js";
import { serverVersionCheck } from "./checks/server-version.js";
import { trackerMdCheck } from "./checks/tracker-md.js";
import { walHygieneCheck } from "./checks/wal-hygiene.js";
import { runChecks } from "./runner.js";
import type { Check, DoctorReport } from "./types.js";

export const DOCTOR_CHECKS: Check[] = [
	mcpRegistrationCheck,
	hookDriftCheck,
	launchdLabelCheck,
	connectedReposCheck,
	serverVersionCheck,
	trackerMdCheck,
	walHygieneCheck,
	fts5SanityCheck,
];

export async function runDoctor(): Promise<DoctorReport> {
	return runChecks(DOCTOR_CHECKS);
}

export type { Check, CheckResult, CheckStatus, CheckSummary, DoctorReport } from "./types.js";
