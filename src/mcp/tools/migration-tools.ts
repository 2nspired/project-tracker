import { z } from "zod";
import { migrateProjectPromptToFile } from "../../lib/services/migrate-project-prompt.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, errWithToolHint, ok, safeExecute } from "../utils.js";

// ─── Migration ──────────────────────────────────────────────────────

registerExtendedTool("migrateProjectPrompt", {
	category: "setup",
	description:
		"Phase 2 of the projectPrompt → tracker.md migration (RFC #111). Writes a tracker.md at the project's repoPath using the current DB projectPrompt as the body. Idempotent — aborts if the file already exists. Does NOT clear the DB column; review the new file, commit it, then clear projectPrompt manually.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
	}),
	handler: ({ projectId }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({
				where: { id: projectId as string },
				select: {
					id: true,
					name: true,
					slug: true,
					repoPath: true,
					projectPrompt: true,
				},
			});
			if (!project) return errWithToolHint("Project not found.", "listProjects", {});

			if (!project.repoPath) {
				return errWithToolHint(
					`Project "${project.name}" has no repoPath set — can't write tracker.md.`,
					"registerRepo",
					{ projectId: `"${project.id}"`, repoPath: '"/absolute/path/to/repo"' }
				);
			}

			const promptBody = project.projectPrompt ?? "";
			if (promptBody.trim().length === 0) {
				return err(
					`Project "${project.name}" has no projectPrompt to migrate.`,
					"Nothing to write. If you want to start using tracker.md from scratch, create the file by hand at the repo root."
				);
			}

			const result = await migrateProjectPromptToFile({
				repoPath: project.repoPath,
				slug: project.slug,
				projectPrompt: promptBody,
			});

			if (!result.ok && result.reason === "already_exists") {
				return err(
					`tracker.md already exists at ${result.path}.`,
					"Already migrated. Delete or rename the existing file first if you really want to overwrite."
				);
			}

			return ok({
				migrated: true,
				path: result.path,
				projectSlug: project.slug,
				bodyLength: promptBody.length,
				nextSteps: [
					"Review the new tracker.md and commit it to version control.",
					"When ready, clear the DB column via updateProjectPrompt({ projectId, prompt: null }) — that resolves the briefMe conflict warning.",
				],
			});
		}),
});
