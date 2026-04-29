import type { ParsedBriefSnapshot } from "@/lib/services/brief-snapshot";
import {
	listBriefSnapshots as listBriefSnapshotsShared,
	parseBriefSnapshot,
} from "@/lib/services/brief-snapshot";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

async function list(boardId: string, limit = 20): Promise<ServiceResult<ParsedBriefSnapshot[]>> {
	try {
		const notes = await listBriefSnapshotsShared(db, boardId, limit);
		return { success: true, data: notes.map(parseBriefSnapshot) };
	} catch (error) {
		console.error("[BRIEF_SNAPSHOT_SERVICE] list error:", error);
		return {
			success: false,
			error: { code: "LIST_FAILED", message: "Failed to list brief snapshots." },
		};
	}
}

export const briefSnapshotService = {
	list,
};
