import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, resolveCardRef, ok, err, safeExecute } from "../utils.js";

// ─── Relations ─────────────────────────────────────────────────────

registerExtendedTool("linkCards", {
	category: "relations",
	description: "Create a dependency between two cards.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		targetCardId: z.string().describe("Card UUID or #number"),
		type: z.enum(["blocks", "related", "parent"]).describe("blocks = cardId blocks targetCardId, related = bidirectional, parent = cardId is parent of targetCardId"),
	}),
	handler: ({ cardId, targetCardId, type }) => safeExecute(async () => {
		const fromResolved = await resolveCardRef(cardId as string);
		if (!fromResolved.ok) return err(fromResolved.message);
		const fromId = fromResolved.id;

		const toResolved = await resolveCardRef(targetCardId as string);
		if (!toResolved.ok) return err(toResolved.message);
		const toId = toResolved.id;

		if (fromId === toId) return err("A card cannot be linked to itself.");

		const [fromCard, toCard] = await Promise.all([
			db.card.findUnique({ where: { id: fromId }, select: { id: true, number: true, title: true } }),
			db.card.findUnique({ where: { id: toId }, select: { id: true, number: true, title: true } }),
		]);

		if (!fromCard) return err("Source card not found.");
		if (!toCard) return err("Target card not found.");

		const relation = await db.cardRelation.create({
			data: {
				fromCardId: fromId,
				toCardId: toId,
				type: type as string,
			},
		});

		// Log activity on both cards
		await Promise.all([
			db.activity.create({
				data: {
					cardId: fromId,
					action: "linked",
					details: `Linked as "${type}" to #${toCard.number}`,
					actorType: "AGENT",
					actorName: AGENT_NAME,
				},
			}),
			db.activity.create({
				data: {
					cardId: toId,
					action: "linked",
					details: `Linked as "${type}" from #${fromCard.number}`,
					actorType: "AGENT",
					actorName: AGENT_NAME,
				},
			}),
		]);

		return ok({
			id: relation.id,
			type: relation.type,
			from: { ref: `#${fromCard.number}`, title: fromCard.title },
			to: { ref: `#${toCard.number}`, title: toCard.title },
		});
	}),
});

registerExtendedTool("unlinkCards", {
	category: "relations",
	description: "Remove a dependency between two cards.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		targetCardId: z.string().describe("Card UUID or #number"),
		type: z.enum(["blocks", "related", "parent"]).describe("Relation type to remove"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ cardId, targetCardId, type }) => safeExecute(async () => {
		const fromResolved = await resolveCardRef(cardId as string);
		if (!fromResolved.ok) return err(fromResolved.message);
		const fromId = fromResolved.id;

		const toResolved = await resolveCardRef(targetCardId as string);
		if (!toResolved.ok) return err(toResolved.message);
		const toId = toResolved.id;

		const [fromCard, toCard] = await Promise.all([
			db.card.findUnique({ where: { id: fromId }, select: { id: true, number: true, title: true } }),
			db.card.findUnique({ where: { id: toId }, select: { id: true, number: true, title: true } }),
		]);

		const relation = await db.cardRelation.findUnique({
			where: { fromCardId_toCardId_type: { fromCardId: fromId, toCardId: toId, type: type as string } },
		});

		if (!relation) return err("Relation not found.", "Verify the card refs and relation type. Use getCard to see existing relations.");

		await db.cardRelation.delete({ where: { id: relation.id } });

		// Log activity on both cards if they still exist
		if (fromCard && toCard) {
			await Promise.all([
				db.activity.create({
					data: {
						cardId: fromId,
						action: "unlinked",
						details: `Unlinked "${type}" relation to #${toCard.number}`,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				}),
				db.activity.create({
					data: {
						cardId: toId,
						action: "unlinked",
						details: `Unlinked "${type}" relation from #${fromCard.number}`,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				}),
			]);
		}

		return ok({
			deleted: true,
			type: type as string,
			from: fromCard ? `#${fromCard.number}` : fromId,
			to: toCard ? `#${toCard.number}` : toId,
		});
	}),
});

registerExtendedTool("getBlockers", {
	category: "relations",
	description: "List cards that are blocked and what blocks them.",
	parameters: z.object({
		boardId: z.string().optional().describe("Board UUID — omit to search all boards"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId }) => safeExecute(async () => {
		const where: Record<string, unknown> = { type: "blocks" };

		if (boardId) {
			const board = await db.board.findUnique({ where: { id: boardId as string } });
			if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const columns = await db.column.findMany({
				where: { boardId: boardId as string },
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

		// Group by blocked card
		const blockerMap = new Map<string, { card: { ref: string; id: string; title: string }; blockedBy: Array<{ ref: string; id: string; title: string }> }>();
		for (const rel of relations) {
			const key = rel.toCardId;
			if (!blockerMap.has(key)) {
				blockerMap.set(key, {
					card: { ref: `#${rel.toCard.number}`, id: rel.toCard.id, title: rel.toCard.title },
					blockedBy: [],
				});
			}
			blockerMap.get(key)!.blockedBy.push({
				ref: `#${rel.fromCard.number}`,
				id: rel.fromCard.id,
				title: rel.fromCard.title,
			});
		}

		const blockers = Array.from(blockerMap.values());
		return ok({
			totalBlocked: blockers.length,
			blockers,
		});
	}),
});
