import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase, formatBytes, pruneBackups } from "@/lib/db-backup";

// `db-backup.ts` resolves paths against the *current* cwd. Tests chdir
// into a fresh tempdir, prepare `data/`, and let the module write/read
// inside it. Restoring cwd in `afterEach` keeps the rest of the suite
// unaffected.
let originalCwd: string;
let tmp: string;

beforeEach(async () => {
	originalCwd = process.cwd();
	tmp = await mkdtemp(path.join(tmpdir(), "pigeon-db-backup-"));
	await mkdir(path.join(tmp, "data"), { recursive: true });
	process.chdir(tmp);
});

afterEach(async () => {
	process.chdir(originalCwd);
	await rm(tmp, { recursive: true, force: true });
});

async function seedDb(content = "fake-db-bytes") {
	await writeFile(path.join(tmp, "data", "tracker.db"), content, "utf8");
}

async function seedBackup(version: string, mtimeMs: number) {
	const dir = path.join(tmp, "data", "backups");
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `tracker-pre-v${version}.db`);
	await writeFile(file, version, "utf8");
	const t = new Date(mtimeMs);
	await utimes(file, t, t);
	return file;
}

describe("backupDatabase (#214)", () => {
	it("copies the source DB to data/backups/tracker-pre-v<version>.db", async () => {
		await seedDb("hello");
		const result = await backupDatabase("6.1.0");
		if (!result) throw new Error("expected backup, got null");
		expect(result.path.endsWith("tracker-pre-v6.1.0.db")).toBe(true);
		expect(result.size).toBe("hello".length);
		const copied = await readFile(result.path, "utf8");
		expect(copied).toBe("hello");
	});

	it("returns null when the source DB doesn't exist (fresh install)", async () => {
		const result = await backupDatabase("6.1.0");
		expect(result).toBeNull();
		// No backups dir is required to exist either.
		const dirEntries = await readdir(path.join(tmp, "data", "backups")).catch(() => []);
		expect(dirEntries).toEqual([]);
	});

	it("copies WAL and SHM sidecars when present", async () => {
		await seedDb();
		await writeFile(path.join(tmp, "data", "tracker.db-wal"), "wal-contents");
		await writeFile(path.join(tmp, "data", "tracker.db-shm"), "shm-contents");
		const result = await backupDatabase("6.1.0");
		if (!result) throw new Error("expected backup, got null");
		const wal = await readFile(`${result.path}-wal`, "utf8");
		const shm = await readFile(`${result.path}-shm`, "utf8");
		expect(wal).toBe("wal-contents");
		expect(shm).toBe("shm-contents");
	});

	it("skips sidecars silently when only the main DB exists", async () => {
		await seedDb();
		const result = await backupDatabase("6.1.0");
		expect(result).not.toBeNull();
		const dir = await readdir(path.join(tmp, "data", "backups"));
		expect(dir).toEqual(["tracker-pre-v6.1.0.db"]);
	});

	it("overwrites cleanly on re-run for the same version", async () => {
		await seedDb("v1");
		await backupDatabase("6.1.0");
		await seedDb("v2");
		const result = await backupDatabase("6.1.0");
		if (!result) throw new Error("expected backup, got null");
		const copied = await readFile(result.path, "utf8");
		expect(copied).toBe("v2");
	});
});

describe("pruneBackups (#214)", () => {
	it("keeps the N newest backups (by mtime) and deletes the rest", async () => {
		await seedBackup("6.0.0", Date.now() - 5000);
		await seedBackup("6.1.0", Date.now() - 3000);
		await seedBackup("6.2.0", Date.now() - 1000);

		const deleted = await pruneBackups(2);
		// macOS resolves `tmp` (/var/...) and the script's cwd (/private/var/...)
		// to different absolute path strings even though they point at the same
		// inode. Compare basenames to side-step that mismatch.
		expect(deleted.map((p) => path.basename(p))).toEqual(["tracker-pre-v6.0.0.db"]);

		const remaining = (await readdir(path.join(tmp, "data", "backups"))).sort();
		expect(remaining).toEqual(["tracker-pre-v6.1.0.db", "tracker-pre-v6.2.0.db"]);
	});

	it("is a no-op when fewer than `keep` backups exist", async () => {
		await seedBackup("6.0.0", Date.now() - 1000);
		await seedBackup("6.1.0", Date.now());
		const deleted = await pruneBackups(5);
		expect(deleted).toEqual([]);
	});

	it("returns [] when the backups dir doesn't exist", async () => {
		const deleted = await pruneBackups(5);
		expect(deleted).toEqual([]);
	});

	it("deletes matching -wal / -shm sidecars when pruning", async () => {
		const target = await seedBackup("6.0.0", Date.now() - 5000);
		await writeFile(`${target}-wal`, "w");
		await writeFile(`${target}-shm`, "s");
		await seedBackup("6.1.0", Date.now() - 1000);

		await pruneBackups(1);

		const remaining = await readdir(path.join(tmp, "data", "backups"));
		expect(remaining.sort()).toEqual(["tracker-pre-v6.1.0.db"]);
	});

	it("ignores files that don't match the tracker-pre-v* pattern", async () => {
		await seedBackup("6.0.0", Date.now() - 1000);
		// Stranger file in the backups dir — should be left alone.
		await writeFile(path.join(tmp, "data", "backups", "README.md"), "hi");
		const deleted = await pruneBackups(0);
		expect(deleted).toHaveLength(1);
		const remaining = await readdir(path.join(tmp, "data", "backups"));
		expect(remaining).toContain("README.md");
	});
});

describe("formatBytes (#214)", () => {
	it("formats bytes / KiB / MiB / GiB", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2048)).toBe("2.0 KiB");
		expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MiB");
		expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GiB");
	});
});
