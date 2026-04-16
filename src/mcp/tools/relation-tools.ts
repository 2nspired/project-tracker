import { z } from "zod";
import {
	linkCards,
	unlinkCards,
	getBlockers as getBlockersShared,
} from "../../lib/services/relations.js";
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

		const { relation, fromCard, toCard } = await linkCards(db, {
			fromCardId: fromId,
			toCardId: toId,
			type: type as string,
			actorName: AGENT_NAME,
		});

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

		const { fromCard, toCard } = await unlinkCards(db, {
			fromCardId: fromId,
			toCardId: toId,
			type: type as string,
			actorName: AGENT_NAME,
		});

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
		if (boardId) {
			const board = await db.board.findUnique({ where: { id: boardId as string } });
			if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");
		}

		const blockerEntries = await getBlockersShared(db, boardId as string | undefined);

		const blockers = blockerEntries.map((entry) => ({
			card: { ref: `#${entry.card.number}`, id: entry.card.id, title: entry.card.title },
			blockedBy: entry.blockedBy.map((b) => ({ ref: `#${b.number}`, id: b.id, title: b.title })),
		}));

		return ok({
			totalBlocked: blockers.length,
			blockers,
		});
	}),
});
