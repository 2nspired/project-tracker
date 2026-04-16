/**
 * Shared board-diff logic.
 * Both the tRPC handoff service and MCP session-tools delegate here.
 */

import type { PrismaClient } from "prisma/generated/client";

export type BoardDiff = {
	cardsMoved: Array<{ ref: string; title: string; from: string; to: string }>;
	cardsCreated: Array<{ ref: string; title: string; column: string }>;
	checklistProgress: Array<{ ref: string; title: string; completed: string }>;
	newComments: number;
	since: Date;
};

export async function computeBoardDiff(db: PrismaClient, boardId: string, since: Date): Promise<BoardDiff> {
	// Get all card IDs for the board via Column join
	const columns = await db.column.findMany({
		where: { boardId },
		include: {
			cards: {
				select: { id: true, number: true, title: true },
			},
		},
	});

	const cardMap = new Map<string, { number: number; title: string }>();
	for (const col of columns) {
		for (const card of col.cards) {
			cardMap.set(card.id, { number: card.number, title: card.title });
		}
	}

	const cardIds = Array.from(cardMap.keys());

	if (cardIds.length === 0) {
		return { cardsMoved: [], cardsCreated: [], checklistProgress: [], newComments: 0, since };
	}

	// Get activities since the given time
	const activities = await db.activity.findMany({
		where: {
			cardId: { in: cardIds },
			createdAt: { gt: since },
		},
		orderBy: { createdAt: "desc" },
	});

	const cardsMoved: BoardDiff["cardsMoved"] = [];
	const cardsCreated: BoardDiff["cardsCreated"] = [];
	const checklistProgress: BoardDiff["checklistProgress"] = [];

	for (const activity of activities) {
		const card = cardMap.get(activity.cardId);
		if (!card) continue;

		const ref = `#${card.number}`;

		if (activity.action === "moved" && activity.details) {
			const match = activity.details.match(/Moved from "(.+?)" to "(.+?)"/);
			if (match) {
				cardsMoved.push({ ref, title: card.title, from: match[1], to: match[2] });
			}
		} else if (activity.action === "created" && activity.details) {
			const match = activity.details.match(/created in (.+?)$/);
			const column = match ? match[1] : "Unknown";
			cardsCreated.push({ ref, title: card.title, column });
		} else if (activity.action === "checklist_completed" && activity.details) {
			checklistProgress.push({ ref, title: card.title, completed: activity.details });
		}
	}

	// Count new comments
	const newComments = await db.comment.count({
		where: {
			cardId: { in: cardIds },
			createdAt: { gt: since },
		},
	});

	return { cardsMoved, cardsCreated, checklistProgress, newComments, since };
}
