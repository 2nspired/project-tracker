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

// ─── Session Review ──────────────────────────────────────────────

const FILE_PATH_REGEX = /`([^`]*\/[^`]*\.[a-zA-Z0-9]+)`/g;

type Candidate = {
	source: "handoff-finding" | "card-comment" | "existing-entry";
	sourceRef: string;
	claim: string;
	suggestedSurface: "indexed";
	citedFiles: string[];
	action: "confirm" | "edit" | "drop";
};

function extractCitedFiles(text: string): string[] {
	const matches: string[] = [];
	let match: RegExpExecArray | null;
	FILE_PATH_REGEX.lastIndex = 0;
	while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
		matches.push(match[1]);
	}
	return matches;
}

registerExtendedTool("reviewSessionFacts", {
	category: "session",
	description:
		"End-of-session review: discover candidate facts from handoff findings, recent card comments, and context entries created this session. Present each to the user for confirm/edit/drop, then call saveContextEntry for accepted facts.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		boardId: z.string().describe("Board UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, boardId }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const board = await db.board.findUnique({ where: { id: boardId as string } });
			if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const lastHandoff = await db.sessionHandoff.findFirst({
				where: { boardId: boardId as string },
				orderBy: { createdAt: "desc" },
			});

			const since = lastHandoff?.createdAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
			const candidates: Candidate[] = [];

			// Source A: Handoff findings
			if (lastHandoff) {
				const findings = JSON.parse(lastHandoff.findings) as string[];
				for (const finding of findings) {
					candidates.push({
						source: "handoff-finding",
						sourceRef: `handoff ${lastHandoff.id}`,
						claim: finding,
						suggestedSurface: "indexed",
						citedFiles: extractCitedFiles(finding),
						action: "confirm",
					});
				}
			}

			// Source B: Recent card comments
			const columns = await db.column.findMany({
				where: { boardId: boardId as string },
				select: { id: true },
			});
			const columnIds = columns.map((c) => c.id);

			const cards = await db.card.findMany({
				where: {
					projectId: projectId as string,
					columnId: { in: columnIds },
				},
				select: { id: true, number: true },
			});
			const cardMap = new Map(cards.map((c) => [c.id, c.number]));
			const cardIds = Array.from(cardMap.keys());

			if (cardIds.length > 0) {
				const comments = await db.comment.findMany({
					where: {
						cardId: { in: cardIds },
						createdAt: { gt: since },
					},
					orderBy: { createdAt: "asc" },
				});

				for (const comment of comments) {
					const cardNumber = cardMap.get(comment.cardId);
					const authorLabel = comment.authorName ?? comment.authorType;
					candidates.push({
						source: "card-comment",
						sourceRef: `comment on #${cardNumber} by ${authorLabel}`,
						claim: comment.content,
						suggestedSurface: "indexed",
						citedFiles: extractCitedFiles(comment.content),
						action: "confirm",
					});
				}
			}

			// Source C: Context entries created this session
			const entries = await db.persistentContextEntry.findMany({
				where: {
					projectId: projectId as string,
					createdAt: { gt: since },
				},
				orderBy: { createdAt: "asc" },
			});

			for (const entry of entries) {
				candidates.push({
					source: "existing-entry",
					sourceRef: `entry ${entry.id}`,
					claim: entry.claim,
					suggestedSurface: "indexed",
					citedFiles: JSON.parse(entry.citedFiles) as string[],
					action: "confirm",
				});
			}

			return ok({
				sessionBoundary: since.toISOString(),
				candidates,
				totalCandidates: candidates.length,
				instructions:
					"Review each candidate with the user. For accepted facts, call saveContextEntry. For rejected facts, simply skip them. Edit claims/rationale before saving if the user suggests changes.",
			});
		}),
});
