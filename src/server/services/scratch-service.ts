import type { SetScratchInput } from "@/lib/schemas/scratch-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type ScratchEntry = {
	id: string;
	boardId: string;
	agentName: string;
	key: string;
	value: string;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

type ScratchListItem = {
	key: string;
	value: string;
	expiresAt: Date | null;
	updatedAt: Date;
};

async function set(input: SetScratchInput): Promise<ServiceResult<ScratchEntry>> {
	try {
		const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);

		const entry = await db.agentScratch.upsert({
			where: {
				boardId_agentName_key: {
					boardId: input.boardId,
					agentName: input.agentName,
					key: input.key,
				},
			},
			update: {
				value: input.value,
				expiresAt,
			},
			create: {
				boardId: input.boardId,
				agentName: input.agentName,
				key: input.key,
				value: input.value,
				expiresAt,
			},
		});

		return { success: true, data: entry };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] set error:", error);
		return { success: false, error: { code: "SET_FAILED", message: "Failed to set scratch entry." } };
	}
}

async function get(boardId: string, agentName: string, key: string): Promise<ServiceResult<ScratchEntry | null>> {
	try {
		const entry = await db.agentScratch.findUnique({
			where: {
				boardId_agentName_key: { boardId, agentName, key },
			},
		});

		if (!entry) {
			return { success: true, data: null };
		}

		// If expired, delete and return null
		if (entry.expiresAt && entry.expiresAt < new Date()) {
			await db.agentScratch.delete({
				where: { id: entry.id },
			});
			return { success: true, data: null };
		}

		return { success: true, data: entry };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] get error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to get scratch entry." } };
	}
}

async function list(boardId: string, agentName: string): Promise<ServiceResult<ScratchListItem[]>> {
	try {
		// Delete any expired entries first
		await db.agentScratch.deleteMany({
			where: {
				boardId,
				agentName,
				expiresAt: { lt: new Date() },
			},
		});

		const entries = await db.agentScratch.findMany({
			where: { boardId, agentName },
			orderBy: { updatedAt: "desc" },
			select: { key: true, value: true, expiresAt: true, updatedAt: true },
		});

		return { success: true, data: entries };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to list scratch entries." } };
	}
}

async function clear(boardId: string, agentName: string, key?: string): Promise<ServiceResult<{ count: number }>> {
	try {
		if (key) {
			const existing = await db.agentScratch.findUnique({
				where: { boardId_agentName_key: { boardId, agentName, key } },
			});
			if (!existing) {
				return { success: true, data: { count: 0 } };
			}
			await db.agentScratch.delete({ where: { id: existing.id } });
			return { success: true, data: { count: 1 } };
		}

		const result = await db.agentScratch.deleteMany({
			where: { boardId, agentName },
		});

		return { success: true, data: { count: result.count } };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] clear error:", error);
		return { success: false, error: { code: "CLEAR_FAILED", message: "Failed to clear scratch entries." } };
	}
}

async function gc(): Promise<ServiceResult<{ count: number }>> {
	try {
		const result = await db.agentScratch.deleteMany({
			where: { expiresAt: { lt: new Date() } },
		});

		return { success: true, data: { count: result.count } };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] gc error:", error);
		return { success: false, error: { code: "GC_FAILED", message: "Failed to garbage collect scratch entries." } };
	}
}

export const scratchService = {
	set,
	get,
	list,
	clear,
	gc,
};
