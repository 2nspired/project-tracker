import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, ok, err, safeExecute } from "../utils.js";

// ─── Session ───────────────────────────────────────────────────────

registerExtendedTool("saveHandoff", {
	category: "session",
	description: "Save session handoff for the next agent/conversation.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		workingOn: z.array(z.string()).default([]).describe("What you were working on"),
		findings: z.array(z.string()).default([]).describe("Key findings or discoveries"),
		nextSteps: z.array(z.string()).default([]).describe("Suggested next actions"),
		blockers: z.array(z.string()).default([]).describe("Anything blocking progress"),
		summary: z.string().default("").describe("Brief session summary"),
	}),
	handler: ({ boardId, workingOn, findings, nextSteps, blockers, summary }) => safeExecute(async () => {
		const board = await db.board.findUnique({ where: { id: boardId as string } });
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const handoff = await db.sessionHandoff.create({
			data: {
				boardId: boardId as string,
				agentName: AGENT_NAME,
				workingOn: JSON.stringify(workingOn ?? []),
				findings: JSON.stringify(findings ?? []),
				nextSteps: JSON.stringify(nextSteps ?? []),
				blockers: JSON.stringify(blockers ?? []),
				summary: (summary as string) ?? "",
			},
		});

		return ok({
			id: handoff.id,
			agentName: AGENT_NAME,
			boardId: handoff.boardId,
			createdAt: handoff.createdAt,
			saved: true,
		});
	}),
});

registerExtendedTool("loadHandoff", {
	category: "session",
	description: "Load latest handoff and changes since then.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId }) => safeExecute(async () => {
		const board = await db.board.findUnique({ where: { id: boardId as string } });
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		// Get latest handoff
		const handoff = await db.sessionHandoff.findFirst({
			where: { boardId: boardId as string },
			orderBy: { createdAt: "desc" },
		});

		if (!handoff) {
			return ok({ handoff: null, diff: null, message: "No previous handoff found." });
		}

		// Compute board diff since handoff
		const diff = await computeBoardDiff(boardId as string, handoff.createdAt);

		return ok({
			handoff: {
				id: handoff.id,
				agentName: handoff.agentName,
				workingOn: JSON.parse(handoff.workingOn),
				findings: JSON.parse(handoff.findings),
				nextSteps: JSON.parse(handoff.nextSteps),
				blockers: JSON.parse(handoff.blockers),
				summary: handoff.summary,
				createdAt: handoff.createdAt,
			},
			diff,
		});
	}),
});

registerExtendedTool("getBoardDiff", {
	category: "session",
	description: "Semantic diff: what changed on the board since a given time.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		since: z.string().describe("ISO 8601 datetime"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, since }) => safeExecute(async () => {
		const board = await db.board.findUnique({ where: { id: boardId as string } });
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const sinceDate = new Date(since as string);
		if (Number.isNaN(sinceDate.getTime())) {
			return err("Invalid date.", "Provide a valid ISO 8601 datetime string.");
		}

		const diff = await computeBoardDiff(boardId as string, sinceDate);
		return ok(diff);
	}),
});

// ─── Shared diff logic ─────────────────────────────────────────────

async function computeBoardDiff(boardId: string, since: Date) {
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

	const cardsMoved: Array<{ ref: string; title: string; from: string; to: string }> = [];
	const cardsCreated: Array<{ ref: string; title: string; column: string }> = [];
	const checklistProgress: Array<{ ref: string; title: string; completed: string }> = [];

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
