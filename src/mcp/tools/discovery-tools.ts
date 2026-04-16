import { z } from "zod";
import { getHorizon, hasRole } from "../../lib/column-roles.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

// ─── Discovery tools (extended) ─────────────────────────────────────
// briefMe is the session-start primer; these live in extended so agents
// reach for them via runTool only when briefMe's default view isn't enough.

registerExtendedTool("getBoard", {
	category: "discovery",
	description:
		"Board state with filtering. Use 'columns' to fetch specific columns, 'excludeDone' to skip Done/Parking, 'summary' for lightweight view (no descriptions/checklists).",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		format: z.enum(["json", "toon"]).default("json").describe("'json' (default) or 'toon' (flat tabular shapes only — loses on nested payloads)"),
		columns: z
			.array(z.string())
			.optional()
			.describe("Only include these columns by name (e.g. ['Backlog', 'Up Next', 'In Progress'])"),
		excludeDone: z
			.boolean()
			.default(false)
			.describe("Exclude columns with role 'done' or 'parking' — great for reducing payload"),
		summary: z
			.boolean()
			.default(false)
			.describe(
				"Lightweight mode: returns only ref, title, priority, tags, milestone, checklist counts — no descriptions or checklist items."
			),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) => {
		const {
			boardId,
			format,
			columns: columnFilter,
			excludeDone,
			summary: summaryMode,
		} = params as {
			boardId: string;
			format: "json" | "toon";
			columns?: string[];
			excludeDone: boolean;
			summary: boolean;
		};
		return safeExecute(async () => {
			const board = await db.board.findUnique({
				where: { id: boardId },
				include: {
					project: true,
					columns: {
						orderBy: { position: "asc" },
						include: {
							cards: {
								orderBy: { position: "asc" },
								include: {
									checklists: { orderBy: { position: "asc" } },
									milestone: { select: { id: true, name: true } },
									_count: { select: { comments: true } },
								},
							},
						},
					},
				},
			});

			if (!board)
				return err(
					"Board not found.",
					"Use getTools({ category: 'discovery' }) → runTool('listProjects') → runTool('listBoards') to find a valid boardId."
				);

			let filteredColumns = board.columns;
			if (columnFilter && columnFilter.length > 0) {
				const lowerFilter = (columnFilter as string[]).map((n) => n.toLowerCase());
				filteredColumns = filteredColumns.filter((col) =>
					lowerFilter.includes(col.name.toLowerCase())
				);
				if (filteredColumns.length === 0) {
					const available = board.columns.map((c) => c.name).join(", ");
					return err(`No matching columns found.`, `Available: ${available}`);
				}
			}
			if (excludeDone) {
				filteredColumns = filteredColumns.filter(
					(col) => !hasRole(col, "done") && !hasRole(col, "parking")
				);
			}

			const totalCardCount = filteredColumns.reduce((sum, col) => sum + col.cards.length, 0);

			const milestoneProgress = new Map<string, { done: number; total: number }>();
			if (summaryMode) {
				for (const col of filteredColumns) {
					for (const card of col.cards) {
						if (card.milestone) {
							const entry = milestoneProgress.get(card.milestone.id) ?? { done: 0, total: 0 };
							entry.total++;
							if (hasRole(col, "done")) entry.done++;
							milestoneProgress.set(card.milestone.id, entry);
						}
					}
				}
			}

			const result = {
				id: board.id,
				name: board.name,
				project: { id: board.project.id, name: board.project.name },
				...(!summaryMode &&
					totalCardCount > 50 && {
						_hint: `Board has ${totalCardCount} cards. Consider summary: true to reduce payload.`,
					}),
				columns: filteredColumns.map((col) => ({
					id: col.id,
					name: col.name,
					description: summaryMode ? undefined : col.description,
					isParking: col.isParking,
					cards: col.cards.map((card) => {
						if (summaryMode) {
							const msProgress = card.milestone ? milestoneProgress.get(card.milestone.id) : null;
							return {
								number: card.number,
								ref: `#${card.number}`,
								title: card.title,
								priority: card.priority,
								tags: JSON.parse(card.tags),
								milestone: card.milestone?.name ?? null,
								...(msProgress && {
									milestoneProgress: `${Math.round((msProgress.done / msProgress.total) * 100)}%`,
								}),
								checklist: {
									total: card.checklists.length,
									done: card.checklists.filter((c) => c.completed).length,
								},
								assignee: card.assignee,
							};
						}
						return {
							id: card.id,
							number: card.number,
							ref: `#${card.number}`,
							title: card.title,
							description: card.description,
							priority: card.priority,
							tags: JSON.parse(card.tags),
							assignee: card.assignee,
							createdBy: card.createdBy,
							lastEditedBy: card.lastEditedBy,
							milestone: card.milestone
								? { id: card.milestone.id, name: card.milestone.name }
								: null,
							checklist: {
								total: card.checklists.length,
								done: card.checklists.filter((c) => c.completed).length,
								items: card.checklists.map((c) => ({
									id: c.id,
									text: c.text,
									completed: c.completed,
								})),
							},
							commentCount: card._count.comments,
							...(card.metadata &&
								card.metadata !== "{}" && { metadata: JSON.parse(card.metadata) }),
						};
					}),
				})),
			};

			return ok(result, format as "json" | "toon");
		});
	},
});

registerExtendedTool("searchCards", {
	category: "discovery",
	description: "Search cards by title/description across all projects. Tag filter is exact-match.",
	parameters: z.object({
		query: z.string().describe("Text to match in title and description"),
		tag: z.string().optional().describe("Exact tag match (e.g. 'bug')"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) => {
		const { query, tag } = params as { query: string; tag?: string };
		return safeExecute(async () => {
			const cards = await db.card.findMany({
				where: {
					OR: [{ title: { contains: query } }, { description: { contains: query } }],
				},
				include: {
					column: { include: { board: { include: { project: true } } } },
				},
				take: 50,
			});

			let results = cards.map((card) => ({
				id: card.id,
				number: card.number,
				ref: `#${card.number}`,
				title: card.title,
				description: card.description
					? card.description.slice(0, 200) + (card.description.length > 200 ? "…" : "")
					: "",
				priority: card.priority,
				tags: JSON.parse(card.tags) as string[],
				column: card.column.name,
				board: card.column.board.name,
				boardId: card.column.board.id,
				project: card.column.board.project.name,
			}));

			if (tag) {
				results = results.filter((r) => r.tags.includes(tag));
			}

			return ok(results);
		});
	},
});

registerExtendedTool("getRoadmap", {
	category: "discovery",
	description:
		"Roadmap view: cards grouped by milestone and horizon. Includes blockedBy refs, assignee breakdown, and progress per milestone. Horizons: In Progress/Review=Now, Up Next=Next, Backlog=Later, Done=Done.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		format: z.enum(["json", "toon"]).default("json").describe("'json' (default) or 'toon' (flat tabular shapes only — loses on nested payloads)"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) => {
		const { boardId, format } = params as { boardId: string; format: "json" | "toon" };
		return safeExecute(async () => {
			const board = await db.board.findUnique({
				where: { id: boardId },
				include: {
					project: {
						include: { milestones: { orderBy: { position: "asc" } } },
					},
					columns: {
						orderBy: { position: "asc" },
						include: {
							cards: {
								orderBy: { position: "asc" },
								include: {
									milestone: { select: { id: true, name: true } },
									checklists: { select: { completed: true } },
									relationsTo: {
										where: { type: "blocks" },
										select: { fromCard: { select: { number: true } } },
									},
								},
							},
						},
					},
				},
			});

			if (!board)
				return err("Board not found.", "Use getTools({ category: 'discovery' }) to find boards.");

			const allCards = board.columns.flatMap((col) =>
				col.cards.map((card) => ({
					id: card.id,
					number: card.number,
					ref: `#${card.number}`,
					title: card.title,
					priority: card.priority,
					assignee: (card as { assignee?: string | null }).assignee ?? null,
					column: col.name,
					horizon: getHorizon(col),
					milestone: card.milestone?.name ?? null,
					checklistDone: card.checklists.filter((c) => c.completed).length,
					checklistTotal: card.checklists.length,
					blockedBy: (card.relationsTo as { fromCard: { number: number } }[]).map(
						(r) => `#${r.fromCard.number}`
					),
				}))
			);

			const milestoneMap = new Map<string, typeof allCards>();
			for (const card of allCards) {
				const key = card.milestone ?? "Ungrouped";
				if (!milestoneMap.has(key)) milestoneMap.set(key, []);
				milestoneMap.get(key)!.push(card);
			}

			const roadmap = {
				board: board.name,
				project: { id: board.project.id, name: board.project.name },
				milestones: board.project.milestones.map((ms) => ({
					id: ms.id,
					name: ms.name,
					description: ms.description,
					targetDate: ms.targetDate,
				})),
				groups: Array.from(milestoneMap.entries()).map(([name, cards]) => {
					const done = cards.filter((c) => c.horizon === "done").length;
					const blocked = cards.filter(
						(c) => c.blockedBy.length > 0 && c.horizon !== "done"
					).length;
					return {
						milestone: name,
						total: cards.length,
						done,
						blocked,
						progress: cards.length > 0 ? `${Math.round((done / cards.length) * 100)}%` : "0%",
						assignees: {
							human: cards.filter((c) => c.assignee === "HUMAN").length,
							agent: cards.filter((c) => c.assignee === "AGENT").length,
						},
						now: cards.filter((c) => c.horizon === "now"),
						next: cards.filter((c) => c.horizon === "next"),
						later: cards.filter((c) => c.horizon === "later"),
						done_cards: cards.filter((c) => c.horizon === "done"),
					};
				}),
			};

			return ok(roadmap, format as "json" | "toon");
		});
	},
});
