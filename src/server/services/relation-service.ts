import type { CardRelation } from "prisma/generated/client";
import type { CreateRelationInput } from "@/lib/schemas/relation-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type CardSummary = { id: string; number: number; title: string };

type RelationsForCard = {
	blocks: CardSummary[];
	blockedBy: CardSummary[];
	relatedTo: CardSummary[];
	parentOf: CardSummary[];
	childOf: CardSummary[];
};

type BlockerEntry = {
	card: CardSummary;
	blockedBy: CardSummary[];
};

async function link(input: CreateRelationInput): Promise<ServiceResult<CardRelation>> {
	try {
		if (input.fromCardId === input.toCardId) {
			return { success: false, error: { code: "SELF_RELATION", message: "A card cannot be linked to itself." } };
		}

		const [fromCard, toCard] = await Promise.all([
			db.card.findUnique({ where: { id: input.fromCardId }, select: { id: true, number: true, title: true } }),
			db.card.findUnique({ where: { id: input.toCardId }, select: { id: true, number: true, title: true } }),
		]);

		if (!fromCard) {
			return { success: false, error: { code: "NOT_FOUND", message: "Source card not found." } };
		}
		if (!toCard) {
			return { success: false, error: { code: "NOT_FOUND", message: "Target card not found." } };
		}

		const relation = await db.cardRelation.create({
			data: {
				fromCardId: input.fromCardId,
				toCardId: input.toCardId,
				type: input.type,
			},
		});

		// Log activity on both cards
		await Promise.all([
			db.activity.create({
				data: {
					cardId: input.fromCardId,
					action: "linked",
					details: `Linked as "${input.type}" to #${toCard.number}`,
					actorType: "AGENT",
					actorName: "System",
				},
			}),
			db.activity.create({
				data: {
					cardId: input.toCardId,
					action: "linked",
					details: `Linked as "${input.type}" from #${fromCard.number}`,
					actorType: "AGENT",
					actorName: "System",
				},
			}),
		]);

		return { success: true, data: relation };
	} catch (error) {
		console.error("[RELATION_SERVICE] link error:", error);
		return { success: false, error: { code: "LINK_FAILED", message: "Failed to create relation." } };
	}
}

async function unlink(fromCardId: string, toCardId: string, type: string): Promise<ServiceResult<{ deleted: true }>> {
	try {
		const [fromCard, toCard] = await Promise.all([
			db.card.findUnique({ where: { id: fromCardId }, select: { id: true, number: true, title: true } }),
			db.card.findUnique({ where: { id: toCardId }, select: { id: true, number: true, title: true } }),
		]);

		const relation = await db.cardRelation.findUnique({
			where: { fromCardId_toCardId_type: { fromCardId, toCardId, type } },
		});

		if (!relation) {
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found." } };
		}

		await db.cardRelation.delete({
			where: { id: relation.id },
		});

		// Log activity on both cards if they still exist
		const activityPromises = [];
		if (fromCard && toCard) {
			activityPromises.push(
				db.activity.create({
					data: {
						cardId: fromCardId,
						action: "unlinked",
						details: `Unlinked "${type}" relation to #${toCard.number}`,
						actorType: "AGENT",
						actorName: "System",
					},
				}),
				db.activity.create({
					data: {
						cardId: toCardId,
						action: "unlinked",
						details: `Unlinked "${type}" relation from #${fromCard.number}`,
						actorType: "AGENT",
						actorName: "System",
					},
				}),
			);
		}
		await Promise.all(activityPromises);

		return { success: true, data: { deleted: true } };
	} catch (error) {
		console.error("[RELATION_SERVICE] unlink error:", error);
		return { success: false, error: { code: "UNLINK_FAILED", message: "Failed to delete relation." } };
	}
}

async function getForCard(cardId: string): Promise<ServiceResult<RelationsForCard>> {
	try {
		const card = await db.card.findUnique({ where: { id: cardId } });
		if (!card) {
			return { success: false, error: { code: "NOT_FOUND", message: "Card not found." } };
		}

		const [relationsFrom, relationsTo] = await Promise.all([
			db.cardRelation.findMany({
				where: { fromCardId: cardId },
				include: { toCard: { select: { id: true, number: true, title: true } } },
			}),
			db.cardRelation.findMany({
				where: { toCardId: cardId },
				include: { fromCard: { select: { id: true, number: true, title: true } } },
			}),
		]);

		const result: RelationsForCard = {
			blocks: [],
			blockedBy: [],
			relatedTo: [],
			parentOf: [],
			childOf: [],
		};

		for (const rel of relationsFrom) {
			const summary: CardSummary = { id: rel.toCard.id, number: rel.toCard.number, title: rel.toCard.title };
			if (rel.type === "blocks") {
				result.blocks.push(summary);
			} else if (rel.type === "related") {
				result.relatedTo.push(summary);
			} else if (rel.type === "parent") {
				result.parentOf.push(summary);
			}
		}

		for (const rel of relationsTo) {
			const summary: CardSummary = { id: rel.fromCard.id, number: rel.fromCard.number, title: rel.fromCard.title };
			if (rel.type === "blocks") {
				result.blockedBy.push(summary);
			} else if (rel.type === "related") {
				result.relatedTo.push(summary);
			} else if (rel.type === "parent") {
				result.childOf.push(summary);
			}
		}

		return { success: true, data: result };
	} catch (error) {
		console.error("[RELATION_SERVICE] getForCard error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch relations." } };
	}
}

async function getBlockers(boardId?: string): Promise<ServiceResult<BlockerEntry[]>> {
	try {
		const where: Record<string, unknown> = { type: "blocks" };

		if (boardId) {
			// Find all card IDs on this board
			const columns = await db.column.findMany({
				where: { boardId },
				select: { cards: { select: { id: true } } },
			});
			const cardIds = columns.flatMap((c) => c.cards.map((card) => card.id));
			where.toCardId = { in: cardIds };
		}

		const relations = await db.cardRelation.findMany({
			where,
			include: {
				fromCard: { select: { id: true, number: true, title: true } },
				toCard: { select: { id: true, number: true, title: true } },
			},
		});

		// Group by blocked card (toCard)
		const blockerMap = new Map<string, BlockerEntry>();
		for (const rel of relations) {
			const key = rel.toCardId;
			if (!blockerMap.has(key)) {
				blockerMap.set(key, {
					card: { id: rel.toCard.id, number: rel.toCard.number, title: rel.toCard.title },
					blockedBy: [],
				});
			}
			blockerMap.get(key)!.blockedBy.push({
				id: rel.fromCard.id,
				number: rel.fromCard.number,
				title: rel.fromCard.title,
			});
		}

		return { success: true, data: Array.from(blockerMap.values()) };
	} catch (error) {
		console.error("[RELATION_SERVICE] getBlockers error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch blockers." } };
	}
}

export const relationService = {
	link,
	unlink,
	getForCard,
	getBlockers,
};
