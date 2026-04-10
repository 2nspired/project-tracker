import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, err, safeExecute } from "../utils.js";

// ─── Context Entries ──────────────────────────────────────────────

const VALID_SURFACES = ["ambient", "indexed", "surfaced"] as const;

function parseEntry(entry: {
	id: string;
	projectId: string;
	claim: string;
	rationale: string;
	application: string;
	details: string;
	author: string;
	audience: string;
	citedFiles: string;
	recordedAtSha: string | null;
	surface: string;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: entry.id,
		projectId: entry.projectId,
		claim: entry.claim,
		rationale: entry.rationale,
		application: entry.application,
		details: JSON.parse(entry.details) as string[],
		author: entry.author,
		audience: entry.audience,
		citedFiles: JSON.parse(entry.citedFiles) as string[],
		recordedAtSha: entry.recordedAtSha,
		surface: entry.surface,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
	};
}

registerExtendedTool("saveContextEntry", {
	category: "context",
	description:
		"Create or update a persistent context entry — a knowledge claim about the project. Pass entryId to update an existing entry.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		claim: z.string().describe("The fact or assertion"),
		rationale: z.string().default("").describe("Why this matters"),
		application: z.string().default("").describe("How to apply this knowledge"),
		details: z.array(z.string()).default([]).describe("Supporting details"),
		author: z.string().default("AGENT").describe("Who recorded this (AGENT or HUMAN)"),
		audience: z.string().default("all").describe("Who should see it (all, agent, human)"),
		citedFiles: z.array(z.string()).default([]).describe("File paths this fact references"),
		recordedAtSha: z.string().optional().describe("Git SHA when this was recorded"),
		surface: z.enum(VALID_SURFACES).default("indexed").describe("Visibility level: ambient | indexed | surfaced"),
		entryId: z.string().optional().describe("Entry UUID — pass to update an existing entry"),
	}),
	handler: ({ projectId, claim, rationale, application, details, author, audience, citedFiles, recordedAtSha, surface, entryId }) =>
		safeExecute(async () => {
			// Validate project exists
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const data = {
				projectId: projectId as string,
				claim: claim as string,
				rationale: (rationale as string) ?? "",
				application: (application as string) ?? "",
				details: JSON.stringify(details ?? []),
				author: (author as string) ?? "AGENT",
				audience: (audience as string) ?? "all",
				citedFiles: JSON.stringify(citedFiles ?? []),
				recordedAtSha: (recordedAtSha as string) ?? null,
				surface: (surface as string) ?? "indexed",
			};

			if (entryId) {
				const existing = await db.persistentContextEntry.findUnique({ where: { id: entryId as string } });
				if (!existing) return err("Context entry not found.", "Check the entryId and try again.");

				const updated = await db.persistentContextEntry.update({
					where: { id: entryId as string },
					data,
				});
				return ok(parseEntry(updated));
			}

			const created = await db.persistentContextEntry.create({ data });
			return ok(parseEntry(created));
		}),
});

registerExtendedTool("listContextEntries", {
	category: "context",
	description: "List persistent context entries for a project, optionally filtered by surface level or author.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		surface: z.enum(VALID_SURFACES).optional().describe("Filter by surface level"),
		author: z.string().optional().describe("Filter by author (AGENT or HUMAN)"),
		limit: z.number().int().min(1).max(200).default(50).describe("Max entries to return"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, surface, author, limit }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const where: Record<string, unknown> = { projectId: projectId as string };
			if (surface) where.surface = surface as string;
			if (author) where.author = author as string;

			const entries = await db.persistentContextEntry.findMany({
				where,
				orderBy: { updatedAt: "desc" },
				take: (limit as number) ?? 50,
			});

			return ok({
				entries: entries.map(parseEntry),
				total: entries.length,
			});
		}),
});

registerExtendedTool("getContextEntry", {
	category: "context",
	description: "Get a single persistent context entry by ID.",
	parameters: z.object({
		entryId: z.string().describe("Entry UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ entryId }) =>
		safeExecute(async () => {
			const entry = await db.persistentContextEntry.findUnique({
				where: { id: entryId as string },
			});
			if (!entry) return err("Context entry not found.", "Check the entryId and try again.");

			return ok(parseEntry(entry));
		}),
});

registerExtendedTool("deleteContextEntry", {
	category: "context",
	description: "Delete a persistent context entry.",
	parameters: z.object({
		entryId: z.string().describe("Entry UUID"),
	}),
	handler: ({ entryId }) =>
		safeExecute(async () => {
			const entry = await db.persistentContextEntry.findUnique({
				where: { id: entryId as string },
			});
			if (!entry) return err("Context entry not found.", "Check the entryId and try again.");

			await db.persistentContextEntry.delete({ where: { id: entryId as string } });

			return ok({ deleted: true, claim: entry.claim });
		}),
});
