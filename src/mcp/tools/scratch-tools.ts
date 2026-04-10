import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, ok, err, safeExecute } from "../utils.js";

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
		const expiresAt = new Date(Date.now() + (ttlDays as number) * 24 * 60 * 60 * 1000);

		const entry = await db.agentScratch.upsert({
			where: {
				boardId_agentName_key: {
					boardId: boardId as string,
					agentName: AGENT_NAME,
					key: key as string,
				},
			},
			update: {
				value: value as string,
				expiresAt,
			},
			create: {
				boardId: boardId as string,
				agentName: AGENT_NAME,
				key: key as string,
				value: value as string,
				expiresAt,
			},
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
		await db.agentScratch.deleteMany({ where: { expiresAt: { lt: new Date() } } });

		const entry = await db.agentScratch.findUnique({
			where: {
				boardId_agentName_key: {
					boardId: boardId as string,
					agentName: AGENT_NAME,
					key: key as string,
				},
			},
		});

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
		// GC expired entries before read
		await db.agentScratch.deleteMany({ where: { expiresAt: { lt: new Date() } } });

		const entries = await db.agentScratch.findMany({
			where: {
				boardId: boardId as string,
				agentName: AGENT_NAME,
			},
			orderBy: { updatedAt: "desc" },
			select: { key: true, value: true, expiresAt: true, updatedAt: true },
		});

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
		if (key) {
			const existing = await db.agentScratch.findUnique({
				where: {
					boardId_agentName_key: {
						boardId: boardId as string,
						agentName: AGENT_NAME,
						key: key as string,
					},
				},
			});

			if (!existing) {
				return ok({ cleared: 0, key, message: "Entry not found." });
			}

			await db.agentScratch.delete({ where: { id: existing.id } });
			return ok({ cleared: 1, key });
		}

		const result = await db.agentScratch.deleteMany({
			where: {
				boardId: boardId as string,
				agentName: AGENT_NAME,
			},
		});

		return ok({ cleared: result.count, agentName: AGENT_NAME, scope: "all" });
	}),
});
