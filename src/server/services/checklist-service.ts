import type { ChecklistItem } from "prisma/generated/client";
import type {
	CreateChecklistItemInput,
	UpdateChecklistItemInput,
} from "@/lib/schemas/checklist-schemas";
import { db } from "@/server/db";
import { activityService } from "@/server/services/activity-service";
import type { ServiceResult } from "@/server/services/types/service-result";

async function create(data: CreateChecklistItemInput): Promise<ServiceResult<ChecklistItem>> {
	try {
		const maxPosition = await db.checklistItem.aggregate({
			where: { cardId: data.cardId },
			_max: { position: true },
		});
		const position = (maxPosition._max.position ?? -1) + 1;

		const item = await db.checklistItem.create({
			data: {
				cardId: data.cardId,
				text: data.text,
				position,
			},
		});
		return { success: true, data: item };
	} catch (error) {
		console.error("[CHECKLIST_SERVICE] create error:", error);
		return {
			success: false,
			error: { code: "CREATE_FAILED", message: "Failed to create checklist item." },
		};
	}
}

async function update(
	itemId: string,
	data: UpdateChecklistItemInput
): Promise<ServiceResult<ChecklistItem>> {
	try {
		const existing = await db.checklistItem.findUnique({ where: { id: itemId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Checklist item not found." } };
		}

		const item = await db.checklistItem.update({
			where: { id: itemId },
			data,
		});

		if (data.completed !== undefined && data.completed !== existing.completed) {
			await activityService.log({
				cardId: existing.cardId,
				action: data.completed ? "checklist_completed" : "checklist_unchecked",
				details: `${data.completed ? "Completed" : "Unchecked"}: ${existing.text}`,
				actorType: "HUMAN",
			});
		}

		return { success: true, data: item };
	} catch (error) {
		console.error("[CHECKLIST_SERVICE] update error:", error);
		return {
			success: false,
			error: { code: "UPDATE_FAILED", message: "Failed to update checklist item." },
		};
	}
}

async function deleteItem(itemId: string): Promise<ServiceResult<ChecklistItem>> {
	try {
		const existing = await db.checklistItem.findUnique({ where: { id: itemId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Checklist item not found." } };
		}

		const item = await db.checklistItem.delete({ where: { id: itemId } });
		return { success: true, data: item };
	} catch (error) {
		console.error("[CHECKLIST_SERVICE] delete error:", error);
		return {
			success: false,
			error: { code: "DELETE_FAILED", message: "Failed to delete checklist item." },
		};
	}
}

export const checklistService = {
	create,
	update,
	delete: deleteItem,
};
