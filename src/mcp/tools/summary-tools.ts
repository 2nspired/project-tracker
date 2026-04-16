import { z } from "zod";
import { getCommitSummary } from "../../lib/services/commit-summary.js";
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

			const summary = await getCommitSummary(db, resolved.id);

			if (summary.commitCount === 0) {
				return ok({ ...summary, message: "No git links found for this card." });
			}

			return ok(summary);
		}),
});
