import { z } from "zod";
import {
	setScratch,
	getScratch,
	listScratch,
	clearScratch,
	gcExpiredScratch,
} from "../../lib/services/scratch.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, ok, safeExecute } from "../utils.js";

// ─── Scratch (Ephemeral Agent Working Memory) ─────────────────────

registerExtendedTool("setScratch", {
	category: "scratch",
	description: "Store a key-value note (auto-expires in 7 days).",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		key: z.string().min(1).max(100).describe("Key name"),
		value: z.string().describe("Value to store"),
		ttlDays: z.number().int().min(1).max(90).default(7).describe("Days until expiry (default 7)"),
	}),
	annotations: { idempotentHint: true },
	handler: ({ boardId, key, value, ttlDays }) => safeExecute(async () => {
		const entry = await setScratch(db, {
			boardId: boardId as string,
			agentName: AGENT_NAME,
			key: key as string,
			value: value as string,
			ttlDays: ttlDays as number,
		});

		return ok({
			key: entry.key,
			value: entry.value,
			agentName: entry.agentName,
			expiresAt: entry.expiresAt,
			updatedAt: entry.updatedAt,
		});
	}),
});

registerExtendedTool("getScratch", {
	category: "scratch",
	description: "Read a scratchpad entry by key.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		key: z.string().describe("Key name"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, key }) => safeExecute(async () => {
		// GC expired entries before read
		await gcExpiredScratch(db);

		const entry = await getScratch(db, boardId as string, AGENT_NAME, key as string);

		if (!entry) {
			return ok({ key, value: null, found: false });
		}

		return ok({
			key: entry.key,
			value: entry.value,
			agentName: entry.agentName,
			expiresAt: entry.expiresAt,
			updatedAt: entry.updatedAt,
			found: true,
		});
	}),
});

registerExtendedTool("listScratch", {
	category: "scratch",
	description: "List all scratchpad entries for this agent.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId }) => safeExecute(async () => {
		const entries = await listScratch(db, boardId as string, AGENT_NAME);

		return ok({
			agentName: AGENT_NAME,
			count: entries.length,
			entries,
		});
	}),
});

registerExtendedTool("clearScratch", {
	category: "scratch",
	description: "Clear one or all scratchpad entries.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		key: z.string().optional().describe("Specific key to clear; omit to clear all"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ boardId, key }) => safeExecute(async () => {
		const result = await clearScratch(db, boardId as string, AGENT_NAME, key as string | undefined);

		if (key) {
			return ok({ cleared: result.count, key });
		}

		return ok({ cleared: result.count, agentName: AGENT_NAME, scope: "all" });
	}),
});
