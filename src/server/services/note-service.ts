import type { Note } from "prisma/generated/client";
import type { CreateNoteInput, UpdateNoteInput } from "@/lib/schemas/note-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type NoteWithProject = Note & { project: { id: string; name: string } | null };

async function list(projectId?: string | null): Promise<ServiceResult<NoteWithProject[]>> {
	try {
		const where = projectId === undefined
			? {}
			: projectId === null
				? { projectId: null }
				: { projectId };

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
		const { tags, ...rest } = data;
		const note = await db.note.create({
			data: { ...rest, tags: JSON.stringify(tags ?? []) },
			include: { project: { select: { id: true, name: true } } },
		});
		return { success: true, data: note };
	} catch (error) {
		console.error("[NOTE_SERVICE] create error:", error);
		return { success: false, error: { code: "CREATE_FAILED", message: "Failed to create note." } };
	}
}

async function update(noteId: string, data: UpdateNoteInput): Promise<ServiceResult<NoteWithProject>> {
	try {
		const existing = await db.note.findUnique({ where: { id: noteId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Note not found." } };
		}
		const { tags, ...rest } = data;
		const note = await db.note.update({
			where: { id: noteId },
			data: { ...rest, ...(tags !== undefined && { tags: JSON.stringify(tags) }) },
			include: { project: { select: { id: true, name: true } } },
		});
		return { success: true, data: note };
	} catch (error) {
		console.error("[NOTE_SERVICE] update error:", error);
		return { success: false, error: { code: "UPDATE_FAILED", message: "Failed to update note." } };
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
	delete: deleteNote,
};
