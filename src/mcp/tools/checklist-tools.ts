import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, err, ok, resolveCardRef, safeExecute } from "../utils.js";

registerExtendedTool("bulkAddChecklistItems", {
	category: "checklist",
	description:
		"Add checklist items to one or more cards. Pass an array of { cardId, items } objects.",
	parameters: z.object({
		cards: z
			.array(
				z.object({
					cardId: z.string().describe("Card UUID or #number"),
					items: z.array(z.string()).min(1).describe("Checklist item texts"),
				})
			)
			.min(1)
			.describe("Array of card + items pairs"),
	}),
	handler: ({ cards }) =>
		safeExecute(async () => {
			const results: Array<{
				cardRef: string;
				added: number;
				items: Array<{ id: string; text: string }>;
			}> = [];
			const errors: string[] = [];

			for (const entry of cards as Array<{ cardId: string; items: string[] }>) {
				const resolved = await resolveCardRef(entry.cardId);
				if (!resolved.ok) {
					errors.push(resolved.message);
					continue;
				}
				const id = resolved.id;

				const maxPos = await db.checklistItem.aggregate({
					where: { cardId: id },
					_max: { position: true },
				});
				let pos = (maxPos._max.position ?? -1) + 1;

				const created: Array<{ id: string; text: string }> = [];
				for (const text of entry.items) {
					const item = await db.checklistItem.create({
						data: { cardId: id, text, position: pos++ },
					});
					created.push({ id: item.id, text: item.text });
				}

				results.push({ cardRef: entry.cardId, added: created.length, items: created });
			}

			return ok({ results, errors: errors.length > 0 ? errors : undefined });
		}),
});

registerExtendedTool("addChecklistItem", {
	category: "checklist",
	description: "Add a checklist item to a card.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		text: z.string().describe("Item text"),
	}),
	handler: ({ cardId, text }) =>
		safeExecute(async () => {
			const resolved = await resolveCardRef(cardId as string);
			if (!resolved.ok) return err(resolved.message);
			const id = resolved.id;

			const maxPos = await db.checklistItem.aggregate({
				where: { cardId: id },
				_max: { position: true },
			});
			const item = await db.checklistItem.create({
				data: { cardId: id, text: text as string, position: (maxPos._max.position ?? -1) + 1 },
			});

			return ok({ id: item.id, text: item.text, completed: false });
		}),
});

registerExtendedTool("toggleChecklistItem", {
	category: "checklist",
	description:
		"Mark a checklist item complete or incomplete. Use after verifying a subtask is done, or to reverse an accidental check. Get the `checklistItemId` from `getCardContext` or `getBoard`. Toggling produces an activity row visible on the card.",
	parameters: z.object({
		checklistItemId: z
			.string()
			.describe("UUID from getBoard (columns[].cards[].checklist.items[].id) or getCard"),
		completed: z.boolean().describe("true=complete, false=incomplete"),
	}),
	handler: ({ checklistItemId, completed }) =>
		safeExecute(async () => {
			const item = await db.checklistItem.findUnique({ where: { id: checklistItemId as string } });
			if (!item)
				return err(
					"Checklist item not found.",
					"Get item IDs from getBoard (full mode, not summary) or getCardContext({ boardId, cardId: '#number' })."
				);

			const updated = await db.checklistItem.update({
				where: { id: checklistItemId as string },
				data: { completed: completed as boolean },
			});

			if (completed) {
				await db.activity.create({
					data: {
						cardId: item.cardId,
						action: "checklist_completed",
						details: `Completed: ${item.text}`,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				});
			}

			return ok({ id: updated.id, text: updated.text, completed: updated.completed });
		}),
});
