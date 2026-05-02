import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, err, errWithToolHint, ok, resolveCardRef, safeExecute } from "../utils.js";

// As of v6.0.0 (#179 Phase 2) handoffs live in their own table. Notes
// are the human-authored scratch layer — kind is reserved for future
// human-facing kinds and currently only `general` is valid.

const NOTE_KINDS = ["general"] as const;

registerExtendedTool("listNotes", {
	category: "notes",
	description:
		"List notes. Filter by kind/cardId/boardId/author. Omit projectId to list across projects.",
	parameters: z.object({
		projectId: z.string().optional().describe("Project UUID, omit for all"),
		kind: z.enum(NOTE_KINDS).optional().describe("Filter by kind"),
		cardId: z.string().optional().describe("Card UUID or #number (requires projectId for #N form)"),
		boardId: z.string().optional().describe("Board UUID"),
		author: z.string().optional().describe("Filter by author (AGENT_NAME or HUMAN)"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) =>
		safeExecute(async () => {
			const {
				projectId,
				kind,
				cardId: cardRef,
				boardId,
				author,
			} = params as {
				projectId?: string;
				kind?: (typeof NOTE_KINDS)[number];
				cardId?: string;
				boardId?: string;
				author?: string;
			};

			let resolvedCardId: string | undefined;
			if (cardRef) {
				if (!projectId && /^#\d+$/.test(cardRef)) {
					return err(
						"Resolving a #N card ref needs projectId.",
						"Pass projectId or use a card UUID."
					);
				}
				if (projectId) {
					const resolved = await resolveCardRef(cardRef, projectId);
					if (!resolved.ok) return err(resolved.message);
					resolvedCardId = resolved.id;
				} else {
					resolvedCardId = cardRef;
				}
			}

			const where: Record<string, unknown> = {};
			if (projectId) where.projectId = projectId;
			if (kind) where.kind = kind;
			if (resolvedCardId) where.cardId = resolvedCardId;
			if (boardId) where.boardId = boardId;
			if (author) where.author = author;

			const notes = await db.note.findMany({
				where,
				orderBy: { updatedAt: "desc" },
				include: { project: { select: { id: true, name: true } } },
			});
			return ok(
				notes.map((n) => ({
					id: n.id,
					title: n.title,
					content: n.content.substring(0, 200) + (n.content.length > 200 ? "..." : ""),
					kind: n.kind,
					tags: JSON.parse(n.tags) as string[],
					author: n.author,
					cardId: n.cardId,
					boardId: n.boardId,
					project: n.project?.name ?? null,
					updatedAt: n.updatedAt,
				}))
			);
		}),
});

registerExtendedTool("createNote", {
	category: "notes",
	description:
		"Create a note. Defaults: kind=general, author=HUMAN, metadata={}. Omit projectId for a global note.",
	parameters: z.object({
		title: z.string(),
		content: z.string().optional().describe("Markdown"),
		tags: z.array(z.string()).default([]),
		projectId: z.string().optional().describe("Project UUID, omit for global"),
		kind: z.enum(NOTE_KINDS).default("general"),
		author: z
			.string()
			.default(() => AGENT_NAME)
			.describe("AGENT_NAME or HUMAN"),
		cardId: z.string().optional().describe("Card UUID or #number (requires projectId for #N form)"),
		boardId: z.string().optional().describe("Board UUID"),
		metadata: z.record(z.string(), z.unknown()).default({}).describe("Kind-specific metadata"),
		expiresAt: z.string().optional().describe("ISO datetime — optional TTL"),
	}),
	handler: (params) =>
		safeExecute(async () => {
			const {
				title,
				content,
				tags,
				projectId,
				kind,
				author,
				cardId: cardRef,
				boardId,
				metadata,
				expiresAt,
			} = params as {
				title: string;
				content?: string;
				tags: string[];
				projectId?: string;
				kind: (typeof NOTE_KINDS)[number];
				author: string;
				cardId?: string;
				boardId?: string;
				metadata: Record<string, unknown>;
				expiresAt?: string;
			};

			let resolvedCardId: string | null = null;
			if (cardRef) {
				if (!projectId && /^#\d+$/.test(cardRef)) {
					return err(
						"Resolving a #N card ref needs projectId.",
						"Pass projectId or use a card UUID."
					);
				}
				if (projectId) {
					const resolved = await resolveCardRef(cardRef, projectId);
					if (!resolved.ok) return err(resolved.message);
					resolvedCardId = resolved.id;
				} else {
					resolvedCardId = cardRef;
				}
			}

			const note = await db.note.create({
				data: {
					title,
					content: content ?? "",
					tags: JSON.stringify(tags ?? []),
					projectId,
					kind,
					author,
					cardId: resolvedCardId,
					boardId: boardId ?? null,
					metadata: JSON.stringify(metadata ?? {}),
					expiresAt: expiresAt ? new Date(expiresAt) : null,
				},
			});
			return ok({ id: note.id, title: note.title, kind: note.kind, created: true });
		}),
});

registerExtendedTool("updateNote", {
	category: "notes",
	description: "Update a note. Omitted fields unchanged.",
	parameters: z.object({
		noteId: z.string().describe("UUID from listNotes"),
		title: z.string().optional(),
		content: z.string().optional().describe("Markdown"),
		tags: z.array(z.string()).optional().describe("Replaces all tags"),
		kind: z.enum(NOTE_KINDS).optional(),
		author: z.string().optional(),
		cardId: z.string().nullable().optional().describe("Card UUID, #number, or null to unset"),
		boardId: z.string().nullable().optional().describe("Board UUID or null to unset"),
		metadata: z.record(z.string(), z.unknown()).optional().describe("Replaces metadata blob"),
		expiresAt: z.string().nullable().optional().describe("ISO datetime or null to unset"),
		projectId: z.string().optional().describe("Project UUID — only for resolving #N cardId"),
	}),
	annotations: { idempotentHint: true },
	handler: (params) =>
		safeExecute(async () => {
			const {
				noteId,
				title,
				content,
				tags,
				kind,
				author,
				cardId: cardRef,
				boardId,
				metadata,
				expiresAt,
				projectId,
			} = params as {
				noteId: string;
				title?: string;
				content?: string;
				tags?: string[];
				kind?: (typeof NOTE_KINDS)[number];
				author?: string;
				cardId?: string | null;
				boardId?: string | null;
				metadata?: Record<string, unknown>;
				expiresAt?: string | null;
				projectId?: string;
			};

			const existing = await db.note.findUnique({ where: { id: noteId } });
			if (!existing)
				return errWithToolHint("Note not found.", "listNotes", { projectId: '"<projectId>"' });

			let resolvedCardId: string | null | undefined;
			if (cardRef === null) {
				resolvedCardId = null;
			} else if (cardRef !== undefined) {
				const scope = projectId ?? existing.projectId ?? undefined;
				if (!scope && /^#\d+$/.test(cardRef)) {
					return err(
						"Resolving a #N card ref needs projectId.",
						"Pass projectId or use a card UUID."
					);
				}
				if (scope) {
					const resolved = await resolveCardRef(cardRef, scope);
					if (!resolved.ok) return err(resolved.message);
					resolvedCardId = resolved.id;
				} else {
					resolvedCardId = cardRef;
				}
			}

			const note = await db.note.update({
				where: { id: noteId },
				data: {
					title,
					content,
					tags: tags ? JSON.stringify(tags) : undefined,
					kind,
					author,
					cardId: resolvedCardId,
					boardId: boardId === undefined ? undefined : boardId,
					metadata: metadata ? JSON.stringify(metadata) : undefined,
					expiresAt:
						expiresAt === undefined ? undefined : expiresAt === null ? null : new Date(expiresAt),
				},
			});
			return ok({ id: note.id, title: note.title, kind: note.kind, updated: true });
		}),
});
