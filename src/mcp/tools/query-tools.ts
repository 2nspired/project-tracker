import { z } from "zod";
import { createBoardAuditService } from "@/lib/services/board-audit";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, errWithToolHint, ok, safeExecute } from "../utils.js";

// MCP-bound singleton for the shared board-audit factory. The web side
// has its own singleton in `src/server/services/board-audit-service.ts`
// — this is the MCP-process equivalent (decision a5a4cde6).
const boardAuditService = createBoardAuditService(db);

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
			// Delegate to the shared service factory (#173). The factory owns
			// every detail of the previous inline implementation; this thin
			// shim translates the ServiceResult contract back to the MCP
			// `ok()` / `err()` envelopes. The response shape is FROZEN — agent
			// callers depend on it unchanged.
			const result = await boardAuditService.auditBoard(boardId as string, {
				excludeDone: excludeDone as boolean,
				weights: rawWeights as
					| {
							priority: number;
							tags: number;
							milestone: number;
							checklist: number;
							staleInProgress: number;
					  }
					| undefined,
			});
			if (!result.success) {
				if (result.error.code === "NOT_FOUND") {
					return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");
				}
				return err(result.error.message);
			}
			return ok(result.data);
		}),
});
