import type { Card, Note } from "prisma/generated/client";
import type { z } from "zod";
import {
	type CreateNoteInput,
	type ListNoteFilter,
	type NoteKind,
	noteMetadataByKind,
	type PromoteNoteToCardInput,
	type UpdateNoteInput,
} from "@/lib/schemas/note-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type NoteWithProject = Note & { project: { id: string; name: string } | null };

function zodMessage(error: z.ZodError): string {
	const first = error.issues[0];
	if (!first) return "validation failed";
	const path = first.path.length ? first.path.join(".") : "(root)";
	return `${path}: ${first.message}`;
}

// RFC amendment #2: Zod validation of metadata at the service boundary.
function validateMetadata(kind: NoteKind, metadataInput: unknown): ServiceResult<string> {
	const schema = noteMetadataByKind[kind];
	const result = schema.safeParse(metadataInput ?? {});
	if (!result.success) {
		return {
			success: false,
			error: {
				code: "VALIDATION_FAILED",
				message: `metadata.${zodMessage(result.error)}`,
			},
		};
	}
	return { success: true, data: JSON.stringify(result.data) };
}

async function list(
	projectId?: string | null,
	filter: ListNoteFilter = {}
): Promise<ServiceResult<NoteWithProject[]>> {
	try {
		const where: Record<string, unknown> = {};
		if (projectId === null) where.projectId = null;
		else if (projectId !== undefined) where.projectId = projectId;
		if (filter.kind) where.kind = filter.kind;
		if (filter.cardId) where.cardId = filter.cardId;
		if (filter.boardId) where.boardId = filter.boardId;
		if (filter.author) where.author = filter.author;

		const notes = await db.note.findMany({
			where,
			orderBy: { updatedAt: "desc" },
			include: { project: { select: { id: true, name: true } } },
		});
		return { success: true, data: notes };
	} catch (error) {
		console.error("[NOTE_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to fetch notes." } };
	}
}

async function create(data: CreateNoteInput): Promise<ServiceResult<NoteWithProject>> {
	try {
		const { tags, metadata, kind, ...rest } = data;
		const validatedMeta = validateMetadata(kind as NoteKind, metadata);
		if (!validatedMeta.success) return validatedMeta;

		const note = await db.note.create({
			data: {
				...rest,
				kind,
				tags: JSON.stringify(tags ?? []),
				metadata: validatedMeta.data,
			},
			include: { project: { select: { id: true, name: true } } },
		});
		return { success: true, data: note };
	} catch (error) {
		console.error("[NOTE_SERVICE] create error:", error);
		return { success: false, error: { code: "CREATE_FAILED", message: "Failed to create note." } };
	}
}

async function update(
	noteId: string,
	data: UpdateNoteInput
): Promise<ServiceResult<NoteWithProject>> {
	try {
		const existing = await db.note.findUnique({ where: { id: noteId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Note not found." } };
		}
		const { tags, metadata, kind, ...rest } = data;

		let metadataJson: string | undefined;
		if (metadata !== undefined || kind !== undefined) {
			const effectiveKind = (kind ?? existing.kind) as NoteKind;
			const metaInput = metadata ?? (JSON.parse(existing.metadata || "{}") as unknown);
			const validatedMeta = validateMetadata(effectiveKind, metaInput);
			if (!validatedMeta.success) return validatedMeta;
			metadataJson = validatedMeta.data;
		}

		const note = await db.note.update({
			where: { id: noteId },
			data: {
				...rest,
				...(kind !== undefined && { kind }),
				...(tags !== undefined && { tags: JSON.stringify(tags) }),
				...(metadataJson !== undefined && { metadata: metadataJson }),
			},
			include: { project: { select: { id: true, name: true } } },
		});
		return { success: true, data: note };
	} catch (error) {
		console.error("[NOTE_SERVICE] update error:", error);
		return { success: false, error: { code: "UPDATE_FAILED", message: "Failed to update note." } };
	}
}

// Promote a note to a card with link-and-keep semantics (#185). One Prisma
// transaction stamps the new card with `metadata.sourceNoteId`, sets the
// source note's `cardId` back-reference, and writes a "promoted_from_note"
// activity row. The note row stays around as the rough-draft history that
// Notes is meant to preserve.
async function promoteToCard(input: PromoteNoteToCardInput): Promise<ServiceResult<Card>> {
	try {
		const note = await db.note.findUnique({ where: { id: input.noteId } });
		if (!note) {
			return { success: false, error: { code: "NOT_FOUND", message: "Note not found." } };
		}

		const column = await db.column.findUnique({
			where: { id: input.columnId },
			include: { board: { select: { projectId: true } } },
		});
		if (!column) {
			return { success: false, error: { code: "NOT_FOUND", message: "Column not found." } };
		}
		const projectId = column.board.projectId;

		const cardTitle = (input.title ?? note.title).trim() || note.title;

		const card = await db.$transaction(async (tx) => {
			const maxPosition = await tx.card.aggregate({
				where: { columnId: input.columnId },
				_max: { position: true },
			});
			const position = (maxPosition._max.position ?? -1) + 1;

			const project = await tx.project.update({
				where: { id: projectId },
				data: { nextCardNumber: { increment: 1 } },
			});
			const cardNumber = project.nextCardNumber - 1;

			const created = await tx.card.create({
				data: {
					columnId: input.columnId,
					projectId,
					number: cardNumber,
					title: cardTitle,
					description: note.content || undefined,
					priority: input.priority,
					position,
					createdBy: "HUMAN",
					metadata: JSON.stringify({ sourceNoteId: note.id }),
				},
			});

			await tx.note.update({
				where: { id: note.id },
				data: { cardId: created.id },
			});

			await tx.activity.create({
				data: {
					cardId: created.id,
					action: "promoted_from_note",
					details: `Promoted from note "${note.title}"`,
					actorType: "HUMAN",
				},
			});

			return created;
		});

		return { success: true, data: card };
	} catch (error) {
		console.error("[NOTE_SERVICE] promoteToCard error:", error);
		return {
			success: false,
			error: { code: "PROMOTE_FAILED", message: "Failed to promote note." },
		};
	}
}

async function deleteNote(noteId: string): Promise<ServiceResult<Note>> {
	try {
		const existing = await db.note.findUnique({ where: { id: noteId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Note not found." } };
		}
		const note = await db.note.delete({ where: { id: noteId } });
		return { success: true, data: note };
	} catch (error) {
		console.error("[NOTE_SERVICE] delete error:", error);
		return { success: false, error: { code: "DELETE_FAILED", message: "Failed to delete note." } };
	}
}

export const noteService = {
	list,
	create,
	update,
	promoteToCard,
	delete: deleteNote,
};
