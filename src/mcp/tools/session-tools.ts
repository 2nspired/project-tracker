import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, ok, err, safeExecute } from "../utils.js";
import { computeBoardDiff } from "../services/board-diff.js";

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

// loadHandoff has been promoted to an essential tool in server.ts (enriched with scoring, attention, pulse)

registerExtendedTool("listHandoffs", {
	category: "session",
	description: "List recent handoff summaries for a board. Shows the trajectory of work across sessions.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		limit: z.number().int().min(1).max(20).default(5).describe("Number of recent handoffs to return"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, limit }) => safeExecute(async () => {
		const board = await db.board.findUnique({ where: { id: boardId as string } });
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const handoffs = await db.sessionHandoff.findMany({
			where: { boardId: boardId as string },
			orderBy: { createdAt: "desc" },
			take: (limit as number) ?? 5,
		});

		if (handoffs.length === 0) {
			return ok({ handoffs: [], message: "No handoffs found for this board." });
		}

		return ok({
			handoffs: handoffs.map(h => ({
				id: h.id,
				agentName: h.agentName,
				summary: h.summary,
				workingOn: JSON.parse(h.workingOn),
				findings: JSON.parse(h.findings),
				nextSteps: JSON.parse(h.nextSteps),
				blockers: JSON.parse(h.blockers),
				createdAt: h.createdAt,
			})),
			total: handoffs.length,
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

// computeBoardDiff is now in ../services/board-diff.ts (shared with essential loadHandoff)
