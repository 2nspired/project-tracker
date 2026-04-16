import type { Card } from "prisma/generated/client";
import type { CreateCardInput, MoveCardInput, UpdateCardInput } from "@/lib/schemas/card-schemas";
import { parseCardScope, scopeSchema } from "@/lib/schemas/card-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

async function listByColumn(columnId: string): Promise<ServiceResult<Card[]>> {
	try {
		const cards = await db.card.findMany({
			where: { columnId },
			orderBy: { position: "asc" },
		});
		return { success: true, data: cards };
	} catch (error) {
		console.error("[CARD_SERVICE] listByColumn error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to fetch cards." } };
	}
}

async function getById(cardId: string): Promise<
	ServiceResult<
		Card & {
			checklists: Array<{ id: string; text: string; completed: boolean; position: number }>;
			comments: Array<{
				id: string;
				content: string;
				authorType: string;
				authorName: string | null;
				createdAt: Date;
			}>;
			activities: Array<{
				id: string;
				action: string;
				details: string | null;
				actorType: string;
				actorName: string | null;
				createdAt: Date;
			}>;
			relationsFrom: Array<{
				id: string;
				type: string;
				toCard: { id: string; number: number; title: string };
			}>;
			relationsTo: Array<{
				id: string;
				type: string;
				fromCard: { id: string; number: number; title: string };
			}>;
			decisions: Array<{
				id: string;
				title: string;
				status: string;
				decision: string;
			}>;
			gitLinks: Array<{
				id: string;
				commitHash: string;
				message: string;
				author: string;
				commitDate: Date;
				filePaths: string;
			}>;
		}
	>
> {
	try {
		const card = await db.card.findUnique({
			where: { id: cardId },
			include: {
				checklists: { orderBy: { position: "asc" } },
				comments: { orderBy: { createdAt: "asc" } },
				activities: { orderBy: { createdAt: "desc" } },
				relationsFrom: { include: { toCard: { select: { id: true, number: true, title: true } } } },
				relationsTo: { include: { fromCard: { select: { id: true, number: true, title: true } } } },
				decisions: { select: { id: true, title: true, status: true, decision: true }, orderBy: { createdAt: "desc" } },
				gitLinks: { orderBy: { commitDate: "desc" }, take: 20 },
			},
		});
		if (!card) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}
		return { success: true, data: card };
	} catch (error) {
		console.error("[CARD_SERVICE] getById error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch card." } };
	}
}

async function create(data: CreateCardInput): Promise<ServiceResult<Card>> {
	try {
		// Resolve projectId from column -> board -> project
		const column = await db.column.findUnique({
			where: { id: data.columnId },
			include: { board: { select: { projectId: true } } },
		});
		if (!column) {
			return { success: false, error: { code: "NOT_FOUND", message: "Column not found." } };
		}
		const projectId = column.board.projectId;

		// Wrap position + number + create in a transaction to prevent race conditions
		const card = await db.$transaction(async (tx) => {
			const maxPosition = await tx.card.aggregate({
				where: { columnId: data.columnId },
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
					columnId: data.columnId,
					projectId,
					number: cardNumber,
					title: data.title,
					description: data.description,
					priority: data.priority,
					tags: JSON.stringify(data.tags),
					assignee: data.assignee,
					createdBy: data.createdBy,
					dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
					milestoneId: data.milestoneId ?? undefined,
					position,
				},
			});

			await tx.activity.create({
				data: {
					cardId: created.id,
					action: "created",
					details: `Card #${cardNumber} "${created.title}" created`,
					actorType: data.createdBy,
					actorName: data.createdBy === "AGENT" ? "Claude" : undefined,
				},
			});

			return created;
		});

		return { success: true, data: card };
	} catch (error) {
		console.error("[CARD_SERVICE] create error:", error);
		return { success: false, error: { code: "CREATE_FAILED", message: "Failed to create card." } };
	}
}

async function update(cardId: string, data: UpdateCardInput): Promise<ServiceResult<Card>> {
	try {
		const existing = await db.card.findUnique({ where: { id: cardId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}

		let mergedScope: string | undefined;
		if (data.scope) {
			const existingScope = parseCardScope(existing.scope);
			mergedScope = JSON.stringify(scopeSchema.parse({ ...existingScope, ...data.scope }));
		}

		const card = await db.card.update({
			where: { id: cardId },
			data: {
				title: data.title,
				description: data.description,
				priority: data.priority,
				tags: data.tags ? JSON.stringify(data.tags) : undefined,
				assignee: data.assignee,
				dueDate: data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : undefined,
				milestoneId: data.milestoneId !== undefined ? data.milestoneId : undefined,
				scope: mergedScope,
			},
		});
		return { success: true, data: card };
	} catch (error) {
		console.error("[CARD_SERVICE] update error:", error);
		return { success: false, error: { code: "UPDATE_FAILED", message: "Failed to update card." } };
	}
}

async function move(cardId: string, data: MoveCardInput): Promise<ServiceResult<Card>> {
	try {
		const existing = await db.card.findUnique({
			where: { id: cardId },
			include: { column: true },
		});
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}

		const targetColumn = await db.card.findMany({
			where: { columnId: data.columnId },
			orderBy: { position: "asc" },
		});

		// Remove the card from its current position in the target list
		const filtered = targetColumn.filter((c) => c.id !== cardId);

		// Insert at new position
		const newPosition = Math.min(data.position, filtered.length);
		filtered.splice(newPosition, 0, existing);

		// Update all positions in batch
		const updates = filtered.map((c, i) =>
			db.card.update({
				where: { id: c.id },
				data: { columnId: data.columnId, position: i },
			}),
		);

		await db.$transaction(updates);

		if (existing.columnId !== data.columnId) {
			const movedColumn = await db.column.findUnique({ where: { id: data.columnId } });
			if (movedColumn) {
				await db.activity.create({
					data: {
						cardId,
						action: "moved",
						details: `Moved from "${existing.column.name}" to "${movedColumn.name}"`,
						actorType: "HUMAN",
					},
				});
			}
		}

		// Return the card with updated position/column without an extra query
		const finalPosition = filtered.findIndex((c) => c.id === cardId);
		return { success: true, data: { ...existing, columnId: data.columnId, position: finalPosition >= 0 ? finalPosition : data.position } };
	} catch (error) {
		console.error("[CARD_SERVICE] move error:", error);
		return { success: false, error: { code: "MOVE_FAILED", message: "Failed to move card." } };
	}
}

async function deleteCard(cardId: string): Promise<ServiceResult<Card>> {
	try {
		const existing = await db.card.findUnique({ where: { id: cardId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}

		const card = await db.card.delete({ where: { id: cardId } });
		return { success: true, data: card };
	} catch (error) {
		console.error("[CARD_SERVICE] delete error:", error);
		return { success: false, error: { code: "DELETE_FAILED", message: "Failed to delete card." } };
	}
}

async function listAll(filters?: {
	priority?: string;
	assignee?: string;
	tag?: string;
	search?: string;
}): Promise<ServiceResult<Array<Card & {
	column: { name: string; role: string | null; board: { name: string; id: string; project: { name: string; id: string } } };
	milestone: { id: string; name: string } | null;
	checklists: Array<{ completed: boolean }>;
}>>> {
	try {
		const where: Record<string, unknown> = {};

		if (filters?.priority && filters.priority !== "ALL") {
			where.priority = filters.priority;
		}
		if (filters?.assignee) {
			if (filters.assignee === "UNASSIGNED") {
				where.assignee = null;
			} else if (filters.assignee !== "ALL") {
				where.assignee = filters.assignee;
			}
		}
		if (filters?.search) {
			where.OR = [
				{ title: { contains: filters.search } },
				{ description: { contains: filters.search } },
			];
		}
		// Filter tags in the DB using JSON string contains with quoted value
		// e.g. tag "bug" matches `"bug"` in the JSON array string `["bug","ui"]`
		if (filters?.tag && filters.tag !== "ALL") {
			where.tags = { contains: `"${filters.tag}"` };
		}

		const cards = await db.card.findMany({
			where,
			include: {
				column: {
					include: {
						board: {
							include: { project: { select: { name: true, id: true } } },
						},
					},
				},
				milestone: { select: { id: true, name: true } },
				checklists: { select: { completed: true } },
			},
			orderBy: { updatedAt: "desc" },
			take: 200,
		});

		return { success: true, data: cards };
	} catch (error) {
		console.error("[CARD_SERVICE] listAll error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to fetch cards." } };
	}
}

export const cardService = {
	listByColumn,
	listAll,
	getById,
	create,
	update,
	move,
	delete: deleteCard,
};
