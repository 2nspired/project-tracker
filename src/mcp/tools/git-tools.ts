import { z } from "zod";
import { db } from "../db.js";
import { syncGitActivityForProject } from "../git-sync.js";
import { detectGitRepo, gitLog, validateRepo } from "../git-utils.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, errWithToolHint, ok, safeExecute } from "../utils.js";

// ─── Git ──────────────────────────────────────────────────────────

registerExtendedTool("setRepoPath", {
	category: "setup",
	description:
		"Persist the absolute local repo path for a project so `syncGitActivity` and `getGitLog` can find commits. Prefer the essential `registerRepo` tool for first-time binding — it also handles the `needsRegistration` signal from `briefMe`. Reach for `setRepoPath` when the repo has moved on disk and you want to update the bind without going through onboarding.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		repoPath: z.string().min(1).describe("Absolute path to local git repo"),
	}),
	handler: ({ projectId, repoPath }) =>
		safeExecute(async () => {
			const valid = await validateRepo(repoPath as string);
			if (!valid)
				return err(
					`"${repoPath}" is not a valid git repository.`,
					"Provide an absolute path to a directory containing a .git folder."
				);

			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return errWithToolHint("Project not found.", "listProjects", {});

			await db.project.update({
				where: { id: projectId as string },
				data: { repoPath: repoPath as string },
			});

			return ok({ projectId, repoPath, saved: true });
		}),
});

registerExtendedTool("syncGitActivity", {
	category: "git",
	description: "Scan git commits for #N card refs and create links.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		since: z
			.string()
			.optional()
			.describe("ISO datetime, git date string like '2 weeks ago', or 'all' for full history"),
	}),
	handler: ({ projectId, since }) =>
		safeExecute(async () => {
			const result = await syncGitActivityForProject(projectId as string, {
				since: since as string | undefined,
			});

			if (!result.ok) {
				if (result.reason === "project_not_found")
					return errWithToolHint("Project not found.", "listProjects", {});
				if (result.reason === "no_repo_path") {
					return errWithToolHint(result.message, "setRepoPath", {
						projectId: `"${projectId}"`,
						repoPath: '"/path/to/repo"',
					});
				}
				// repo_invalid
				return errWithToolHint(result.message, "setRepoPath", {
					projectId: `"${projectId}"`,
					repoPath: '"/path/to/repo"',
				});
			}

			return ok({
				commitsScanned: result.commitsScanned,
				linksCreated: result.linksCreated,
				refsSkipped: result.refsSkipped,
				since: result.since,
				...(result.autoDetected && {
					_note: `Auto-detected repo at "${result.repoPath}". Run setRepoPath to persist this.`,
				}),
				errors: result.errors.length > 0 ? result.errors : undefined,
			});
		}),
});

registerExtendedTool("getGitLog", {
	category: "git",
	description: "Recent git commits with detected card references.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		limit: z.number().int().min(1).max(100).default(20).describe("Max commits (1–100)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, limit }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return errWithToolHint("Project not found.", "listProjects", {});

			let repoPath = project.repoPath;
			if (!repoPath) {
				const detected = await detectGitRepo();
				if (detected) {
					repoPath = detected;
				} else {
					return errWithToolHint("No repo path set for this project.", "setRepoPath", {
						projectId: `"${projectId}"`,
						repoPath: '"/path/to/repo"',
					});
				}
			}

			const valid = await validateRepo(repoPath);
			if (!valid)
				return errWithToolHint(`Repo path "${repoPath}" is no longer valid.`, "setRepoPath", {
					projectId: `"${projectId}"`,
					repoPath: '"/path/to/repo"',
				});

			const commits = await gitLog(repoPath, (limit as number) ?? 20);

			return ok(
				commits.map((c) => ({
					hash: c.hash.slice(0, 7),
					fullHash: c.hash,
					message: c.message,
					author: c.author,
					date: c.date,
					cardRefs: c.cardRefs.map((n) => `#${n}`),
				}))
			);
		}),
});
