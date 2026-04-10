import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, err, safeExecute } from "../utils.js";

// ─── Similarity utilities (inlined to avoid ESM import issues) ────

const STOP_WORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been",
	"to", "of", "in", "for", "on", "with", "at", "by", "from",
	"and", "or", "but", "not", "this", "that", "it", "as",
	"add", "update", "fix", "implement", "create", "remove",
]);

function normalizeSim(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOP_WORDS.has(w))
		.join(" ");
}

function trigramSet(text: string): Set<string> {
	const set = new Set<string>();
	const normalized = normalizeSim(text);
	if (normalized.length < 3) { set.add(normalized); return set; }
	for (let i = 0; i <= normalized.length - 3; i++) {
		set.add(normalized.slice(i, i + 3));
	}
	return set;
}

function jaccardSimilarity(a: string, b: string): number {
	const sa = trigramSet(a);
	const sb = trigramSet(b);
	if (sa.size === 0 || sb.size === 0) return 0;
	let intersection = 0;
	for (const gram of sa) { if (sb.has(gram)) intersection++; }
	const union = sa.size + sb.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

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

// ─── Board Audit ────────────────────────────────────────────────

registerExtendedTool("auditBoard", {
	category: "discovery",
	description: "Board health check: find cards missing priority, tags, milestones, or checklists. Groups by issue type for quick triage.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		excludeDone: z.boolean().default(true).describe("Skip Done/Parking columns (default true)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, excludeDone }) => safeExecute(async () => {
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
							},
						},
					},
				},
			},
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		let columns = board.columns;
		if (excludeDone) {
			columns = columns.filter((col) => col.role !== "done" && col.role !== "parking");
		}

		const allCards = columns.flatMap((col) =>
			col.cards.map((c) => ({ ...c, column: col.name })),
		);

		const missingPriority = allCards.filter((c) => c.priority === "NONE").map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
		const missingTags = allCards.filter((c) => { try { const t = JSON.parse(c.tags); return !Array.isArray(t) || t.length === 0; } catch { return true; } }).map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
		const noMilestone = allCards.filter((c) => !c.milestone).map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
		const emptyChecklist = allCards.filter((c) => c.checklists.length === 0).map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
		const noAssignee = allCards.filter((c) => !c.assignee).map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));

		const totalCards = allCards.length;
		const issues = missingPriority.length + missingTags.length + noMilestone.length + emptyChecklist.length + noAssignee.length;

		return ok({
			totalCards,
			totalIssues: issues,
			healthScore: totalCards > 0 ? `${Math.round(((totalCards * 5 - issues) / (totalCards * 5)) * 100)}%` : "N/A",
			missingPriority: { count: missingPriority.length, cards: missingPriority },
			missingTags: { count: missingTags.length, cards: missingTags },
			noMilestone: { count: noMilestone.length, cards: noMilestone },
			emptyChecklist: { count: emptyChecklist.length, cards: emptyChecklist },
			noAssignee: { count: noAssignee.length, cards: noAssignee },
		});
	}),
});

// ─── Similarity Search ───────────────────────────────────────────

registerExtendedTool("findSimilar", {
	category: "discovery",
	description: "Find cards with similar titles using trigram similarity. Useful for detecting duplicates before creating new cards.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		title: z.string().min(3).describe("Title to compare against existing cards"),
		threshold: z.number().min(0).max(1).default(0.35).describe("Similarity threshold (0-1, default 0.35)"),
		limit: z.number().int().min(1).max(20).default(5).describe("Max results (1-20, default 5)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, title, threshold, limit }) => safeExecute(async () => {
		const board = await db.board.findUnique({
			where: { id: boardId as string },
			include: {
				columns: {
					include: {
						cards: {
							select: { id: true, number: true, title: true, priority: true, tags: true },
						},
					},
				},
			},
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const allCards = board.columns.flatMap((col) =>
			col.cards.map((c) => ({ ...c, column: col.name })),
		);

		const matches = allCards
			.map((card) => ({
				ref: `#${card.number}`,
				title: card.title,
				column: card.column,
				priority: card.priority,
				tags: JSON.parse(card.tags) as string[],
				similarity: Math.round(jaccardSimilarity(title as string, card.title) * 100) / 100,
			}))
			.filter((m) => m.similarity >= (threshold as number))
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit as number);

		return ok({
			query: title,
			matches,
			hasDuplicates: matches.some((m) => m.similarity >= 0.6),
		});
	}),
});
