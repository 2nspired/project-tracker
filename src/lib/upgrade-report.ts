/**
 * Disk-backed signal from `npm run service:update` (#215).
 *
 * `scripts/service.ts` runs the doctor checks immediately after the
 * launchd service is restarted and writes the result here. The MCP
 * `briefMe` handler reads it on the next session start, surfaces a
 * concise summary as `_upgradeReport`, and fire-and-forget clears the
 * file so the second briefMe in the same session doesn't re-surface
 * stale upgrade noise.
 *
 * Path is anchored on `path.resolve("data", "last-upgrade.json")` —
 * both the script and the launchd service have `WorkingDirectory =
 * <repo>` (see `scripts/service.ts:71`), so the same path resolves in
 * every callsite.
 */

import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DoctorReport } from "@/lib/doctor";

export type UpgradeReport = {
	/** ISO timestamp of when `service:update` finished and the doctor pass ran. */
	completedAt: string;
	/** `package.json.version` at write time — the version we just upgraded *to*. */
	targetVersion: string;
	/** Full doctor report (all checks). briefMe surfaces a subset; the file is the audit trail. */
	doctor: DoctorReport;
};

// Re-resolved on every call rather than memoized at module-load: the
// launchd service and the script process *should* both have cwd =
// repo root, so this is the same path in practice — but keeping it
// dynamic makes the module trivially testable without a `__resetForTests`
// hatch (tests just chdir into a fresh tempdir).
function reportPath(): string {
	return path.resolve("data", "last-upgrade.json");
}

function isWellFormedReport(parsed: unknown): parsed is UpgradeReport {
	if (!parsed || typeof parsed !== "object") return false;
	const obj = parsed as Record<string, unknown>;
	if (typeof obj.completedAt !== "string" || typeof obj.targetVersion !== "string") return false;
	if (!obj.doctor || typeof obj.doctor !== "object") return false;
	const doctor = obj.doctor as Record<string, unknown>;
	if (!doctor.summary || typeof doctor.summary !== "object") return false;
	if (!Array.isArray(doctor.checks)) return false;
	return true;
}

export async function readUpgradeReport(): Promise<UpgradeReport | null> {
	try {
		const content = await readFile(reportPath(), "utf8");
		const parsed = JSON.parse(content);
		return isWellFormedReport(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function writeUpgradeReport(report: UpgradeReport): Promise<void> {
	await writeFile(reportPath(), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function clearUpgradeReport(): Promise<void> {
	try {
		await unlink(reportPath());
	} catch {
		// Idempotent: missing file is the success state.
	}
}

/** Reports older than this are ignored by the briefMe handler. */
export const UPGRADE_REPORT_STALE_MS = 24 * 60 * 60 * 1000;
