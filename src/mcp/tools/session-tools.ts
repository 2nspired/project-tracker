import { z } from "zod";
import { computeBoardDiff } from "../../lib/services/board-diff.js";
import {
	saveHandoff,
	getLatestHandoff,
	listHandoffs as listHandoffsShared,
	parseHandoff,
} from "../../lib/services/handoff.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { checkStaleness, formatStalenessWarnings } from "../staleness.js";
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

		const handoff = await saveHandoff(db, {
			boardId: boardId as string,
			agentName: AGENT_NAME,
			workingOn: (workingOn as string[]) ?? [],
			findings: (findings as string[]) ?? [],
			nextSteps: (nextSteps as string[]) ?? [],
			blockers: (blockers as string[]) ?? [],
			summary: (summary as string) ?? "",
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
		const board = await db.board.findUnique({
			where: { id: boardId as string },
			select: { id: true, projectId: true },
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		// Get latest handoff
		const raw = await getLatestHandoff(db, boardId as string);

		if (!raw) {
			return ok({ handoff: null, diff: null, message: "No previous handoff found." });
		}

		const parsed = parseHandoff(raw);

		// Compute board diff since handoff
		const diff = await computeBoardDiff(db, boardId as string, raw.createdAt);

		// Check for stale context entries
		const warnings = await checkStaleness(board.projectId);
		const stalenessWarnings = formatStalenessWarnings(warnings);

		return ok({
			handoff: {
				id: parsed.id,
				agentName: parsed.agentName,
				workingOn: parsed.workingOn,
				findings: parsed.findings,
				nextSteps: parsed.nextSteps,
				blockers: parsed.blockers,
				summary: parsed.summary,
				createdAt: parsed.createdAt,
			},
			diff,
			stalenessWarnings,
			capabilities: {
				_hint: "These agent-workflow tools are available via runTool(). Use getTools({ tool: 'name' }) for full schema.",
				memory: [
					"saveHandoff / loadHandoff — session continuity",
					"listHandoffs — view handoff history across sessions",
				],
				facts: [
					"saveFact / listFacts / getFact / deleteFact — unified persistent knowledge (type: context | code | measurement)",
				],
				notes: [
					"createNote / updateNote / deleteNote / listNotes — persistent project-level notes",
				],
				scratch: [
					"setScratch / getScratch / listScratch / clearScratch — temporary key-value storage with optional expiry",
				],
				analysis: [
					"getFocusContext — scoped context bundle (by card, milestone, or tag)",
					"getBlockers — list blocked cards and what blocks them",
					"queryKnowledge — full-text search across all project knowledge",
				],
				decisions: [
					"recordDecision / getDecisions — track architectural decisions tied to cards",
				],
			},
		});
	}),
});

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

		const rawHandoffs = await listHandoffsShared(db, boardId as string, (limit as number) ?? 5);

		if (rawHandoffs.length === 0) {
			return ok({ handoffs: [], message: "No handoffs found for this board." });
		}

		return ok({
			handoffs: rawHandoffs.map(h => {
				const parsed = parseHandoff(h);
				return {
					id: parsed.id,
					agentName: parsed.agentName,
					summary: parsed.summary,
					workingOn: parsed.workingOn,
					findings: parsed.findings,
					nextSteps: parsed.nextSteps,
					blockers: parsed.blockers,
					createdAt: parsed.createdAt,
				};
			}),
			total: rawHandoffs.length,
		});
	}),
});


