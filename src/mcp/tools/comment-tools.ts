import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, resolveCardRef, safeExecute } from "../utils.js";

registerExtendedTool("listComments", {
	category: "comments",
	description: "List comments on a card. (getBoard returns only counts, not content.)",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ cardId }) =>
		safeExecute(async () => {
			const resolved = await resolveCardRef(cardId as string);
			if (!resolved.ok) return err(resolved.message);
			const id = resolved.id;

			const comments = await db.comment.findMany({
				where: { cardId: id },
				orderBy: { createdAt: "asc" },
			});

			return ok(
				comments.map((c) => ({
					id: c.id,
					content: c.content,
					authorType: c.authorType,
					authorName: c.authorName,
					createdAt: c.createdAt,
				}))
			);
		}),
});
