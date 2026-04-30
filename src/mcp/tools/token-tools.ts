// Token tracking MCP tools (#96).
//
// `recordTokenUsage` is the manual / generic-agent path — agents that don't
// have a transcript file (Codex, custom agents) call this directly with
// counts they pull from their own provider.
//
// `recordTokenUsageFromTranscript` is the Claude Code Stop-hook path —
// configured in `~/.claude-alt/.claude.json` as a `type: "mcp_tool"` hook.
// Reads the JSONL transcript (and any sibling sub-agent transcripts) and
// upserts token usage rows. Idempotent on `sessionId` so re-running the hook
// against the same transcript doesn't duplicate.

import { z } from "zod";
import { resolveProjectIdFromCwd } from "@/lib/services/resolve-project";
import { tokenUsageService } from "@/server/services/token-usage-service";
import { db } from "../db.js";
import { SESSION_ID } from "../instrumentation.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, ok, safeExecute } from "../utils.js";

registerExtendedTool("recordTokenUsage", {
	category: "session",
	description:
		"Record token usage for the current MCP session. Use when the agent's transcript isn't accessible (Codex, custom agents) — Claude Code uses recordTokenUsageFromTranscript via Stop hook instead. Always additive: each call creates one new row, so callers shouldn't loop and should sum their counts before calling.",
	parameters: z.object({
		projectId: z.string().uuid().optional().describe("Project UUID (omit if boardId is set)"),
		boardId: z
			.string()
			.uuid()
			.optional()
			.describe("Board UUID (resolves to projectId — convenience for board-scoped agents)"),
		sessionId: z
			.string()
			.optional()
			.describe("Session identifier (defaults to MCP server SESSION_ID)"),
		cardId: z.string().uuid().optional().describe("Optional card UUID for card-level attribution"),
		agentName: z.string().optional().describe("Agent identifier (defaults to AGENT_NAME)"),
		model: z.string().min(1).describe("Model identifier — must match a key in pricing settings"),
		inputTokens: z.number().int().min(0).describe("Input tokens consumed"),
		outputTokens: z.number().int().min(0).describe("Output tokens generated"),
		cacheReadTokens: z.number().int().min(0).optional().describe("Cache read tokens (default 0)"),
		cacheCreation1hTokens: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("1-hour cache creation tokens (Anthropic; default 0)"),
		cacheCreation5mTokens: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("5-minute cache creation tokens (Anthropic; default 0)"),
	}),
	handler: async (params) => {
		const p = params as {
			projectId?: string;
			boardId?: string;
			sessionId?: string;
			cardId?: string;
			agentName?: string;
			model: string;
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens?: number;
			cacheCreation1hTokens?: number;
			cacheCreation5mTokens?: number;
		};
		return safeExecute(async () => {
			let projectId = p.projectId;
			if (!projectId && p.boardId) {
				const board = await db.board.findUnique({
					where: { id: p.boardId },
					select: { projectId: true },
				});
				if (board) projectId = board.projectId;
			}
			if (!projectId) {
				return ok({
					recorded: false,
					warning: "PROJECT_NOT_RESOLVED",
					detail: "Pass projectId or a boardId that resolves to a project.",
				});
			}

			const result = await tokenUsageService.recordManual({
				projectId,
				sessionId: p.sessionId ?? SESSION_ID,
				cardId: p.cardId ?? null,
				agentName: p.agentName ?? AGENT_NAME,
				model: p.model,
				inputTokens: p.inputTokens,
				outputTokens: p.outputTokens,
				cacheReadTokens: p.cacheReadTokens,
				cacheCreation1hTokens: p.cacheCreation1hTokens,
				cacheCreation5mTokens: p.cacheCreation5mTokens,
			});
			if (!result.success) {
				// Surface as a soft warning — token tracking should never block.
				return ok({ recorded: false, warning: result.error.code, detail: result.error.message });
			}
			return ok({ recorded: true, created: result.data.created });
		});
	},
});

registerExtendedTool("recordTokenUsageFromTranscript", {
	category: "session",
	description:
		"Stream a Claude Code session transcript JSONL (plus any sibling sub-agent transcripts) and record per-model token usage. Idempotent on sessionId — re-running replaces rows. Designed for the Claude Code Stop hook (type: 'mcp_tool') with ${transcript_path}, ${session_id}, ${cwd} substitution. Returns soft warnings (NO_USAGE_FOUND, PROJECT_NOT_FOUND, TRANSCRIPT_NOT_FOUND) instead of erroring so the hook never blocks.",
	parameters: z.object({
		transcriptPath: z.string().describe("Absolute path to the session JSONL transcript"),
		sessionId: z
			.string()
			.describe("Claude Code session UUID (distinct from the MCP server's SESSION_ID)"),
		cwd: z
			.string()
			.describe("Working directory the session ran in — resolved to a registered project"),
		cardId: z.string().uuid().optional().describe("Optional card UUID for card-level attribution"),
	}),
	handler: async (params) => {
		const p = params as {
			transcriptPath: string;
			sessionId: string;
			cwd: string;
			cardId?: string;
		};
		return safeExecute(async () => {
			const projectId = await resolveProjectIdFromCwd(p.cwd, db);
			if (!projectId) {
				return ok({
					created: 0,
					subAgentFiles: 0,
					warnings: [{ code: "PROJECT_NOT_FOUND", detail: p.cwd }],
				});
			}

			const result = await tokenUsageService.recordFromTranscript({
				projectId,
				sessionId: p.sessionId,
				transcriptPath: p.transcriptPath,
				cardId: p.cardId ?? null,
				agentName: "claude-code",
			});
			if (!result.success) {
				return ok({
					created: 0,
					subAgentFiles: 0,
					warnings: [{ code: result.error.code, detail: result.error.message }],
				});
			}
			return ok(result.data);
		});
	},
});
