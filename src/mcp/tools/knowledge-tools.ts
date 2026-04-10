import { z } from "zod";
import { db } from "../db.js";
import { initFts5, queryKnowledge, rebuildIndex } from "../fts.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, err, safeExecute } from "../utils.js";

// ─── Knowledge Search Tools ──────────────────────────────────────

registerExtendedTool("queryKnowledge", {
	category: "context",
	description:
		"Full-text search across all project knowledge: cards, comments, decisions, notes, handoffs, code facts, context entries, and indexed repo markdown files. Rebuild the index first with rebuildKnowledgeIndex if this is the first query or data has changed.",
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

			// Ensure FTS5 table exists
			await initFts5();

			const results = await queryKnowledge(projectId as string, topic as string, (limit as number) ?? 20);

			if (results.length === 0) {
				return ok({
					results: [],
					total: 0,
					hint: "No results found. Try rebuildKnowledgeIndex first if the index hasn't been built yet, or try broader search terms.",
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
		"Rebuild the full-text search index for a project. Scans all cards, comments, decisions, notes, handoffs, code facts, context entries, and repo markdown files. Run this before queryKnowledge if data has changed.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
	}),
	handler: ({ projectId }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			// Ensure FTS5 table exists
			await initFts5();

			const result = await rebuildIndex(projectId as string);

			const totalIndexed = Object.values(result.indexed).reduce((a, b) => a + b, 0);

			return ok({
				message: `Knowledge index rebuilt: ${totalIndexed} entries indexed.`,
				...result,
			});
		}),
});
