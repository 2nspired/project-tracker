import type { CardRelation } from "prisma/generated/client";
import type { CreateRelationInput } from "@/lib/schemas/relation-schemas";
import {
	linkCards,
	unlinkCards,
	getBlockers as getBlockersShared,
} from "@/lib/services/relations";
import type { BlockerEntry } from "@/lib/services/relations";
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

async function link(input: CreateRelationInput): Promise<ServiceResult<CardRelation>> {
	try {
		const { relation } = await linkCards(db, {
			fromCardId: input.fromCardId,
			toCardId: input.toCardId,
			type: input.type,
			actorName: "System",
		});
		return { success: true, data: relation };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to create relation.";
		console.error("[RELATION_SERVICE] link error:", error);
		if (message === "Source card not found." || message === "Target card not found.") {
			return { success: false, error: { code: "NOT_FOUND", message } };
		}
		if (message === "A card cannot be linked to itself.") {
			return { success: false, error: { code: "SELF_RELATION", message } };
		}
		return { success: false, error: { code: "LINK_FAILED", message } };
	}
}

async function unlink(fromCardId: string, toCardId: string, type: string): Promise<ServiceResult<{ deleted: true }>> {
	try {
		await unlinkCards(db, { fromCardId, toCardId, type, actorName: "System" });
		return { success: true, data: { deleted: true } };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to delete relation.";
		console.error("[RELATION_SERVICE] unlink error:", error);
		if (message === "Relation not found.") {
			return { success: false, error: { code: "NOT_FOUND", message } };
		}
		return { success: false, error: { code: "UNLINK_FAILED", message } };
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
		const data = await getBlockersShared(db, boardId);
		return { success: true, data };
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
