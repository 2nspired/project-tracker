import type { SetScratchInput } from "@/lib/schemas/scratch-schemas";
import {
	setScratch,
	getScratch,
	listScratch,
	clearScratch,
	gcExpiredScratch,
} from "@/lib/services/scratch";
import type { ScratchEntry, ScratchListItem } from "@/lib/services/scratch";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

async function set(input: SetScratchInput): Promise<ServiceResult<ScratchEntry>> {
	try {
		const entry = await setScratch(db, input);
		return { success: true, data: entry };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] set error:", error);
		return { success: false, error: { code: "SET_FAILED", message: "Failed to set scratch entry." } };
	}
}

async function get(boardId: string, agentName: string, key: string): Promise<ServiceResult<ScratchEntry | null>> {
	try {
		const entry = await getScratch(db, boardId, agentName, key);
		return { success: true, data: entry };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] get error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to get scratch entry." } };
	}
}

async function list(boardId: string, agentName: string): Promise<ServiceResult<ScratchListItem[]>> {
	try {
		const entries = await listScratch(db, boardId, agentName);
		return { success: true, data: entries };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to list scratch entries." } };
	}
}

async function clear(boardId: string, agentName: string, key?: string): Promise<ServiceResult<{ count: number }>> {
	try {
		const result = await clearScratch(db, boardId, agentName, key);
		return { success: true, data: result };
	} catch (error) {
		console.error("[SCRATCH_SERVICE] clear error:", error);
		return { success: false, error: { code: "CLEAR_FAILED", message: "Failed to clear scratch entries." } };
	}
}

async function gc(): Promise<ServiceResult<{ count: number }>> {
	try {
		const result = await gcExpiredScratch(db);
		return { success: true, data: result };
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
