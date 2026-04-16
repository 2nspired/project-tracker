import { z } from "zod";
import { categorizeFile } from "../../lib/categorize-file.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { resolveCardRef, ok, err, safeExecute } from "../utils.js";

// ─── Tool ────────────────────────────────────────────────────────

registerExtendedTool("getCommitSummary", {
	category: "git",
	description:
		"Structured summary of all commits linked to a card: commit count, authors, time span, and files grouped by category (source, schema, styles, tests, config, docs, other).",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ cardId }) =>
		safeExecute(async () => {
			const resolved = await resolveCardRef(cardId as string);
			if (!resolved.ok) return err(resolved.message);
			const id = resolved.id;

			const links = await db.gitLink.findMany({
				where: { cardId: id },
				orderBy: { commitDate: "asc" },
			});

			if (links.length === 0) {
				return ok({
					cardId: id,
					commitCount: 0,
					authors: [],
					timeSpan: null,
					filesByCategory: {},
					totalFiles: 0,
					message: "No git links found for this card.",
				});
			}

			const authorSet = new Set<string>();
			for (const link of links) {
				if (link.author) authorSet.add(link.author);
			}

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

			for (const cat of Object.keys(filesByCategory)) {
				filesByCategory[cat].sort();
			}

			return ok({
				cardId: id,
				commitCount: links.length,
				authors: Array.from(authorSet).sort(),
				timeSpan: {
					first: links[0].commitDate,
					last: links[links.length - 1].commitDate,
				},
				filesByCategory,
				totalFiles: fileSet.size,
			});
		}),
});
