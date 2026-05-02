import { z } from "zod";
import { findStaleInProgress } from "@/server/services/stale-cards";
import { hasRole } from "../../lib/column-roles.js";
import { editDistance } from "../../lib/slugify.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, errWithToolHint, ok, safeExecute } from "../utils.js";

// ─── Smart Queries ────────────────────────────────────────────────

registerExtendedTool("queryCards", {
	category: "discovery",
	description: "Filter cards by priority, column, tags, milestone, age. Lightweight response.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		priority: z
			.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"])
			.optional()
			.describe("Filter by priority level"),
		columnName: z.string().optional().describe("Filter by column name"),
		tags: z.array(z.string()).optional().describe("Filter cards that have ALL specified tags"),
		milestoneName: z.string().optional().describe("Filter by milestone name"),
		createdBefore: z
			.string()
			.datetime()
			.optional()
			.describe("Cards created before this ISO datetime"),
		updatedBefore: z
			.string()
			.datetime()
			.optional()
			.describe("Cards updated before this ISO datetime"),
		staleDays: z.number().int().min(1).optional().describe("Cards not updated in N days"),
		hasBlockers: z.boolean().optional().describe("Only cards with blockedBy relations"),
		limit: z.number().int().min(1).max(200).default(50).describe("Max results (1-200, default 50)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({
		boardId,
		priority,
		columnName,
		tags,
		milestoneName,
		createdBefore,
		updatedBefore,
		staleDays,
		hasBlockers,
		limit,
	}) =>
		safeExecute(async () => {
			// Find the board and its columns
			const board = await db.board.findUnique({
				where: { id: boardId as string },
				include: { columns: { select: { id: true, name: true } } },
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			let columnIds = board.columns.map((c) => c.id);

			// Filter by column name if given
			if (columnName) {
				const matchedColumn = board.columns.find(
					(c) => c.name.toLowerCase() === (columnName as string).toLowerCase()
				);
				if (!matchedColumn) {
					const available = board.columns.map((c) => c.name).join(", ");
					return err(`Column "${columnName}" not found.`, `Available columns: ${available}`);
				}
				columnIds = [matchedColumn.id];
			}

			// Build dynamic where clause
			const filters: Record<string, unknown> = {};

			if (priority !== undefined) {
				filters.priority = priority as string;
			}

			if (milestoneName) {
				// Look up milestone across columns' project
				const column = board.columns[0];
				if (!column) return err("Board has no columns.");

				const sampleCard = await db.card.findFirst({
					where: { columnId: column.id },
					select: { projectId: true },
				});

				if (sampleCard) {
					const milestone = await db.milestone.findFirst({
						where: {
							projectId: sampleCard.projectId,
							name: { equals: milestoneName as string },
						},
					});
					if (!milestone)
						return errWithToolHint(`Milestone "${milestoneName}" not found.`, "getRoadmap", {
							projectId: '"<projectId>"',
						});
					filters.milestoneId = milestone.id;
				} else {
					// No cards on board yet — look up milestone via board's project
					const boardWithProject = await db.board.findUnique({
						where: { id: boardId as string },
						select: { projectId: true },
					});
					if (boardWithProject) {
						const milestone = await db.milestone.findFirst({
							where: {
								projectId: boardWithProject.projectId,
								name: { equals: milestoneName as string },
							},
						});
						if (!milestone)
							return errWithToolHint(`Milestone "${milestoneName}" not found.`, "getRoadmap", {
								projectId: '"<projectId>"',
							});
						filters.milestoneId = milestone.id;
					}
				}
			}

			if (createdBefore) {
				filters.createdAt = { lt: new Date(createdBefore as string) };
			}

			if (updatedBefore) {
				filters.updatedAt = { lt: new Date(updatedBefore as string) };
			}

			if (staleDays) {
				const cutoff = new Date();
				cutoff.setDate(cutoff.getDate() - (staleDays as number));
				// If updatedBefore is also set, use the earlier date
				if (filters.updatedAt) {
					const existing = (filters.updatedAt as { lt: Date }).lt;
					filters.updatedAt = { lt: cutoff < existing ? cutoff : existing };
				} else {
					filters.updatedAt = { lt: cutoff };
				}
			}

			// Query cards
			const cards = await db.card.findMany({
				where: { columnId: { in: columnIds }, ...filters },
				include: {
					column: { select: { name: true } },
					milestone: { select: { name: true } },
					cardTags: { include: { tag: { select: { label: true } } } },
					_count: { select: { relationsTo: { where: { type: "blocks" } } } },
				},
				take: limit as number,
				orderBy: { updatedAt: "desc" },
			});

			// Post-filter: tags (cards that have ALL specified tags). Compares
			// against the canonical CardTag join — slug match is the cheaper
			// path, but the public API speaks labels so we match those.
			let filtered = cards;
			if (tags && (tags as string[]).length > 0) {
				const requiredTags = tags as string[];
				filtered = filtered.filter((card) => {
					const cardTagLabels = card.cardTags.map((ct) => ct.tag.label);
					return requiredTags.every((t) => cardTagLabels.includes(t));
				});
			}

			// Post-filter: hasBlockers (cards with blockedBy relations)
			if (hasBlockers) {
				filtered = filtered.filter((card) => card._count.relationsTo > 0);
			}

			// Apply limit after post-filtering
			const results = filtered.slice(0, limit as number);

			// Return lightweight response
			return ok({
				count: results.length,
				cards: results.map((card) => ({
					ref: `#${card.number}`,
					title: card.title,
					priority: card.priority,
					column: card.column.name,
					tags: card.cardTags.map((ct) => ct.tag.label),
					milestone: card.milestone?.name ?? null,
					updatedAt: card.updatedAt,
				})),
			});
		}),
});

// ─── Board Audit ────────────────────────────────────────────────

registerExtendedTool("auditBoard", {
	category: "discovery",
	description:
		"Board health check: find cards missing priority, tags, milestones, or checklists. Groups by issue type for quick triage. Also returns project-level taxonomy signals (single-use tags, near-miss slug pairs, stale-active milestones) so drift between explicit audits is visible. Supports custom weights for health score.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		excludeDone: z.boolean().default(true).describe("Skip Done/Parking columns (default true)"),
		weights: z
			.object({
				priority: z.number().default(1),
				tags: z.number().default(1),
				milestone: z.number().default(1),
				checklist: z.number().default(1),
				staleInProgress: z.number().default(1),
			})
			.default({ priority: 1, tags: 1, milestone: 1, checklist: 1, staleInProgress: 1 })
			.describe(
				"Custom weights for health score dimensions (default: all 1). Set to 0 to exclude a dimension."
			)
			.optional(),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, excludeDone, weights: rawWeights }) =>
		safeExecute(async () => {
			const w = (rawWeights ?? {
				priority: 1,
				tags: 1,
				milestone: 1,
				checklist: 1,
				staleInProgress: 1,
			}) as {
				priority: number;
				tags: number;
				milestone: number;
				checklist: number;
				staleInProgress: number;
			};
			const board = await db.board.findUnique({
				where: { id: boardId as string },
				include: {
					columns: {
						orderBy: { position: "asc" },
						include: {
							cards: {
								include: {
									checklists: { select: { id: true } },
									milestone: { select: { name: true } },
									cardTags: { select: { tagId: true } },
								},
							},
						},
					},
				},
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			let columns = board.columns;
			if (excludeDone) {
				columns = columns.filter((col) => !hasRole(col, "done") && !hasRole(col, "parking"));
			}

			const allCards = columns.flatMap((col) => col.cards.map((c) => ({ ...c, column: col.name })));

			const missingPriority = allCards
				.filter((c) => c.priority === "NONE")
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
			const missingTags = allCards
				.filter((c) => c.cardTags.length === 0)
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
			const noMilestone = allCards
				.filter((c) => !c.milestone)
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
			const emptyChecklist = allCards
				.filter((c) => c.checklists.length === 0)
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));

			const staleMap = await findStaleInProgress(db, boardId as string);
			const staleInProgress = allCards
				.filter((c) => staleMap.has(c.id))
				.map((c) => {
					const info = staleMap.get(c.id);
					if (!info) return null;
					return { ref: `#${c.number}`, title: c.title, column: c.column, days: info.days };
				})
				.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

			// ─── Taxonomy-level signals (#163) ────────────────────────────
			// Project-scoped checks that surface drift between explicit
			// `mergeTags`/`updateMilestone` runs. Same response shape rules
			// as the card-level sections above: count + array of items.
			const { projectId } = board;

			const tagsWithUsage = await db.tag.findMany({
				where: { projectId },
				select: {
					slug: true,
					label: true,
					_count: { select: { cardTags: true } },
				},
			});

			const singleUseTags = tagsWithUsage
				.filter((t) => t._count.cardTags === 1)
				.map((t) => ({ slug: t.slug, label: t.label }));

			const slugs = tagsWithUsage.map((t) => t.slug);
			const nearMissTagPairs: Array<{ a: string; b: string; distance: number }> = [];
			for (let i = 0; i < slugs.length; i++) {
				for (let j = i + 1; j < slugs.length; j++) {
					const d = editDistance(slugs[i], slugs[j], 2);
					if (d <= 2) {
						nearMissTagPairs.push({ a: slugs[i], b: slugs[j], distance: d });
					}
				}
			}

			const activeMilestones = await db.milestone.findMany({
				where: { projectId, state: "active" },
				select: {
					name: true,
					cards: {
						select: { column: { select: { role: true, name: true } } },
					},
				},
			});

			const staleActiveMilestones = activeMilestones
				.filter((m) => {
					if (m.cards.length === 0) return false;
					return m.cards.every((c) => hasRole(c.column, "done") || hasRole(c.column, "parking"));
				})
				.map((m) => ({ name: m.name, cardCount: m.cards.length }));

			const totalCards = allCards.length;
			const totalWeight = w.priority + w.tags + w.milestone + w.checklist + w.staleInProgress;
			const weightedIssues =
				missingPriority.length * w.priority +
				missingTags.length * w.tags +
				noMilestone.length * w.milestone +
				emptyChecklist.length * w.checklist +
				staleInProgress.length * w.staleInProgress;
			const maxScore = totalCards * totalWeight;
			const healthScore =
				maxScore > 0 ? `${Math.round(((maxScore - weightedIssues) / maxScore) * 100)}%` : "N/A";

			return ok({
				totalCards,
				healthScore,
				scoring: {
					weights: w,
					perDimension: {
						priority: { issues: missingPriority.length, weight: w.priority },
						tags: { issues: missingTags.length, weight: w.tags },
						milestone: { issues: noMilestone.length, weight: w.milestone },
						checklist: { issues: emptyChecklist.length, weight: w.checklist },
						staleInProgress: { issues: staleInProgress.length, weight: w.staleInProgress },
					},
				},
				missingPriority: { count: missingPriority.length, cards: missingPriority },
				missingTags: { count: missingTags.length, cards: missingTags },
				noMilestone: { count: noMilestone.length, cards: noMilestone },
				emptyChecklist: { count: emptyChecklist.length, cards: emptyChecklist },
				staleInProgress: { count: staleInProgress.length, cards: staleInProgress },
				taxonomy: {
					singleUseTags: { count: singleUseTags.length, tags: singleUseTags },
					nearMissTags: { count: nearMissTagPairs.length, pairs: nearMissTagPairs },
					staleActiveMilestones: {
						count: staleActiveMilestones.length,
						milestones: staleActiveMilestones,
					},
				},
			});
		}),
});
