import type { Column } from "prisma/generated/client";
import type { CreateColumnInput, UpdateColumnInput } from "@/lib/schemas/column-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

async function create(data: CreateColumnInput): Promise<ServiceResult<Column>> {
	try {
		const maxPosition = await db.column.aggregate({
			where: { boardId: data.boardId },
			_max: { position: true },
		});
		const position = (maxPosition._max.position ?? -1) + 1;

		const column = await db.column.create({
			data: {
				boardId: data.boardId,
				name: data.name,
				description: data.description,
				color: data.color,
				position,
			},
		});
		return { success: true, data: column };
	} catch (error) {
		console.error("[COLUMN_SERVICE] create error:", error);
		return {
			success: false,
			error: { code: "CREATE_FAILED", message: "Failed to create column." },
		};
	}
}

async function update(columnId: string, data: UpdateColumnInput): Promise<ServiceResult<Column>> {
	try {
		const existing = await db.column.findUnique({ where: { id: columnId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Column not found." } };
		}

		const column = await db.column.update({
			where: { id: columnId },
			data,
		});
		return { success: true, data: column };
	} catch (error) {
		console.error("[COLUMN_SERVICE] update error:", error);
		return {
			success: false,
			error: { code: "UPDATE_FAILED", message: "Failed to update column." },
		};
	}
}

async function reorder(boardId: string, columnIds: string[]): Promise<ServiceResult<Column[]>> {
	try {
		const updates = columnIds.map((id, i) =>
			db.column.update({
				where: { id },
				data: { position: i },
			})
		);
		const columns = await db.$transaction(updates);
		return { success: true, data: columns };
	} catch (error) {
		console.error("[COLUMN_SERVICE] reorder error:", error);
		return {
			success: false,
			error: { code: "REORDER_FAILED", message: "Failed to reorder columns." },
		};
	}
}

async function deleteColumn(columnId: string): Promise<ServiceResult<Column>> {
	try {
		const existing = await db.column.findUnique({ where: { id: columnId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Column not found." } };
		}
		if (existing.isParking) {
			return {
				success: false,
				error: { code: "CANNOT_DELETE", message: "Cannot delete the parking lot." },
			};
		}

		const column = await db.column.delete({ where: { id: columnId } });
		return { success: true, data: column };
	} catch (error) {
		console.error("[COLUMN_SERVICE] delete error:", error);
		return {
			success: false,
			error: { code: "DELETE_FAILED", message: "Failed to delete column." },
		};
	}
}

export const columnService = {
	create,
	update,
	reorder,
	delete: deleteColumn,
};
