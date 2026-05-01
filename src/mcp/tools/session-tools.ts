import { z } from "zod";
import { computeBoardDiff } from "../../lib/services/board-diff.js";
import {
	getLatestHandoff,
	listHandoffs as listHandoffsShared,
	parseHandoff,
} from "../../lib/services/handoff.js";
import { db } from "../db.js";
import { checkStaleness, formatStalenessWarnings } from "../staleness.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

// ─── Session ───────────────────────────────────────────────────────
// `saveHandoff` is registered as an essential tool in `src/mcp/server.ts`
// (it absorbed the old extended `saveHandoff` primitive — pass `syncGit: false`
// for a mid-session checkpoint).

registerExtendedTool("loadHandoff", {
	category: "session",
	description:
		"Load latest handoff and changes since then. Prefer the essential `briefMe` tool for session-start — it includes this plus top work, blockers, and pulse.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId }) =>
		safeExecute(async () => {
			const board = await db.board.findUnique({
				where: { id: boardId as string },
				select: { id: true, projectId: true },
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

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
				_hint:
					"For named recipes (sessionStart, sessionEnd, recordDecision, searchKnowledge), call `listWorkflows({ boardId })`. For tool reference, use `getTools` / `getTools({ tool })`.",
			});
		}),
});

registerExtendedTool("listHandoffs", {
	category: "session",
	description:
		"List recent handoff summaries for a board. Shows the trajectory of work across sessions.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		limit: z
			.number()
			.int()
			.min(1)
			.max(20)
			.default(5)
			.describe("Number of recent handoffs to return"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, limit }) =>
		safeExecute(async () => {
			const board = await db.board.findUnique({ where: { id: boardId as string } });
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const rawHandoffs = await listHandoffsShared(db, boardId as string, (limit as number) ?? 5);

			if (rawHandoffs.length === 0) {
				return ok({ handoffs: [], message: "No handoffs found for this board." });
			}

			return ok({
				handoffs: rawHandoffs.map((h) => {
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
