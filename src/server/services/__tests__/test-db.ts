// ─── DB-backed test fixture (project-wide pattern, established #190) ───
//
// Pattern of choice: per-suite temp SQLite file under the OS temp dir,
// schema applied at fixture-creation time via the SQL emitted by
// `prisma migrate diff --from-empty --to-schema`. Each `createTestDb()`
// call returns a fresh, isolated PrismaClient — no cross-test bleed.
//
// Why a temp file rather than spec-suggested `file::memory:?cache=shared`:
// the Prisma better-sqlite3 adapter passes the URL through to better-sqlite3,
// which interprets `:memory:` as a per-connection database. Combined with
// Prisma's connection pooling, two queries against the "same" :memory: DB
// can land on different empty databases. The shared-cache variant works
// in CLI sqlite3 but doesn't survive Prisma's adapter wiring on this
// version (7.6) — falling back to per-suite temp files is the spec's
// option (a) sibling and gives identical isolation guarantees with no
// surprises. Future cards inherit this fixture verbatim.
//
// Cleanup contract: callers must invoke the returned `cleanup()` in
// `afterAll`. It disconnects the Prisma client and unlinks the temp file.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "prisma/generated/client";

// Generate the schema SQL once per Vitest worker. `prisma migrate diff`
// is a non-trivial CLI bootstrap (~600ms) — caching trims test wall time
// when multiple suites use the fixture.
let cachedSchemaSql: string | null = null;

function getSchemaSql(): string {
	if (cachedSchemaSql) return cachedSchemaSql;
	// Resolve from repo root rather than process.cwd() — Vitest sometimes
	// runs from a sub-directory depending on invocation.
	const repoRoot = path.resolve(__dirname, "../../../..");
	const schemaPath = path.join(repoRoot, "prisma", "schema.prisma");
	const out = execFileSync(
		"npx",
		["prisma", "migrate", "diff", "--from-empty", "--to-schema", schemaPath, "--script"],
		{ cwd: repoRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
	);
	cachedSchemaSql = out;
	return out;
}

export type TestDb = {
	prisma: PrismaClient;
	cleanup: () => Promise<void>;
};

export async function createTestDb(): Promise<TestDb> {
	const dir = mkdtempSync(path.join(tmpdir(), "pigeon-test-"));
	const dbPath = path.join(dir, "test.db");

	const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
	const prisma = new PrismaClient({ adapter });

	// Apply schema. Prisma's --script output is one or more semicolon-
	// terminated statements with `-- CreateTable` / `-- CreateIndex` header
	// comments above each. SQLite's JS bindings choke on multi-statement
	// `executeRawUnsafe`, so split on the trailing semicolon, strip header
	// comments per chunk, and run them one at a time.
	const sql = getSchemaSql();
	const chunks = sql.split(/;\s*$/m);
	for (const chunk of chunks) {
		const cleaned = chunk
			.split("\n")
			.filter((line) => !line.trim().startsWith("--"))
			.join("\n")
			.trim();
		if (!cleaned) continue;
		await prisma.$executeRawUnsafe(cleaned);
	}

	const cleanup = async (): Promise<void> => {
		await prisma.$disconnect();
		rmSync(dir, { recursive: true, force: true });
	};

	return { prisma, cleanup };
}
