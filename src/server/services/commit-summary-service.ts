import { categorizeFile } from "@/lib/categorize-file";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

// ─── Types ───────────────────────────────────────────────────────

export type CommitSummary = {
	cardId: string;
	commitCount: number;
	authors: string[];
	timeSpan: { first: Date; last: Date } | null;
	filesByCategory: Record<string, string[]>;
	totalFiles: number;
};

// ─── Service ─────────────────────────────────────────────────────

async function getForCard(cardId: string): Promise<ServiceResult<CommitSummary>> {
	try {
		const links = await db.gitLink.findMany({
			where: { cardId },
			orderBy: { commitDate: "asc" },
		});

		if (links.length === 0) {
			return {
				success: true,
				data: {
					cardId,
					commitCount: 0,
					authors: [],
					timeSpan: null,
					filesByCategory: {},
					totalFiles: 0,
				},
			};
		}

		// Unique authors
		const authorSet = new Set<string>();
		for (const link of links) {
			if (link.author) authorSet.add(link.author);
		}

		// Aggregate files by category
		const fileSet = new Set<string>();
		for (const link of links) {
			const paths = JSON.parse(link.filePaths) as string[];
			for (const p of paths) fileSet.add(p);
		}

		const filesByCategory: Record<string, string[]> = {};
		for (const file of fileSet) {
			const cat = categorizeFile(file);
			if (!filesByCategory[cat]) filesByCategory[cat] = [];
			filesByCategory[cat].push(file);
		}

		// Sort files within each category
		for (const cat of Object.keys(filesByCategory)) {
			filesByCategory[cat].sort();
		}

		return {
			success: true,
			data: {
				cardId,
				commitCount: links.length,
				authors: Array.from(authorSet).sort(),
				timeSpan: {
					first: links[0].commitDate,
					last: links[links.length - 1].commitDate,
				},
				filesByCategory,
				totalFiles: fileSet.size,
			},
		};
	} catch (error) {
		console.error("[COMMIT_SUMMARY_SERVICE] getForCard error:", error);
		return { success: false, error: { code: "SUMMARY_FAILED", message: "Failed to compute commit summary." } };
	}
}

export const commitSummaryService = { getForCard };
