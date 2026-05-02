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
import { createTokenUsageService } from "@/lib/services/token-usage";
import { db } from "../db.js";
import { SESSION_ID } from "../instrumentation.js";
import { registerExtendedTool } from "../tool-registry.js";
import {
	AGENT_NAME,
	err,
	getProjectIdForBoard,
	ok,
	resolveCardRef,
	safeExecute,
} from "../utils.js";

// Bind the shared factory to the MCP-process Prisma client. Constructed
// once at module load (singleton) — same shape as the web shim, but
// scoped to the MCP db so cross-process callers don't share the
// Next.js-FTS-extended instance.
const tokenUsageService = createTokenUsageService(db);

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

registerExtendedTool("attributeSession", {
	category: "session",
	description:
		"Attribute all TokenUsageEvent rows for a session to a specific card. Call automatically from briefMe when an active card is known, or from saveHandoff when the session was card-focused. Safe to call multiple times — last write wins. Returns the count of updated rows.",
	parameters: z.object({
		sessionId: z.string().optional().describe("Session UUID (defaults to current MCP SESSION_ID)"),
		cardId: z.string().uuid().optional().describe("Card UUID"),
		boardId: z.string().uuid().optional().describe("Board UUID — used to resolve #N refs"),
		cardRef: z
			.string()
			.optional()
			.describe("Card ref like '#7' — resolved within boardId's project"),
	}),
	handler: async (params) => {
		const p = params as {
			sessionId?: string;
			cardId?: string;
			boardId?: string;
			cardRef?: string;
		};
		return safeExecute(async () => {
			const sessionId = p.sessionId ?? SESSION_ID;

			let cardId: string | undefined = p.cardId;
			if (!cardId && p.cardRef) {
				const projectId = p.boardId ? await getProjectIdForBoard(p.boardId) : undefined;
				const resolved = await resolveCardRef(p.cardRef, projectId);
				if (!resolved.ok) {
					return err(resolved.message);
				}
				cardId = resolved.id;
			}
			if (!cardId) {
				return err("cardId or cardRef is required.");
			}

			const result = await tokenUsageService.attributeSession(sessionId, cardId);
			if (!result.success) {
				return err(`${result.error.code}: ${result.error.message}`);
			}
			return ok({ attributed: true, updated: result.data.updated, sessionId, cardId });
		});
	},
});

registerExtendedTool("recordTokenUsageFromTranscript", {
	category: "session",
	description:
		"Stream a Claude Code session transcript JSONL (plus any sibling sub-agent transcripts) and record per-model token usage. Idempotent on sessionId — re-running replaces rows. Designed for the Claude Code Stop hook (type: 'mcp_tool'); accepts the hook's transcript_path / session_id / cwd substitution variables. Returns soft warnings (NO_USAGE_FOUND, PROJECT_NOT_FOUND, TRANSCRIPT_NOT_FOUND) instead of erroring so the hook never blocks.",
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
