import type { CreateHandoffInput } from "@/lib/schemas/handoff-schemas";
import type { BoardDiff } from "@/lib/services/board-diff";
import { computeBoardDiff } from "@/lib/services/board-diff";
import type { ParsedHandoff } from "@/lib/services/handoff";
import {
	getLatestHandoff,
	listHandoffs as listHandoffsShared,
	parseHandoff,
	saveHandoff,
} from "@/lib/services/handoff";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

async function save(input: CreateHandoffInput): Promise<ServiceResult<ParsedHandoff>> {
	try {
		const note = await saveHandoff(db, input);
		return { success: true, data: parseHandoff(note) };
	} catch (error) {
		console.error("[HANDOFF_SERVICE] save error:", error);
		return { success: false, error: { code: "SAVE_FAILED", message: "Failed to save handoff." } };
	}
}

async function getLatest(boardId: string): Promise<ServiceResult<ParsedHandoff | null>> {
	try {
		const handoff = await getLatestHandoff(db, boardId);
		return { success: true, data: handoff ? parseHandoff(handoff) : null };
	} catch (error) {
		console.error("[HANDOFF_SERVICE] getLatest error:", error);
		return {
			success: false,
			error: { code: "FETCH_FAILED", message: "Failed to fetch latest handoff." },
		};
	}
}

async function list(boardId: string, limit = 10): Promise<ServiceResult<ParsedHandoff[]>> {
	try {
		const handoffs = await listHandoffsShared(db, boardId, limit);
		return { success: true, data: handoffs.map(parseHandoff) };
	} catch (error) {
		console.error("[HANDOFF_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to list handoffs." } };
	}
}

async function getBoardDiff(boardId: string, since: Date): Promise<ServiceResult<BoardDiff>> {
	try {
		const data = await computeBoardDiff(db, boardId, since);
		return { success: true, data };
	} catch (error) {
		console.error("[HANDOFF_SERVICE] getBoardDiff error:", error);
		return {
			success: false,
			error: { code: "DIFF_FAILED", message: "Failed to compute board diff." },
		};
	}
}

export const handoffService = {
	save,
	getLatest,
	list,
	getBoardDiff,
};
