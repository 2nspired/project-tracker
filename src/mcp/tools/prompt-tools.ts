import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { resolveCardRef, ok, err, safeExecute } from "../utils.js";
import { buildAgentPrompt, type PromptCardInput } from "../../lib/prompt-builder.js";

// ─── Card-to-Prompt ───────────────────────────────────────────────

registerExtendedTool("generatePrompt", {
	category: "context",
	description: "Generate a ready-to-paste agent prompt from a card. Includes card context, checklist, decisions, and dependencies.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		cardId: z.string().describe("Card UUID or #number"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) => safeExecute(async () => {
		const { boardId, cardId } = params as { boardId: string; cardId: string };
		const board = await db.board.findUnique({
			where: { id: boardId },
			select: { id: true, projectId: true },
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const resolved = await resolveCardRef(cardId, board.projectId);
		if (!resolved.ok) return err(resolved.message);

		const card = await db.card.findUnique({
			where: { id: resolved.id },
			include: {
				checklists: { orderBy: { position: "asc" }, select: { text: true, completed: true } },
				column: { select: { name: true } },
				milestone: { select: { name: true } },
				decisions: {
					select: { title: true, status: true, decision: true },
					orderBy: { createdAt: "desc" },
				},
				relationsFrom: {
					where: { type: "blocks" },
					include: { toCard: { select: { number: true, title: true } } },
				},
				relationsTo: {
					where: { type: "blocks" },
					include: { fromCard: { select: { number: true, title: true } } },
				},
			},
		});
		if (!card) return err("Card not found.");

		const input: PromptCardInput = {
			ref: `#${card.number}`,
			boardId,
			title: card.title,
			description: card.description,
			priority: card.priority,
			tags: JSON.parse(card.tags) as string[],
			assignee: card.assignee,
			milestone: card.milestone?.name ?? null,
			column: card.column?.name ?? null,
			checklist: card.checklists,
			decisions: card.decisions,
			blockedBy: card.relationsTo.map((r) => ({
				ref: `#${r.fromCard.number}`,
				title: r.fromCard.title,
			})),
			blocks: card.relationsFrom.map((r) => ({
				ref: `#${r.toCard.number}`,
				title: r.toCard.title,
			})),
		};

		const prompt = buildAgentPrompt(input);

		return ok({ prompt, cardRef: input.ref, title: card.title });
	}),
});
