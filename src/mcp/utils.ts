import { db } from "./db.js";
import { toToon } from "./toon.js";

// Agent identity — set via AGENT_NAME env var in MCP config
export const AGENT_NAME = process.env.AGENT_NAME || "Agent";

// ─── Schema Version ────────────────────────────────────────────────

/**
 * Increment when schema changes require `db:push`.
 * Feature map tells agents what capabilities are available.
 */
export const SCHEMA_VERSION = 2;

export type FeatureAvailability = {
	version: number;
	relations: boolean;
	decisions: boolean;
	handoffs: boolean;
	scratchpad: boolean;
	gitLinks: boolean;
};

/**
 * Probe the database for new tables to detect which features are available.
 * This lets prompts gracefully handle old schemas without crashing.
 */
export async function detectFeatures(): Promise<FeatureAvailability> {
	const probe = async (fn: () => Promise<unknown>): Promise<boolean> => {
		try { await fn(); return true; } catch { return false; }
	};

	const [relations, decisions, handoffs, scratchpad, gitLinks] = await Promise.all([
		probe(() => db.cardRelation.count()),
		probe(() => db.decision.count()),
		probe(() => db.sessionHandoff.count()),
		probe(() => db.agentScratch.count()),
		probe(() => db.gitLink.count()),
	]);

	return { version: SCHEMA_VERSION, relations, decisions, handoffs, scratchpad, gitLinks };
}

// ─── Card Reference Resolution ─────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a card reference — accepts UUID or "#number" (e.g. "#7").
 * When projectId is provided, resolves numbers within that project (precise).
 * Without projectId, searches across all projects (may be ambiguous).
 */
export async function resolveCardId(ref: string, projectId?: string): Promise<string | null> {
	if (UUID_REGEX.test(ref)) return ref;

	const num = Number.parseInt(ref.replace(/^#/, ""), 10);
	if (Number.isNaN(num)) return null;

	if (projectId) {
		const card = await db.card.findUnique({
			where: { projectId_number: { projectId, number: num } },
			select: { id: true },
		});
		return card?.id ?? null;
	}

	const card = await db.card.findFirst({
		where: { number: num },
		select: { id: true },
	});
	return card?.id ?? null;
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

// ─── Response Formatting ────────────────────────────────────────────

type ToolContent = { type: "text"; text: string };
export type ToolResult = { content: ToolContent[]; isError?: boolean };

/** Format a successful tool response. Supports optional TOON encoding. Injects _meta.estimatedTokens. */
export function ok(data: unknown, format?: "json" | "toon"): ToolResult {
	const enriched = typeof data === "object" && data !== null && !Array.isArray(data)
		? { ...(data as Record<string, unknown>) }
		: data;
	const preText = format === "toon" ? toToon(enriched) : JSON.stringify(enriched, null, 2);
	const estimatedTokens = Math.ceil(preText.length / 4);
	const withMeta = typeof enriched === "object" && enriched !== null && !Array.isArray(enriched)
		? { ...(enriched as Record<string, unknown>), _meta: { estimatedTokens } }
		: enriched;
	const text = format === "toon" ? toToon(withMeta) : JSON.stringify(withMeta, null, 2);
	return { content: [{ type: "text" as const, text }] };
}

/** Format an error response with a recovery hint. */
export function err(message: string, hint?: string): ToolResult {
	const text = hint ? `${message} ${hint}` : message;
	return { content: [{ type: "text" as const, text }], isError: true };
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
			return err("A record with that unique value already exists.", "Check for duplicates and try a different value.");
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
