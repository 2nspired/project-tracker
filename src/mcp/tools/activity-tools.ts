import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

registerExtendedTool("listActivity", {
	category: "activity",
	description: "Recent activity for a board: what changed, who did it, when.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		limit: z.number().int().min(1).max(100).default(30).describe("Max items (1–100)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, limit }) =>
		safeExecute(async () => {
			const board = await db.board.findUnique({
				where: { id: boardId as string },
				include: {
					columns: {
						select: {
							cards: {
								select: { id: true },
							},
						},
					},
				},
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const cardIds = board.columns.flatMap((c) => c.cards.map((card) => card.id));

			const activities = await db.activity.findMany({
				where: { cardId: { in: cardIds } },
				orderBy: { createdAt: "desc" },
				take: limit as number,
				include: {
					card: { select: { number: true, title: true } },
				},
			});

			return ok(
				activities.map((a) => ({
					ref: `#${a.card.number}`,
					card: a.card.title,
					action: a.action,
					details: a.details,
					actor: a.actorName ?? a.actorType,
					when: a.createdAt,
				}))
			);
		}),
});
