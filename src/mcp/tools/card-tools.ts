import { z } from "zod";
import { db } from "../db.js";
import {
	buildTaxonomyMeta,
	resolveMilestoneForWrite,
	resolveTagsForWrite,
	syncCardTags,
} from "../taxonomy-utils.js";
import { registerExtendedTool } from "../tool-registry.js";
import {
	AGENT_NAME,
	err,
	getProjectIdForBoard,
	ok,
	resolveCardRef,
	safeExecute,
} from "../utils.js";

function isDoneColumnLike(column: { role?: string | null; name: string }): boolean {
	if (column.role) return column.role === "done";
	return column.name.toLowerCase() === "done";
}

registerExtendedTool("deleteCard", {
	category: "cards",
	description:
		"Permanently delete a card and all its data. Cannot be undone. Agents must pass `intent` explaining why.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		intent: z
			.string()
			.min(1, "intent is required — explain why you're deleting this card")
			.max(120, "intent must be ≤ 120 chars")
			.describe("Short rationale for the deletion (e.g. 'duplicate of #41')"),
		boardId: z
			.string()
			.optional()
			.describe("Board UUID — scopes #number resolution to this board's project"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ cardId, boardId }) =>
		safeExecute(async () => {
			const projectId = boardId ? await getProjectIdForBoard(boardId as string) : undefined;
			const resolved = await resolveCardRef(cardId as string, projectId);
			if (!resolved.ok) return err(resolved.message);
			const id = resolved.id;
			const card = await db.card.findUnique({ where: { id } });
			if (!card) return err("Card not found.");

			await db.card.delete({ where: { id } });
			return ok({
				deleted: true,
				ref: `#${card.number}`,
				title: card.title,
				...(resolved.warning && { _warning: resolved.warning }),
			});
		}),
});

registerExtendedTool("bulkMoveCards", {
	category: "cards",
	description: "Move multiple cards to a column in one call.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		cardIds: z.array(z.string()).describe("UUIDs or #numbers"),
		columnName: z.string().describe("Target column name"),
		intent: z
			.string()
			.min(1)
			.max(120)
			.describe("Why these cards are being moved (≤120 chars). Shown in the activity feed."),
	}),
	handler: ({ boardId, cardIds, columnName, intent }) =>
		safeExecute(async () => {
			const projectId = await getProjectIdForBoard(boardId as string);
			const column = await db.column.findFirst({
				where: { boardId: boardId as string, name: { equals: columnName as string } },
			});
			if (!column) {
				const cols = await db.column.findMany({
					where: { boardId: boardId as string },
					select: { name: true },
				});
				return err(
					`Column "${columnName}" not found.`,
					`Available: ${cols.map((c) => c.name).join(", ")}`
				);
			}

			const maxPosAgg = await db.card.aggregate({
				where: { columnId: column.id },
				_max: { position: true },
			});
			let nextPos = (maxPosAgg._max.position ?? -1) + 1;

			const moved: string[] = [];
			const errors: string[] = [];

			for (const ref of cardIds as string[]) {
				const resolved = await resolveCardRef(ref, projectId);
				if (!resolved.ok) {
					errors.push(resolved.message);
					continue;
				}
				const id = resolved.id;

				const card = await db.card.findUnique({ where: { id }, include: { column: true } });
				if (!card) {
					errors.push(`Card "${ref}" not found`);
					continue;
				}

				// Skip reindexing cards already in the target column — but still emit no-op
				// so the loop order is consistent. Only cards moving to a new column claim
				// a fresh slot at the end.
				if (card.columnId === column.id) {
					moved.push(`#${card.number}`);
					continue;
				}

				const sourceIsDone = isDoneColumnLike(card.column);
				const targetIsDone = isDoneColumnLike(column);
				const completedAtPatch =
					targetIsDone && !sourceIsDone
						? { completedAt: new Date() }
						: sourceIsDone && !targetIsDone
							? { completedAt: null }
							: {};

				await db.card.update({
					where: { id },
					data: { columnId: column.id, position: nextPos++, ...completedAtPatch },
				});

				await db.activity.create({
					data: {
						cardId: id,
						action: "moved",
						details: `Moved from "${card.column.name}" to "${columnName}"`,
						intent: intent as string,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				});
				moved.push(`#${card.number}`);
			}

			return ok({ moved, target: columnName, errors: errors.length > 0 ? errors : undefined });
		}),
});

registerExtendedTool("bulkUpdateCards", {
	category: "cards",
	description:
		"Update multiple cards in one call. Each entry can set priority, tags, and/or milestone. Omitted fields are unchanged. Prefer `tagSlugs` (strict) and `milestoneId` (strict). Legacy params still accepted but emit `_deprecated` warnings; slated for removal in the next major version.",
	parameters: z.object({
		cards: z.array(
			z
				.object({
					cardId: z.string().describe("Card UUID or #number"),
					priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
					tagSlugs: z.array(z.string()).optional().describe("Strict — replaces all tags."),
					tags: z
						.array(z.string())
						.optional()
						.describe("Deprecated (removed v5.0.0) — use tagSlugs."),
					milestoneId: z
						.string()
						.uuid()
						.nullable()
						.optional()
						.describe("Strict — milestone UUID; null to unassign."),
					milestoneName: z
						.string()
						.nullable()
						.optional()
						.describe("Deprecated (removed v5.0.0) — use milestoneId."),
					metadata: z
						.record(z.string(), z.unknown())
						.optional()
						.describe(
							"Agent-writable JSON metadata (merged with existing; set key to null to delete)"
						),
				})
				.strict()
		),
	}),
	handler: ({ cards }) =>
		safeExecute(async () => {
			const updated: Array<Record<string, unknown>> = [];
			const errors: string[] = [];
			const deprecatedSeen = new Set<string>();

			for (const input of cards as Array<Record<string, unknown>>) {
				const resolved = await resolveCardRef(input.cardId as string);
				if (!resolved.ok) {
					errors.push(resolved.message);
					continue;
				}
				const id = resolved.id;

				const existing = await db.card.findUnique({ where: { id } });
				if (!existing) {
					errors.push(`Card "${input.cardId}" not found`);
					continue;
				}

				const tagResolution = await resolveTagsForWrite(db, existing.projectId, {
					tagSlugs: input.tagSlugs as string[] | undefined,
					tags: input.tags as string[] | undefined,
				});
				if (!tagResolution.ok) {
					errors.push(
						`Tags for "${input.cardId}": ${tagResolution.errors.map((e) => e.slug).join(", ")} not found.`
					);
					continue;
				}

				const milestoneResolution = await resolveMilestoneForWrite(db, existing.projectId, {
					milestoneId: input.milestoneId as string | null | undefined,
					milestoneName: input.milestoneName as string | null | undefined,
				});
				if (!milestoneResolution.ok) {
					errors.push(`Milestone for "${input.cardId}": ${milestoneResolution.error}`);
					continue;
				}

				let mergedMetadata: string | undefined;
				if (input.metadata) {
					const existingMeta = JSON.parse(existing.metadata || "{}");
					const merged = { ...existingMeta, ...(input.metadata as Record<string, unknown>) };
					for (const [key, value] of Object.entries(merged)) {
						if (value === null) delete merged[key];
					}
					mergedMetadata = JSON.stringify(merged);
				}

				const card = await db.card.update({
					where: { id },
					data: {
						priority: input.priority as string | undefined,
						tags: tagResolution.applied ? JSON.stringify(tagResolution.labels) : undefined,
						milestoneId: milestoneResolution.applied ? milestoneResolution.milestoneId : undefined,
						metadata: mergedMetadata,
						lastEditedBy: AGENT_NAME,
					},
					include: { milestone: { select: { name: true } } },
				});

				if (tagResolution.applied) {
					await syncCardTags(db, card.id, tagResolution.tagIds);
				}

				const meta = buildTaxonomyMeta(tagResolution, milestoneResolution);
				if (meta?._deprecated) {
					for (const m of meta._deprecated) deprecatedSeen.add(m);
				}
				updated.push({
					ref: `#${card.number}`,
					title: card.title,
					priority: card.priority,
					tags: JSON.parse(card.tags),
					milestone: card.milestone?.name ?? null,
					...(card.metadata && card.metadata !== "{}" && { metadata: JSON.parse(card.metadata) }),
					...(meta?._didYouMean ? { _didYouMean: meta._didYouMean } : {}),
				});
			}

			return ok({
				updated,
				errors: errors.length > 0 ? errors : undefined,
				...(deprecatedSeen.size > 0 ? { _deprecated: [...deprecatedSeen] } : {}),
			});
		}),
});
