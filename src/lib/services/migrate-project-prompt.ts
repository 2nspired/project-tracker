/**
 * Phase 2 of the `projectPrompt` → `tracker.md` migration (RFC #111, card 4/7).
 *
 * Writes a `tracker.md` to a project's repoPath using the current DB
 * `projectPrompt` value as the body. Idempotent on file existence — second
 * call returns `already_exists` without overwriting. The DB column is *not*
 * touched here; clearing it is a separate human-eyeball step so the operator
 * gets to review what landed in version control before disabling the fallback.
 *
 * Pure I/O wrapper — no Prisma, no MCP types — so tests can exercise it with
 * a tmpdir without booting the server.
 */

import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILENAME = "tracker.md";

export type MigrateInput = {
	repoPath: string;
	slug: string;
	projectPrompt: string;
};

export type MigrateResult =
	| { ok: true; path: string }
	| { ok: false; reason: "already_exists"; path: string };

export async function migrateProjectPromptToFile(input: MigrateInput): Promise<MigrateResult> {
	const path = join(input.repoPath, FILENAME);

	try {
		await access(path);
		return { ok: false, reason: "already_exists", path };
	} catch {
		// ENOENT (or any read failure) — proceed with write.
	}

	const body = input.projectPrompt;
	const trailingNewline = body.length > 0 && !body.endsWith("\n") ? "\n" : "";
	const content = `---\nschema_version: 1\nproject_slug: ${input.slug}\n---\n\n${body}${trailingNewline}`;

	await writeFile(path, content, "utf8");
	return { ok: true, path };
}
