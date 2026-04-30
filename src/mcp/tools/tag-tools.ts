// v4.2 tag tools — list/create/rename/merge. Pairs with the dual-track
// MCP write paths in server.ts and extended-tools.ts: agents that want to
// stay strict (no auto-create) call createTag here, then pass the slug to
// createCard/updateCard via `tagSlugs`.

import { z } from "zod";
import { createTagService } from "@/server/services/tag-service";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

const tagService = createTagService(db);

registerExtendedTool("listTags", {
	category: "tags",
	description:
		"List tags in a project with usage counts and governance hints. Backs the autocomplete combobox and agent-side discovery for tagSlugs.\n\nOptional `state` filter ('active' | 'archived') defaults to 'active' when omitted.\n\nEach row may include `_governanceHints` when something deserves the agent's attention:\n- `singleton: true` — the tag is referenced by exactly one card; consider whether the vocabulary is premature.\n- `possibleMerge: [{ id, label, distance }]` — peers within Levenshtein distance ≤ 2 of this tag's slug; collapse near-duplicates with `mergeTags`.\nAbsent fields mean no signal — agents should not treat missing hints as an empty array.",
	parameters: z.object({
		projectId: z.string().uuid().describe("Project UUID"),
		state: z
			.enum(["active", "archived"])
			.optional()
			.describe("Filter by tag state. Defaults to 'active' when omitted."),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, state }) =>
		safeExecute(async () => {
			const result = await tagService.listByProject(projectId as string, {
				state: state as "active" | "archived" | undefined,
			});
			if (!result.success) return err(result.error.message);
			return ok({
				tags: result.data.map((t) => ({
					id: t.id,
					slug: t.slug,
					label: t.label,
					state: t.state,
					usageCount: t._count.cardTags,
					...(t._governanceHints && { _governanceHints: t._governanceHints }),
				})),
			});
		}),
});

registerExtendedTool("createTag", {
	category: "tags",
	description:
		"Explicitly create a tag in a project. Slug is derived from the label via slugify (lowercase, kebab-case). Idempotent — returns the existing tag if a row with the same slug already exists.",
	parameters: z.object({
		projectId: z.string().uuid().describe("Project UUID"),
		label: z
			.string()
			.min(1)
			.max(50)
			.describe("Display label — slugified for the canonical identifier"),
	}),
	handler: ({ projectId, label }) =>
		safeExecute(async () => {
			const result = await tagService.create({
				projectId: projectId as string,
				label: label as string,
			});
			if (!result.success) return err(result.error.message);
			return ok({
				id: result.data.id,
				slug: result.data.slug,
				label: result.data.label,
			});
		}),
});

registerExtendedTool("renameTag", {
	category: "tags",
	description:
		"Update a tag's display label. Slug is immutable — to change the slug, create a new tag and merge the old one into it.",
	parameters: z.object({
		tagId: z.string().uuid().describe("Tag UUID"),
		label: z.string().min(1).max(50).describe("New display label"),
	}),
	handler: ({ tagId, label }) =>
		safeExecute(async () => {
			const result = await tagService.rename({
				tagId: tagId as string,
				label: label as string,
			});
			if (!result.success) return err(result.error.message);
			return ok({
				id: result.data.id,
				slug: result.data.slug,
				label: result.data.label,
			});
		}),
});

registerExtendedTool("mergeTags", {
	category: "tags",
	description:
		"Merge one tag into another within the same project. Rewrites every CardTag row from `from` to `into`, then deletes the source tag. Composite-PK collisions on (cardId, tagId) are handled per-row — the destination row wins, the source row is removed.",
	parameters: z.object({
		fromTagId: z.string().uuid().describe("Source tag UUID — deleted after merge"),
		intoTagId: z.string().uuid().describe("Destination tag UUID — kept"),
	}),
	handler: ({ fromTagId, intoTagId }) =>
		safeExecute(async () => {
			const result = await tagService.merge({
				fromTagId: fromTagId as string,
				intoTagId: intoTagId as string,
			});
			if (!result.success) return err(result.error.message);
			return ok({
				merged: true,
				rewroteCount: result.data.rewroteCount,
				skippedDuplicates: result.data.skippedDuplicates,
			});
		}),
});

registerExtendedTool("deleteTag", {
	category: "tags",
	description:
		"Delete a tag — only when zero cards reference it. To delete a tag that's still in use, call `mergeTags` first to drain its references into another tag, then delete the (now orphan) source if the merge didn't already remove it. The check is atomic against concurrent CardTag inserts: a tag picking up usage mid-request is rejected with USAGE_NOT_ZERO rather than getting deleted with rows still pointing at it.",
	parameters: z.object({
		tagId: z.string().uuid().describe("Tag UUID — must be an orphan (usageCount === 0)"),
	}),
	handler: ({ tagId }) =>
		safeExecute(async () => {
			const result = await tagService.deleteIfOrphan(tagId as string);
			if (!result.success) return err(result.error.message);
			return ok({ deleted: true });
		}),
});
