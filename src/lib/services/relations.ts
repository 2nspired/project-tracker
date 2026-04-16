/**
 * Shared card-relation logic.
 * Both the tRPC service and MCP tool delegate here.
 */

import type { CardRelation, PrismaClient } from "prisma/generated/client";

export type CardSummary = { id: string; number: number; title: string };

export type BlockerEntry = {
	card: CardSummary;
	blockedBy: CardSummary[];
};

export type LinkResult = {
	relation: CardRelation;
	fromCard: CardSummary;
	toCard: CardSummary;
};

export async function linkCards(
	db: PrismaClient,
	input: { fromCardId: string; toCardId: string; type: string; actorName: string },
): Promise<LinkResult> {
	if (input.fromCardId === input.toCardId) {
		throw new Error("A card cannot be linked to itself.");
	}

	const [fromCard, toCard] = await Promise.all([
		db.card.findUnique({ where: { id: input.fromCardId }, select: { id: true, number: true, title: true } }),
		db.card.findUnique({ where: { id: input.toCardId }, select: { id: true, number: true, title: true } }),
	]);

	if (!fromCard) throw new Error("Source card not found.");
	if (!toCard) throw new Error("Target card not found.");

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
				actorName: input.actorName,
			},
		}),
		db.activity.create({
			data: {
				cardId: input.toCardId,
				action: "linked",
				details: `Linked as "${input.type}" from #${fromCard.number}`,
				actorType: "AGENT",
				actorName: input.actorName,
			},
		}),
	]);

	return { relation, fromCard, toCard };
}

export async function unlinkCards(
	db: PrismaClient,
	input: { fromCardId: string; toCardId: string; type: string; actorName: string },
): Promise<{ fromCard: CardSummary | null; toCard: CardSummary | null }> {
	const [fromCard, toCard] = await Promise.all([
		db.card.findUnique({ where: { id: input.fromCardId }, select: { id: true, number: true, title: true } }),
		db.card.findUnique({ where: { id: input.toCardId }, select: { id: true, number: true, title: true } }),
	]);

	const relation = await db.cardRelation.findUnique({
		where: { fromCardId_toCardId_type: { fromCardId: input.fromCardId, toCardId: input.toCardId, type: input.type } },
	});

	if (!relation) throw new Error("Relation not found.");

	await db.cardRelation.delete({ where: { id: relation.id } });

	// Log activity on both cards if they still exist
	if (fromCard && toCard) {
		await Promise.all([
			db.activity.create({
				data: {
					cardId: input.fromCardId,
					action: "unlinked",
					details: `Unlinked "${input.type}" relation to #${toCard.number}`,
					actorType: "AGENT",
					actorName: input.actorName,
				},
			}),
			db.activity.create({
				data: {
					cardId: input.toCardId,
					action: "unlinked",
					details: `Unlinked "${input.type}" relation from #${fromCard.number}`,
					actorType: "AGENT",
					actorName: input.actorName,
				},
			}),
		]);
	}

	return { fromCard, toCard };
}

export async function getBlockers(
	db: PrismaClient,
	boardId?: string,
): Promise<BlockerEntry[]> {
	const where: Record<string, unknown> = { type: "blocks" };

	if (boardId) {
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

	return Array.from(blockerMap.values());
}
