import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Check, CheckResult } from "../types.js";

const CHECK_NAME = "WAL hygiene";
const WAL_WARN_BYTES = 4 * 1024 * 1024; // 4 MiB — past this, prisma db push has been observed to phantom-drop

function repoRoot(): string {
	const here = fileURLToPath(new URL(".", import.meta.url));
	return resolve(here, "..", "..", "..", "..");
}

export function defaultWalPath(): string {
	return resolve(repoRoot(), "data", "tracker.db-wal");
}

/**
 * Catches the v5.0 phantom-drop foot-gun: a non-trivial WAL file makes
 * Prisma's diff phase see one schema while the apply phase hits another,
 * generating a `DropTable knowledge_fts_config` that has no business
 * happening. Truncating the WAL via PRAGMA wal_checkpoint(TRUNCATE)
 * resolves it.
 */
export function evaluateWalHygiene(walPath: string): CheckResult {
	let size = 0;
	try {
		size = statSync(walPath).size;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return {
				name: CHECK_NAME,
				status: "pass",
				message: "No WAL file present — DB is checkpointed clean.",
			};
		}
		return {
			name: CHECK_NAME,
			status: "skip",
			message: `Could not stat ${walPath}: ${(err as Error).message}`,
		};
	}

	if (size === 0) {
		return {
			name: CHECK_NAME,
			status: "pass",
			message: "WAL exists but is 0 bytes (idle).",
		};
	}

	if (size < WAL_WARN_BYTES) {
		return {
			name: CHECK_NAME,
			status: "pass",
			message: `WAL is ${formatBytes(size)} — within healthy range.`,
		};
	}

	return {
		name: CHECK_NAME,
		status: "warn",
		message: `WAL is ${formatBytes(size)}. Past ~4 MiB, prisma db push has been observed to phantom-drop tables (the v5.0 incident).`,
		fix: 'sqlite3 data/tracker.db "PRAGMA wal_checkpoint(TRUNCATE);"',
	};
}

export const walHygieneCheck: Check = {
	name: CHECK_NAME,
	run(): CheckResult {
		return evaluateWalHygiene(defaultWalPath());
	},
};

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
