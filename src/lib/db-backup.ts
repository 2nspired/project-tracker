/**
 * Auto-backup of `data/tracker.db` before `npm run service:update` runs
 * `prisma db push` (#214).
 *
 * The destructive risk is in `db push` — additive changes apply silently,
 * but if a user accepts a destructive prompt (column rename / type narrow
 * / drop) and regrets it, there's no automatic recovery path. This module
 * captures a copy *before* `ensureBuild()` so a roll-back is one `cp`
 * away regardless of the migration shape.
 *
 * Path resolution re-runs on every call (not memoized at module-load) so
 * tests can `process.chdir()` into a tempdir without a `__resetForTests`
 * hatch — same pattern as `src/lib/upgrade-report.ts` (#215).
 */

import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export type BackupResult = {
	/** Absolute path to the main `.db` backup file. */
	path: string;
	/** Size in bytes of the main `.db` backup file (sidecars excluded). */
	size: number;
};

function dbPath(): string {
	return path.resolve("data", "tracker.db");
}

function backupsDir(): string {
	return path.resolve("data", "backups");
}

function backupBaseName(targetVersion: string): string {
	return `tracker-pre-v${targetVersion}.db`;
}

/**
 * Try to copy `src` to `dest`. Resolves to true on success, false when
 * `src` doesn't exist (caller distinguishes "no backup needed" from
 * "real failure"). Any other error is re-thrown.
 */
async function copyIfExists(src: string, dest: string): Promise<boolean> {
	try {
		await copyFile(src, dest);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw err;
	}
}

/**
 * Copy `data/tracker.db` (and its `-wal` / `-shm` sidecars when present)
 * to `data/backups/tracker-pre-v<targetVersion>.db`. Returns null when
 * the source DB doesn't exist (fresh install — backup is a no-op, not
 * an error).
 *
 * Idempotent: re-running for the same `targetVersion` overwrites the
 * existing backup. The launchd service may hold an open connection at
 * call time; we deliberately do *not* run `PRAGMA wal_checkpoint(FULL)`
 * because that would require opening a competing connection from the
 * script process. Copying the WAL alongside is the simpler safety net —
 * worst case is a backup that's a few seconds out of date.
 */
export async function backupDatabase(targetVersion: string): Promise<BackupResult | null> {
	const src = dbPath();
	const destDir = backupsDir();
	const destBase = backupBaseName(targetVersion);
	const dest = path.join(destDir, destBase);

	await mkdir(destDir, { recursive: true });

	const copied = await copyIfExists(src, dest);
	if (!copied) return null;

	// Sidecars: copy when present, ignore when absent.
	await copyIfExists(`${src}-wal`, `${dest}-wal`);
	await copyIfExists(`${src}-shm`, `${dest}-shm`);

	const stats = await stat(dest);
	return { path: dest, size: stats.size };
}

/**
 * Keep the `keep` newest backups (by mtime), delete the rest. Returns
 * the absolute paths of deleted main `.db` files (sidecars are deleted
 * but not returned — they're implementation detail of the backup).
 *
 * Defaults to 5: enough history to roll back through a couple of bad
 * upgrades, not enough to silently fill disk.
 */
export async function pruneBackups(keep = 5): Promise<string[]> {
	const dir = backupsDir();
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}

	const dbFiles = entries.filter(
		(name) => name.startsWith("tracker-pre-v") && name.endsWith(".db")
	);
	if (dbFiles.length <= keep) return [];

	// Sort newest-first by mtime; the tail past `keep` is the deletion set.
	const withStats = await Promise.all(
		dbFiles.map(async (name) => {
			const full = path.join(dir, name);
			const s = await stat(full);
			return { name, full, mtime: s.mtimeMs };
		})
	);
	withStats.sort((a, b) => b.mtime - a.mtime);
	const toDelete = withStats.slice(keep);

	const deleted: string[] = [];
	for (const entry of toDelete) {
		await unlink(entry.full);
		await unlink(`${entry.full}-wal`).catch(() => {});
		await unlink(`${entry.full}-shm`).catch(() => {});
		deleted.push(entry.full);
	}
	return deleted;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
