import type { Card, PrismaClient } from "prisma/generated/client";
import { hasRole } from "@/lib/column-roles";
import type { CreateCardInput, MoveCardInput, UpdateCardInput } from "@/lib/schemas/card-schemas";
import { slugify as slugifyTag } from "@/lib/slugify";
import { db } from "@/server/db";
import { findStaleInProgress } from "@/server/services/stale-cards";
import { tagService } from "@/server/services/tag-service";
import type { ServiceResult } from "@/server/services/types/service-result";

// Resolve a list of free-form tag labels into canonical (tagId, label) pairs
// using tagService.resolveOrCreate. Used when the legacy `tags: string[]`
// input flows through the web UI's tRPC card.update — the service mirrors
// what the MCP write paths do (Phase 4) so the CardTag junction stays the
// canonical source of truth across both surfaces.
async function resolveLegacyTagsForWeb(
	_prisma: PrismaClient,
	projectId: string,
	inputs: string[]
): Promise<{ tagIds: string[]; labels: string[] }> {
	const tagIds: string[] = [];
	const labels: string[] = [];
	const seen = new Set<string>();
	for (const inputLabel of inputs) {
		const result = await tagService.resolveOrCreate(projectId, inputLabel);
		if (!result.success) continue; // skip empty-slug inputs silently
		if (seen.has(result.data.id)) continue; // dedupe within the input array
		seen.add(result.data.id);
		tagIds.push(result.data.id);
		labels.push(result.data.label);
	}
	return { tagIds, labels };
}

// Idempotent CardTag junction sync. Replaces all rows for the card with the
// given tagIds — full desired-state input, transactional. Mirrors the MCP
// helper in src/mcp/taxonomy-utils.ts; kept inline here so card-service.ts
// has no MCP-layer dependency.
async function syncCardTagsTx(
	tx: Pick<PrismaClient, "cardTag">,
	cardId: string,
	tagIds: string[]
): Promise<void> {
	if (tagIds.length === 0) {
		await tx.cardTag.deleteMany({ where: { cardId } });
		return;
	}
	await tx.cardTag.deleteMany({ where: { cardId, tagId: { notIn: tagIds } } });
	for (const tagId of tagIds) {
		await tx.cardTag.upsert({
			where: { cardId_tagId: { cardId, tagId } },
			create: { cardId, tagId },
			update: {},
		});
	}
}

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
		Omit<Card, "tags"> & {
			tags: string[];
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
				intent: string | null;
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
			gitLinks: Array<{
				id: string;
				commitHash: string;
				message: string;
				author: string;
				commitDate: Date;
				filePaths: string;
			}>;
			stale?: { days: number; lastSignalAt: string };
		}
	>
> {
	try {
		const card = await db.card.findUnique({
			where: { id: cardId },
			include: {
				column: { select: { boardId: true } },
				checklists: { orderBy: { position: "asc" } },
				comments: { orderBy: { createdAt: "asc" } },
				activities: { orderBy: { createdAt: "desc" } },
				relationsFrom: { include: { toCard: { select: { id: true, number: true, title: true } } } },
				relationsTo: { include: { fromCard: { select: { id: true, number: true, title: true } } } },
				gitLinks: { orderBy: { commitDate: "desc" }, take: 20 },
				cardTags: { include: { tag: { select: { label: true, slug: true } } } },
			},
		});
		if (!card) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}

		const staleMap = await findStaleInProgress(db, card.column.boardId);
		const info = staleMap.get(card.id);
		// Project CardTag → tags: string[] for the API surface; UI expects an
		// array of labels rather than the junction rows.
		const { column: _column, cardTags, ...cardWithoutColumn } = card;
		const tags = cardTags.map((ct) => ct.tag.label);
		const enriched = info
			? {
					...cardWithoutColumn,
					tags,
					stale: { days: info.days, lastSignalAt: info.lastSignalAt.toISOString() },
				}
			: { ...cardWithoutColumn, tags };
		return { success: true, data: enriched };
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

		// Resolve legacy tag inputs into canonical (tagId, label) pairs BEFORE
		// the transaction — resolveOrCreate has its own writes and shouldn't
		// nest inside the card-create tx.
		const { tagIds } = data.tags?.length
			? await resolveLegacyTagsForWeb(db, projectId, data.tags)
			: { tagIds: [] };

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
					createdBy: data.createdBy,
					dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
					milestoneId: data.milestoneId ?? undefined,
					position,
				},
			});

			if (tagIds.length > 0) {
				await syncCardTagsTx(tx as unknown as PrismaClient, created.id, tagIds);
			}

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

		// Resolve tags up front (writes to Tag table happen here).
		const tagsApplied = data.tags !== undefined;
		const { tagIds } = tagsApplied
			? await resolveLegacyTagsForWeb(db, existing.projectId, data.tags ?? [])
			: { tagIds: [] };
		const nextDueDate =
			data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : undefined;
		const nextMilestoneId = data.milestoneId !== undefined ? data.milestoneId : undefined;

		// Detect tag-set churn by comparing existing CardTag rows to the resolved
		// target set; a length mismatch or any new tagId triggers a re-sync.
		let tagsChanged = false;
		if (tagsApplied) {
			const existingCardTags = await db.cardTag.findMany({
				where: { cardId },
				select: { tagId: true },
			});
			const existingIds = new Set(existingCardTags.map((ct) => ct.tagId));
			tagsChanged = existingIds.size !== tagIds.length || tagIds.some((id) => !existingIds.has(id));
		}

		const changed =
			(data.title !== undefined && data.title !== existing.title) ||
			(data.description !== undefined && data.description !== existing.description) ||
			(data.priority !== undefined && data.priority !== existing.priority) ||
			tagsChanged ||
			(nextDueDate !== undefined &&
				(nextDueDate?.getTime() ?? null) !==
					(existing.dueDate ? new Date(existing.dueDate).getTime() : null)) ||
			(nextMilestoneId !== undefined && nextMilestoneId !== existing.milestoneId);

		if (!changed) {
			return { success: true, data: existing };
		}

		const card = await db.$transaction(async (tx) => {
			const updated = await tx.card.update({
				where: { id: cardId },
				data: {
					title: data.title,
					description: data.description,
					priority: data.priority,
					dueDate: nextDueDate,
					milestoneId: nextMilestoneId,
					lastEditedBy: "HUMAN",
				},
			});
			if (tagsApplied) {
				await syncCardTagsTx(tx as unknown as PrismaClient, cardId, tagIds);
			}
			await tx.activity.create({
				data: { cardId, action: "updated", actorType: "HUMAN" },
			});
			return updated;
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

		const targetColumnRow = await db.column.findUnique({ where: { id: data.columnId } });
		if (!targetColumnRow) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Target column not found." },
			};
		}

		const sourceIsDone = hasRole(existing.column, "done");
		const targetIsDone = hasRole(targetColumnRow, "done");
		const enteringDone = targetIsDone && !sourceIsDone;
		const leavingDone = sourceIsDone && !targetIsDone;

		const targetColumn = await db.card.findMany({
			where: { columnId: data.columnId },
			orderBy: { position: "asc" },
		});

		// Remove the card from its current position in the target list
		const filtered = targetColumn.filter((c) => c.id !== cardId);

		// Insert at new position
		const newPosition = Math.min(data.position, filtered.length);
		filtered.splice(newPosition, 0, existing);

		// Update positions in batch; stamp lastEditedBy only on the moved card.
		// completedAt is only touched on Done entry/exit so siblings don't have
		// their ship-date clobbered when an unrelated card lands in Done.
		// Skip the update for siblings whose position doesn't actually change —
		// otherwise Prisma's @updatedAt bumps every untouched card to ~now and
		// pollutes "recently active" signals (#175).
		const completedAtPatch = enteringDone
			? { completedAt: new Date() }
			: leavingDone
				? { completedAt: null }
				: {};
		const updates = filtered.flatMap((c, i) => {
			const isMovedCard = c.id === cardId;
			const positionChanged = c.position !== i;
			if (!isMovedCard && !positionChanged) return [];
			return [
				db.card.update({
					where: { id: c.id },
					data: {
						columnId: data.columnId,
						position: i,
						...(isMovedCard && { lastEditedBy: "HUMAN", ...completedAtPatch }),
					},
				}),
			];
		});

		if (updates.length > 0) await db.$transaction(updates);

		if (existing.columnId !== data.columnId) {
			await db.activity.create({
				data: {
					cardId,
					action: "moved",
					details: `Moved from "${existing.column.name}" to "${targetColumnRow.name}"`,
					actorType: "HUMAN",
				},
			});
		}

		// Return the card with updated position/column without an extra query
		const finalPosition = filtered.findIndex((c) => c.id === cardId);
		return {
			success: true,
			data: {
				...existing,
				columnId: data.columnId,
				position: finalPosition >= 0 ? finalPosition : data.position,
				completedAt: enteringDone ? new Date() : leavingDone ? null : existing.completedAt,
			},
		};
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

async function listAll(filters?: { priority?: string; tag?: string; search?: string }): Promise<
	ServiceResult<
		Array<
			Omit<Card, "tags"> & {
				tags: string[];
				column: {
					name: string;
					role: string | null;
					board: { name: string; id: string; project: { name: string; id: string } };
				};
				milestone: { id: string; name: string } | null;
				checklists: Array<{ completed: boolean }>;
			}
		>
	>
> {
	try {
		const where: Record<string, unknown> = {};

		if (filters?.priority && filters.priority !== "ALL") {
			where.priority = filters.priority;
		}
		if (filters?.search) {
			where.OR = [
				{ title: { contains: filters.search } },
				{ description: { contains: filters.search } },
			];
		}
		// Filter through the CardTag junction by normalized slug — the v4.2 →
		// v5 migration dropped the legacy JSON column, so this is the only path.
		if (filters?.tag && filters.tag !== "ALL") {
			const slug = slugifyTag(filters.tag);
			if (slug) {
				where.cardTags = { some: { tag: { slug } } };
			}
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
				cardTags: { include: { tag: { select: { label: true } } } },
			},
			orderBy: { updatedAt: "desc" },
			take: 200,
		});

		const projected = cards.map(({ cardTags, ...rest }) => ({
			...rest,
			tags: cardTags.map((ct) => ct.tag.label),
		}));

		return { success: true, data: projected };
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
