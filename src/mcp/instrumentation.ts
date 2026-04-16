import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { AGENT_NAME } from "./utils.js";
import type { ToolResult } from "./utils.js";

// ─── Session Identity ────────────────────────────────────────────────
// One UUID per MCP server process — matches the MCP session lifecycle.
export const SESSION_ID = randomUUID();

// ─── Fire-and-Forget Logger ──────────────────────────────────────────

interface LogEntry {
	toolName: string;
	toolType: "essential" | "extended";
	durationMs: number;
	success: boolean;
	errorMessage?: string;
}

function record(entry: LogEntry): void {
	db.toolCallLog
		.create({
			data: {
				toolName: entry.toolName,
				toolType: entry.toolType,
				agentName: AGENT_NAME,
				sessionId: SESSION_ID,
				durationMs: entry.durationMs,
				success: entry.success,
				errorMessage: entry.errorMessage ?? null,
			},
		})
		.catch((e) => console.error("[MCP] instrumentation write failed:", e));
}

// ─── Extended Tool Logger ────────────────────────────────────────────
// Called by tool-registry.ts after executing an extended tool handler.

export function logToolCall(
	toolName: string,
	durationMs: number,
	result: ToolResult,
): void {
	record({
		toolName,
		toolType: "extended",
		durationMs,
		success: result.isError !== true,
		errorMessage: result.isError
			? result.content[0]?.text?.slice(0, 500)
			: undefined,
	});
}

// ─── Essential Tool Wrapper ──────────────────────────────────────────
// Wraps essential tool handlers registered directly on McpServer.

// biome-ignore lint/suspicious/noExplicitAny: handler wrapper must preserve MCP SDK's generic handler types
export function wrapEssentialHandler<F extends (...args: any[]) => Promise<any>>(
	toolName: string,
	handler: F,
): F {
	const wrapped = (async (...args: unknown[]) => {
		const start = Date.now();
		try {
			const result = await handler(...args);
			record({
				toolName,
				toolType: "essential",
				durationMs: Date.now() - start,
				success: result.isError !== true,
				errorMessage: result.isError
					? result.content[0]?.text?.slice(0, 500)
					: undefined,
			});
			return result;
		} catch (error) {
			record({
				toolName,
				toolType: "essential",
				durationMs: Date.now() - start,
				success: false,
				errorMessage: error instanceof Error
					? error.message.slice(0, 500)
					: String(error).slice(0, 500),
			});
			throw error;
		}
	}) as F;
	return wrapped;
}
