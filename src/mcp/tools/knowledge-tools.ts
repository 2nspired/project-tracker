import { z } from "zod";
import { queryKnowledge, rebuildIndex } from "@/server/fts";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

// ─── Knowledge Search Tools ──────────────────────────────────────

registerExtendedTool("queryKnowledge", {
	category: "context",
	description:
		"Full-text search across all project knowledge: cards, comments, decisions, notes, handoffs, code facts, context entries, and indexed repo markdown files. Auto-rebuilds the index on cold start (zero indexed rows for the project).",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		topic: z.string().describe("Search query — natural language or keywords"),
		limit: z.number().int().min(1).max(100).default(20).describe("Max results to return"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, topic, limit }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const results = await queryKnowledge(
				db,
				projectId as string,
				topic as string,
				(limit as number) ?? 20,
			);

			if (results.length === 0) {
				return ok({
					results: [],
					total: 0,
					hint: "No results found. Try broader search terms.",
				});
			}

			return ok({
				results,
				total: results.length,
			});
		}),
});

registerExtendedTool("rebuildKnowledgeIndex", {
	category: "context",
	description:
		"Force a full rebuild of the FTS5 knowledge index for a project — clears the existing index and re-ingests cards, comments, claims, notes, handoffs, and repo markdown. Use after batch operations (createMany/updateMany/deleteMany bypass live sync), repo markdown changes, or to recover from drift.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
	}),
	annotations: { readOnlyHint: false },
	handler: ({ projectId }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const result = await rebuildIndex(db, projectId as string);
			const total = Object.values(result.indexed).reduce((a, b) => a + b, 0);

			return ok({
				indexed: result.indexed,
				total,
				hint:
					total === 0
						? "No content found. Verify project has cards/notes/claims, and that repoPath is set if you expected docs."
						: `Indexed ${total} rows across ${Object.keys(result.indexed).length} source types.`,
			});
		}),
});
