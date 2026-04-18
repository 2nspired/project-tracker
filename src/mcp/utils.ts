import { db } from "./db.js";
import { toToon } from "./toon.js";

// Agent identity — resolution order:
//   1. AGENT_NAME env var (explicit override, set via MCP config)
//   2. MCP client name from initialize handshake (server.ts wires this)
//   3. Literal "Agent" (final fallback — means neither source populated)
// This is a live `let` so ES-module importers see updates after the client
// handshake completes. Zod .default() call sites must use a thunk to avoid
// snapshotting the pre-handshake value.
export let AGENT_NAME = process.env.AGENT_NAME || "Agent";

type AgentNameSource = "env" | "client" | "default";
const envProvided = Boolean(process.env.AGENT_NAME);
let resolvedSource: AgentNameSource = envProvided ? "env" : "default";

/**
 * Called once after the MCP initialize handshake. Updates AGENT_NAME from
 * the client's declared name unless an AGENT_NAME env var was already set.
 */
export function resolveAgentNameFromClient(clientName: string | undefined): void {
	if (envProvided) return;
	if (clientName && clientName.trim()) {
		AGENT_NAME = clientName.trim();
		resolvedSource = "client";
	}
}

export function getAgentNameSource(): AgentNameSource {
	return resolvedSource;
}

// ─── Schema Version ────────────────────────────────────────────────

/**
 * Increment when schema changes require `db:push`.
 * Feature map tells agents what capabilities are available.
 */
export const SCHEMA_VERSION = 8;

export type FeatureAvailability = {
	version: number;
	relations: boolean;
	decisions: boolean;
	handoffs: boolean;
	gitLinks: boolean;
};

/**
 * Probe the database for new tables to detect which features are available.
 * This lets prompts gracefully handle old schemas without crashing.
 */
export async function detectFeatures(): Promise<FeatureAvailability> {
	const probe = async (fn: () => Promise<unknown>): Promise<boolean> => {
		try {
			await fn();
			return true;
		} catch {
			return false;
		}
	};

	const [relations, decisions, handoffs, gitLinks] = await Promise.all([
		probe(() => db.cardRelation.count()),
		probe(() => db.claim.count({ where: { kind: "decision" } })),
		probe(() => db.note.count({ where: { kind: "handoff" } })),
		probe(() => db.gitLink.count()),
	]);

	return { version: SCHEMA_VERSION, relations, decisions, handoffs, gitLinks };
}

// ─── Card Reference Resolution ─────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveResult =
	| { ok: true; id: string; warning?: string }
	| { ok: false; error: "not_found" | "ambiguous"; message: string };

/**
 * Resolve a card reference — accepts UUID or "#number" (e.g. "#7").
 * When projectId is provided, resolves numbers within that project (precise).
 * Without projectId, detects ambiguity across projects and fails safely.
 */
export async function resolveCardRef(ref: string, projectId?: string): Promise<ResolveResult> {
	if (UUID_REGEX.test(ref)) return { ok: true, id: ref };

	const num = Number.parseInt(ref.replace(/^#/, ""), 10);
	if (Number.isNaN(num))
		return {
			ok: false,
			error: "not_found",
			message: `"${ref}" is not a valid card reference. Use a UUID or #number.`,
		};

	if (projectId) {
		const card = await db.card.findUnique({
			where: { projectId_number: { projectId, number: num } },
			select: { id: true },
		});
		return card
			? { ok: true, id: card.id }
			: { ok: false, error: "not_found", message: `Card #${num} not found in this project.` };
	}

	// No project scope — check for ambiguity
	const matches = await db.card.findMany({
		where: { number: num },
		select: { id: true, project: { select: { name: true } } },
		take: 5,
	});

	if (matches.length === 0) {
		return { ok: false, error: "not_found", message: `Card #${num} not found.` };
	}
	if (matches.length === 1) {
		return {
			ok: true,
			id: matches[0].id,
			warning: `#${num} resolved from project "${matches[0].project.name}" without project scope — pass boardId to avoid cross-project misresolution, or use the card UUID.`,
		};
	}

	const projects = matches.map((m) => `"${m.project.name}"`).join(", ");
	return {
		ok: false,
		error: "ambiguous",
		message: `Card #${num} exists in multiple projects (${projects}). Use the card UUID instead, or call getBoard first to scope to a project.`,
	};
}

/**
 * Convenience wrapper — returns just the ID or null.
 * For call sites that need the full error, use resolveCardRef directly.
 */
export async function resolveCardId(ref: string, projectId?: string): Promise<string | null> {
	const result = await resolveCardRef(ref, projectId);
	return result.ok ? result.id : null;
}

/**
 * Resolve a milestone by name within a project. Creates it if it doesn't exist.
 */
export async function resolveOrCreateMilestone(projectId: string, name: string): Promise<string> {
	const existing = await db.milestone.findUnique({
		where: { projectId_name: { projectId, name } },
	});
	if (existing) return existing.id;

	const maxPos = await db.milestone.aggregate({
		where: { projectId },
		_max: { position: true },
	});
	const ms = await db.milestone.create({
		data: { projectId, name, position: (maxPos._max.position ?? -1) + 1 },
	});
	return ms.id;
}

/**
 * Look up the projectId for a board. Used to scope #number resolution.
 */
export async function getProjectIdForBoard(boardId: string): Promise<string | undefined> {
	const board = await db.board.findUnique({ where: { id: boardId }, select: { projectId: true } });
	return board?.projectId;
}

// ─── Response Formatting ────────────────────────────────────────────

type ToolContent = { type: "text"; text: string };
export type ToolResult = { content: ToolContent[]; isError?: boolean };

/** Format a successful tool response. Supports optional TOON encoding. Injects _meta.estimatedTokens. */
export function ok(data: unknown, format?: "json" | "toon"): ToolResult {
	// Estimate tokens from a quick pre-pass (cheap string length, no double-encode)
	const roughLen = JSON.stringify(data)?.length ?? 0;
	const estimatedTokens = Math.ceil(roughLen / 4);

	// Inject _meta into objects
	const output =
		typeof data === "object" && data !== null && !Array.isArray(data)
			? { ...(data as Record<string, unknown>), _meta: { estimatedTokens } }
			: data;

	const text = format === "toon" ? toToon(output) : JSON.stringify(output, null, 2);
	return { content: [{ type: "text" as const, text }] };
}

/** Format an error response with a recovery hint. */
export function err(message: string, hint?: string): ToolResult {
	const text = hint ? `${message} ${hint}` : message;
	return { content: [{ type: "text" as const, text }], isError: true };
}

/** Format an error with a runnable tool hint so the agent can fix the issue immediately. */
export function errWithToolHint(
	message: string,
	toolName: string,
	exampleParams: Record<string, string>
): ToolResult {
	const paramStr = Object.entries(exampleParams)
		.map(([k, v]) => `${k}: ${v}`)
		.join(", ");
	return err(message, `Fix: runTool({ tool: "${toolName}", params: { ${paramStr} } })`);
}

// ─── Safe Execution Wrapper ─────────────────────────────────────────

/**
 * Wraps a tool handler with try/catch for Prisma and runtime errors.
 * Returns a formatted error instead of propagating raw exceptions.
 */
export async function safeExecute(fn: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await fn();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[MCP] Tool execution error:", message);

		if (message.includes("Unique constraint")) {
			return err(
				"A record with that unique value already exists.",
				"Check for duplicates and try a different value."
			);
		}
		if (message.includes("Foreign key constraint")) {
			return err("Referenced record not found.", "Verify the ID you provided exists.");
		}
		if (message.includes("SQLITE_BUSY") || message.includes("database is locked")) {
			return err("Database is temporarily busy.", "Wait a moment and retry.");
		}

		return err(`Operation failed: ${message}`);
	}
}
