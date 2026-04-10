import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, err, safeExecute } from "../utils.js";

// ─── Code Facts ──────────────────────────────────────────────────

function parseFact(fact: {
	id: string;
	projectId: string;
	path: string;
	symbol: string | null;
	fact: string;
	author: string;
	recordedAtSha: string | null;
	needsRecheck: boolean;
	lastVerifiedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: fact.id,
		projectId: fact.projectId,
		path: fact.path,
		symbol: fact.symbol,
		fact: fact.fact,
		author: fact.author,
		recordedAtSha: fact.recordedAtSha,
		needsRecheck: fact.needsRecheck,
		lastVerifiedAt: fact.lastVerifiedAt,
		createdAt: fact.createdAt,
		updatedAt: fact.updatedAt,
	};
}

registerExtendedTool("saveCodeFact", {
	category: "context",
	description:
		"Create or update a code fact — a factual assertion about a specific file or symbol in the codebase. Pass factId to update an existing fact.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		path: z.string().describe("File path relative to repo root"),
		fact: z.string().describe("The factual assertion about this code"),
		symbol: z.string().optional().describe("Optional symbol name (function, class, variable)"),
		author: z.string().default("AGENT").describe("Who recorded this (AGENT or HUMAN)"),
		recordedAtSha: z.string().optional().describe("Git SHA when this was recorded"),
		factId: z.string().optional().describe("Fact UUID — pass to update an existing fact"),
	}),
	handler: ({ projectId, path, fact, symbol, author, recordedAtSha, factId }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const data = {
				projectId: projectId as string,
				path: path as string,
				fact: fact as string,
				symbol: (symbol as string) ?? null,
				author: (author as string) ?? "AGENT",
				recordedAtSha: (recordedAtSha as string) ?? null,
				needsRecheck: false,
			};

			if (factId) {
				const existing = await db.codeFact.findUnique({ where: { id: factId as string } });
				if (!existing) return err("Code fact not found.", "Check the factId and try again.");

				const updated = await db.codeFact.update({
					where: { id: factId as string },
					data: { ...data, lastVerifiedAt: new Date() },
				});
				return ok(parseFact(updated));
			}

			const created = await db.codeFact.create({ data });
			return ok(parseFact(created));
		}),
});

registerExtendedTool("listCodeFacts", {
	category: "context",
	description: "List code facts for a project, optionally filtered by file path or symbol.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		path: z.string().optional().describe("Filter by file path (exact match)"),
		pathPrefix: z.string().optional().describe("Filter by path prefix (e.g. 'src/mcp/' for all MCP facts)"),
		needsRecheck: z.boolean().optional().describe("Filter to only facts flagged for recheck"),
		limit: z.number().int().min(1).max(200).default(50).describe("Max facts to return"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, path, pathPrefix, needsRecheck, limit }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const where: Record<string, unknown> = { projectId: projectId as string };
			if (path) where.path = path as string;
			if (pathPrefix) where.path = { startsWith: pathPrefix as string };
			if (needsRecheck === true) where.needsRecheck = true;

			const facts = await db.codeFact.findMany({
				where,
				orderBy: { updatedAt: "desc" },
				take: (limit as number) ?? 50,
			});

			return ok({
				facts: facts.map(parseFact),
				total: facts.length,
			});
		}),
});

registerExtendedTool("getCodeFact", {
	category: "context",
	description: "Get a single code fact by ID.",
	parameters: z.object({
		factId: z.string().describe("Fact UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ factId }) =>
		safeExecute(async () => {
			const fact = await db.codeFact.findUnique({
				where: { id: factId as string },
			});
			if (!fact) return err("Code fact not found.", "Check the factId and try again.");

			return ok(parseFact(fact));
		}),
});

registerExtendedTool("deleteCodeFact", {
	category: "context",
	description: "Delete a code fact.",
	parameters: z.object({
		factId: z.string().describe("Fact UUID"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ factId }) =>
		safeExecute(async () => {
			const fact = await db.codeFact.findUnique({
				where: { id: factId as string },
			});
			if (!fact) return err("Code fact not found.", "Check the factId and try again.");

			await db.codeFact.delete({ where: { id: factId as string } });

			return ok({ deleted: true, path: fact.path, fact: fact.fact });
		}),
});
