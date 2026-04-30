import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateWalHygiene } from "@/lib/doctor/checks/wal-hygiene";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(resolve(tmpdir(), "doctor-wal-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("evaluateWalHygiene", () => {
	it("passes when WAL file is missing entirely", () => {
		const result = evaluateWalHygiene(resolve(tmp, "nonexistent-wal"));
		expect(result.status).toBe("pass");
		expect(result.message).toMatch(/checkpointed clean/);
	});

	it("passes when WAL is 0 bytes", () => {
		const path = resolve(tmp, "wal");
		writeFileSync(path, "");
		const result = evaluateWalHygiene(path);
		expect(result.status).toBe("pass");
		expect(result.message).toMatch(/0 bytes/);
	});

	it("passes when WAL is below the warn threshold", () => {
		const path = resolve(tmp, "wal");
		writeFileSync(path, Buffer.alloc(1024 * 1024)); // 1 MiB
		const result = evaluateWalHygiene(path);
		expect(result.status).toBe("pass");
		expect(result.message).toMatch(/healthy range/);
	});

	it("warns when WAL is at or past the threshold", () => {
		const path = resolve(tmp, "wal");
		writeFileSync(path, Buffer.alloc(5 * 1024 * 1024)); // 5 MiB
		const result = evaluateWalHygiene(path);
		expect(result.status).toBe("warn");
		expect(result.message).toMatch(/phantom-drop/);
		expect(result.fix).toMatch(/wal_checkpoint/);
	});
});
