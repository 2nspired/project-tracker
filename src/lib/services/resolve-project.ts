import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { PrismaClient } from "prisma/generated/client";

const execFileAsync = promisify(execFile);

// Resolves a `cwd` path to a registered project's id by walking up to the git
// repo root and matching `Project.repoPath`. Returns null when the path is
// outside a git repo or the repo isn't bound to any project.
//
// Used by the token-tracking MCP tools, which receive `cwd` from Claude Code's
// Stop hook payload and need to attribute usage to a project. The existing
// `resolveBoardFromCwd` in server.ts handles the broader "boardId from cwd"
// flow with its own error semantics; this helper is the leaner project-only
// path that fail-softs to null instead of returning structured failures —
// callers want to surface a `PROJECT_NOT_FOUND` warning, not crash.
export async function resolveProjectIdFromCwd(
	cwd: string,
	db: Pick<PrismaClient, "project">
): Promise<string | null> {
	let repoRoot: string;
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 3000,
		});
		repoRoot = await realpath(stdout.trim());
	} catch {
		return null;
	}

	const project = await db.project.findUnique({
		where: { repoPath: repoRoot },
		select: { id: true },
	});
	return project?.id ?? null;
}
