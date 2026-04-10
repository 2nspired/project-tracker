import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, err, safeExecute } from "../utils.js";

// ─── Smart Queries ────────────────────────────────────────────────

registerExtendedTool("queryCards", {
	category: "discovery",
	description: "Filter cards by priority, assignee, column, tags, milestone, age. Lightweight response.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional().describe("Filter by priority level"),
		assignee: z.enum(["HUMAN", "AGENT"]).nullable().optional().describe("Filter by assignee (null = unassigned)"),
		columnName: z.string().optional().describe("Filter by column name"),
		tags: z.array(z.string()).optional().describe("Filter cards that have ALL specified tags"),
		milestoneName: z.string().optional().describe("Filter by milestone name"),
		createdBefore: z.string().datetime().optional().describe("Cards created before this ISO datetime"),
		updatedBefore: z.string().datetime().optional().describe("Cards updated before this ISO datetime"),
		staleDays: z.number().int().min(1).optional().describe("Cards not updated in N days"),
		hasBlockers: z.boolean().optional().describe("Only cards with blockedBy relations"),
		limit: z.number().int().min(1).max(200).default(50).describe("Max results (1-200, default 50)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, priority, assignee, columnName, tags, milestoneName, createdBefore, updatedBefore, staleDays, hasBlockers, limit }) => safeExecute(async () => {
		// Find the board and its columns
		const board = await db.board.findUnique({
			where: { id: boardId as string },
			include: { columns: { select: { id: true, name: true } } },
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		let columnIds = board.columns.map((c) => c.id);

		// Filter by column name if given
		if (columnName) {
			const matchedColumn = board.columns.find(
				(c) => c.name.toLowerCase() === (columnName as string).toLowerCase(),
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

		if (assignee !== undefined) {
			filters.assignee = assignee as string | null;
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
				if (!milestone) return err(`Milestone "${milestoneName}" not found.`, "Use getBoard to see available milestones.");
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
					if (!milestone) return err(`Milestone "${milestoneName}" not found.`, "Use getBoard to see available milestones.");
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
				_count: { select: { relationsTo: { where: { type: "blocks" } } } },
			},
			take: limit as number,
			orderBy: { updatedAt: "desc" },
		});

		// Post-filter: tags (cards that have ALL specified tags)
		let filtered = cards;
		if (tags && (tags as string[]).length > 0) {
			const requiredTags = tags as string[];
			filtered = filtered.filter((card) => {
				let cardTags: string[] = [];
				try {
					cardTags = JSON.parse(card.tags) as string[];
				} catch {
					return false;
				}
				return requiredTags.every((t) => cardTags.includes(t));
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
				tags: JSON.parse(card.tags) as string[],
				assignee: card.assignee,
				milestone: card.milestone?.name ?? null,
				updatedAt: card.updatedAt,
			})),
		});
	}),
});
