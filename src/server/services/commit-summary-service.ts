import { getCommitSummary } from "@/lib/services/commit-summary";
import type { CommitSummary } from "@/lib/services/commit-summary";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

export type { CommitSummary };

async function getForCard(cardId: string): Promise<ServiceResult<CommitSummary>> {
	try {
		const data = await getCommitSummary(db, cardId);
		return { success: true, data };
	} catch (error) {
		console.error("[COMMIT_SUMMARY_SERVICE] getForCard error:", error);
		return { success: false, error: { code: "SUMMARY_FAILED", message: "Failed to compute commit summary." } };
	}
}

export const commitSummaryService = { getForCard };
