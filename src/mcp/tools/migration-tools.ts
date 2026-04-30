import { resolve } from "node:path";
import { z } from "zod";
import { migrateProjectPromptToFile } from "../../lib/services/migrate-project-prompt.js";
import {
	migrateTags as migrateTagsCore,
	writeMigrationAudit,
} from "../../lib/services/migrate-tags.js";
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

registerExtendedTool("migrateTags", {
	category: "setup",
	description:
		"v4.2 tag-rework backfill. Walks every Card.tags JSON array, slugifies each entry, dedupes by slug (most-frequent original casing wins as the label), and populates the Tag + CardTag tables. Handles Note.tags by appending a `Tags: ...` footer to the note body and clearing the column. Idempotent — re-running is safe and produces no duplicate tags or junction rows. Composes with migrateProjectPrompt: a friend upgrading from v4.0/4.1 → v4.2 runs both in one window. Card.tags JSON column stays populated until v5.",
	parameters: z.object({}),
	handler: () =>
		safeExecute(async () => {
			const summary = await migrateTagsCore(db);
			const auditPath = resolve(
				"data",
				`tag-migration-${summary.timestamp.replace(/[:.]/g, "-")}.json`
			);
			await writeMigrationAudit(auditPath, summary);

			const totalMerges = summary.projects.reduce((acc, p) => acc + p.merges.length, 0);
			const savings = summary.totalDistinctInputs - summary.totalCanonicalSlugs;

			return ok({
				migrated: true,
				auditPath,
				stats: {
					totalDistinctInputs: summary.totalDistinctInputs,
					totalCanonicalSlugs: summary.totalCanonicalSlugs,
					savings,
					totalCardTagsCreated: summary.totalCardTagsCreated,
					mergesAcrossProjects: totalMerges,
					notesScanned: summary.notes.notesScanned,
					notesUpdated: summary.notes.notesUpdated,
					notesAlreadyMigrated: summary.notes.notesAlreadyMigrated,
				},
				perProject: summary.projects.map((p) => ({
					projectId: p.projectId,
					projectName: p.projectName,
					tagsCreatedOrUpdated: p.tagsCreatedOrUpdated,
					cardTagsCreated: p.cardTagsCreated,
					cardTagsAlreadyPresent: p.cardTagsAlreadyPresent,
					mergeCount: p.merges.length,
				})),
				nextSteps: [
					"Review the audit JSON to confirm the canonical labels and merged variants look right.",
					"Restart the MCP server so the new tag tools (listTags, createTag, mergeTags) are visible.",
					"Use mergeTags to clean up any drift the migration couldn't auto-canonicalize.",
				],
			});
		}),
});
