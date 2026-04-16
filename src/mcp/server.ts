import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getHorizon, hasRole } from "../lib/column-roles.js";
import { seedTutorialProject } from "../lib/onboarding/seed-runner.js";
import { db } from "./db.js";
import { registerResources } from "./resources.js";
import { executeTool, getRegistrySize, getToolCatalog } from "./tool-registry.js";
import { toToon } from "./toon.js";
import { initFts5 } from "./fts.js";
import { checkStaleness, formatStalenessWarnings } from "./staleness.js";
import {
	AGENT_NAME,
	checkVersionConflict,
	detectFeatures,
	err,
	ok,
	resolveCardRef,
	resolveOrCreateMilestone,
	SCHEMA_VERSION,
	safeExecute,
} from "./utils.js";
import { parseCardScope, scopeSchema } from "../lib/schemas/card-schemas.js";
import { wrapEssentialHandler } from "./instrumentation.js";

// Initialize extended tools (registers them in the catalog)
import "./extended-tools.js";
import "./tools/relation-tools.js";
import "./tools/session-tools.js";
import "./tools/decision-tools.js";
import "./tools/scratch-tools.js";
import "./tools/context-tools.js";
import "./tools/query-tools.js";
import "./tools/git-tools.js";
import "./tools/summary-tools.js";
import "./tools/onboarding-tools.js";
import "./tools/status-tools.js";
import "./tools/fact-tools.js";
import "./tools/knowledge-tools.js";
import "./tools/instrumentation-tools.js";

const server = new McpServer({
	name: "project-tracker",
	version: "2.1.0",
});

// ─── Essential Tools (always loaded in LLM context) ────────────────

server.registerTool(
	"getBoard",
	{
		title: "Get Board",
		description:
			"Board state with filtering. Use 'columns' to fetch specific columns, 'excludeDone' to skip Done/Parking, 'summary' for lightweight view (no descriptions/checklists). TOON by default (~40% fewer tokens).",
		inputSchema: {
			boardId: z.string().describe("Board UUID"),
			format: z.enum(["json", "toon"]).default("toon").describe("Default 'toon'; use 'json' for raw"),
			columns: z.array(z.string()).optional().describe("Only include these columns by name (e.g. ['Backlog', 'Up Next', 'In Progress'])"),
			excludeDone: z.boolean().default(false).describe("Exclude columns with role 'done' or 'parking' — great for reducing payload"),
			summary: z.boolean().default(false).describe("Lightweight mode: returns only ref, title, priority, tags, milestone, checklist counts — no descriptions or checklist items."),
		},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("getBoard", async ({ boardId, format, columns: columnFilter, excludeDone, summary: summaryMode }) => {
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

			// Filter columns
			let filteredColumns = board.columns;
			if (columnFilter && columnFilter.length > 0) {
				const lowerFilter = (columnFilter as string[]).map((n) => n.toLowerCase());
				filteredColumns = filteredColumns.filter((col) => lowerFilter.includes(col.name.toLowerCase()));
				if (filteredColumns.length === 0) {
					const available = board.columns.map((c) => c.name).join(", ");
					return err(`No matching columns found.`, `Available: ${available}`);
				}
			}
			if (excludeDone) {
				filteredColumns = filteredColumns.filter((col) => !hasRole(col, "done") && !hasRole(col, "parking"));
			}

			const totalCardCount = filteredColumns.reduce((sum, col) => sum + col.cards.length, 0);

			// Pre-compute milestone progress for summary mode
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
				...(!summaryMode && totalCardCount > 50 && {
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
								...(msProgress && { milestoneProgress: `${Math.round((msProgress.done / msProgress.total) * 100)}%` }),
								checklist: { total: card.checklists.length, done: card.checklists.filter((c) => c.completed).length },
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
							version: card.version,
							lastEditedBy: card.lastEditedBy,
							milestone: card.milestone ? { id: card.milestone.id, name: card.milestone.name } : null,
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
							...(card.metadata && card.metadata !== "{}" && { metadata: JSON.parse(card.metadata) }),
							...(card.scope && card.scope !== "{}" && { scope: JSON.parse(card.scope) }),
						};
					}),
				})),
			};

			return ok(result, format as "json" | "toon");
		});
	})
);

server.registerTool(
	"createCard",
	{
		title: "Create Card",
		description: "Create a card. Uses column name (not ID); auto-creates milestone if name is new.",
		inputSchema: {
			boardId: z.string().describe("Board UUID"),
			columnName: z.string().describe("Column name (e.g. 'Up Next', 'Backlog')"),
			title: z.string().describe("Card title"),
			description: z.string().optional().describe("Markdown description"),
			priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE"),
			tags: z.array(z.string()).default([]).describe("e.g. ['bug', 'feature:auth']"),
			assignee: z.enum(["HUMAN", "AGENT"]).optional(),
			milestoneName: z.string().optional().describe("Auto-creates if new"),
			metadata: z.record(z.string(), z.unknown()).optional().describe("Agent-writable JSON metadata (not rendered in UI)"),
			scope: z.object({
				acceptanceCriteria: z.array(z.string()).optional(),
				outOfScope: z.array(z.string()).optional(),
				contextBudget: z.enum(["quick-fix", "standard", "deep-dive"]).nullable().optional(),
				approachHint: z.string().nullable().optional(),
			}).optional().describe("Scope guards: acceptance criteria, out-of-scope, context budget, approach hint"),
		},
	},
	wrapEssentialHandler("createCard", async ({ boardId, columnName, title, description, priority, tags, assignee, milestoneName, metadata, scope }) => {
		return safeExecute(async () => {
			const column = await db.column.findFirst({
				where: { boardId, name: { equals: columnName } },
			});
			if (!column) {
				const columns = await db.column.findMany({ where: { boardId }, select: { name: true } });
				return err(
					`Column "${columnName}" not found.`,
					`Available: ${columns.map((c) => c.name).join(", ")}`
				);
			}

			const board = await db.board.findUnique({
				where: { id: boardId },
				select: { projectId: true },
			});
			if (!board) return err("Board not found.");

			const maxPosition = await db.card.aggregate({
				where: { columnId: column.id },
				_max: { position: true },
			});
			const project = await db.project.update({
				where: { id: board.projectId },
				data: { nextCardNumber: { increment: 1 } },
			});
			const cardNumber = project.nextCardNumber - 1;

			let milestoneId: string | undefined;
			if (milestoneName) {
				milestoneId = await resolveOrCreateMilestone(board.projectId, milestoneName);
			}

			const card = await db.card.create({
				data: {
					columnId: column.id,
					projectId: board.projectId,
					number: cardNumber,
					title,
					description,
					priority,
					tags: JSON.stringify(tags),
					assignee,
					milestoneId,
					metadata: metadata ? JSON.stringify(metadata) : undefined,
					scope: scope ? JSON.stringify(scopeSchema.parse(scope)) : undefined,
					createdBy: "AGENT",
					lastEditedBy: AGENT_NAME,
					position: (maxPosition._max.position ?? -1) + 1,
				},
			});

			await db.activity.create({
				data: {
					cardId: card.id,
					action: "created",
					details: `Card #${cardNumber} "${title}" created in ${columnName}`,
					actorType: "AGENT",
					actorName: AGENT_NAME,
				},
			});

			return ok({
				id: card.id,
				number: cardNumber,
				ref: `#${cardNumber}`,
				title: card.title,
				column: columnName,
			});
		});
	})
);

server.registerTool(
	"updateCard",
	{
		title: "Update Card",
		description: "Update card fields. Omitted fields unchanged.",
		inputSchema: {
			cardId: z.string().describe("Card UUID or #number"),
			title: z.string().optional(),
			description: z.string().optional().describe("Markdown"),
			priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
			tags: z.array(z.string()).optional().describe("Replaces all tags"),
			assignee: z.enum(["HUMAN", "AGENT"]).nullable().optional().describe("null to unassign"),
			milestoneName: z
				.string()
				.nullable()
				.optional()
				.describe("null to unassign; auto-creates if new"),
			metadata: z.record(z.string(), z.unknown()).optional().describe("Agent-writable JSON metadata (merged with existing; set key to null to delete)"),
			scope: z.object({
				acceptanceCriteria: z.array(z.string()).optional(),
				outOfScope: z.array(z.string()).optional(),
				contextBudget: z.enum(["quick-fix", "standard", "deep-dive"]).nullable().optional(),
				approachHint: z.string().nullable().optional(),
			}).optional().describe("Scope guards — each sub-field replaces its entry; omit sub-fields to leave unchanged"),
			version: z.number().int().optional().describe("Expected version for optimistic locking — pass to detect conflicts"),
		},
		annotations: { idempotentHint: true },
	},
	wrapEssentialHandler("updateCard", async ({ cardId: cardRef, title, description, priority, tags, assignee, milestoneName, metadata, scope, version }) => {
		return safeExecute(async () => {
			const resolved = await resolveCardRef(cardRef);
			if (!resolved.ok) return err(resolved.message);
			const cardId = resolved.id;

			const existing = await db.card.findUnique({ where: { id: cardId } });
			if (!existing) return err("Card not found.");

			const conflict = checkVersionConflict(version, existing.version, "card");
			if (conflict) return conflict;

			let milestoneId: string | null | undefined;
			if (milestoneName !== undefined) {
				milestoneId = milestoneName
					? await resolveOrCreateMilestone(existing.projectId, milestoneName)
					: null;
			}

			// Merge metadata: combine with existing, remove keys set to null
			let mergedMetadata: string | undefined;
			if (metadata) {
				const existingMeta = JSON.parse(existing.metadata || "{}");
				const merged = { ...existingMeta, ...(metadata as Record<string, unknown>) };
				for (const [key, value] of Object.entries(merged)) {
					if (value === null) delete merged[key];
				}
				mergedMetadata = JSON.stringify(merged);
			}

			// Merge scope: per-sub-field replacement
			let mergedScope: string | undefined;
			if (scope) {
				const existingScope = parseCardScope(existing.scope);
				mergedScope = JSON.stringify(scopeSchema.parse({ ...existingScope, ...(scope as Record<string, unknown>) }));
			}

			const card = await db.card.update({
				where: { id: cardId },
				data: {
					title,
					description,
					priority,
					tags: tags ? JSON.stringify(tags) : undefined,
					assignee,
					milestoneId: milestoneId !== undefined ? milestoneId : undefined,
					metadata: mergedMetadata,
					scope: mergedScope,
					version: { increment: 1 },
					lastEditedBy: AGENT_NAME,
				},
				include: { milestone: { select: { name: true } } },
			});

			return ok({
				id: card.id,
				ref: `#${card.number}`,
				title: card.title,
				updated: true,
				version: card.version,
				lastEditedBy: card.lastEditedBy,
				fields: {
					priority: card.priority,
					tags: JSON.parse(card.tags),
					assignee: card.assignee,
					milestone: card.milestone?.name ?? null,
					metadata: JSON.parse(card.metadata),
					...(card.scope && card.scope !== "{}" && { scope: JSON.parse(card.scope) }),
				},
			});
		});
	})
);

server.registerTool(
	"moveCard",
	{
		title: "Move Card",
		description: "Move a card to a column. Position 0 = top; default = bottom.",
		inputSchema: {
			cardId: z.string().describe("Card UUID or #number"),
			columnName: z.string().describe("Target column (e.g. 'In Progress', 'Done')"),
			position: z.number().int().min(0).optional().describe("0 = top, omit = bottom"),
		},
	},
	wrapEssentialHandler("moveCard", async ({ cardId: cardRef, columnName, position }) => {
		return safeExecute(async () => {
			const resolved = await resolveCardRef(cardRef);
			if (!resolved.ok) return err(resolved.message);
			const cardId = resolved.id;

			const card = await db.card.findUnique({
				where: { id: cardId },
				include: { column: { include: { board: true } } },
			});
			if (!card) return err("Card not found.");

			const targetColumn = await db.column.findFirst({
				where: { boardId: card.column.boardId, name: { equals: columnName } },
			});
			if (!targetColumn) {
				const cols = await db.column.findMany({
					where: { boardId: card.column.boardId },
					select: { name: true },
				});
				return err(
					`Column "${columnName}" not found.`,
					`Available: ${cols.map((c) => c.name).join(", ")}`
				);
			}

			const cardsInTarget = await db.card.findMany({
				where: { columnId: targetColumn.id },
				orderBy: { position: "asc" },
			});

			const filtered = cardsInTarget.filter((c) => c.id !== cardId);
			const insertAt =
				position !== undefined ? Math.min(position, filtered.length) : filtered.length;
			filtered.splice(insertAt, 0, card);

			const updates = filtered.map((c, i) =>
				db.card.update({
					where: { id: c.id },
					data: {
						columnId: targetColumn.id,
						position: i,
						...(c.id === cardId && { lastEditedBy: AGENT_NAME }),
					},
				})
			);
			await db.$transaction(updates);

			const fromCol = card.column.name;
			if (fromCol !== columnName) {
				await db.activity.create({
					data: {
						cardId,
						action: "moved",
						details: `Moved from "${fromCol}" to "${columnName}"`,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				});
			}

			return ok({
				id: cardId,
				ref: `#${card.number}`,
				title: card.title,
				from: fromCol,
				to: columnName,
			});
		});
	})
);

server.registerTool(
	"addComment",
	{
		title: "Add Comment",
		description: "Add a comment to a card.",
		inputSchema: {
			cardId: z.string().describe("Card UUID or #number"),
			content: z.string().describe("Comment text (markdown)"),
		},
	},
	wrapEssentialHandler("addComment", async ({ cardId: cardRef, content }) => {
		return safeExecute(async () => {
			const resolved = await resolveCardRef(cardRef);
			if (!resolved.ok) return err(resolved.message);
			const cardId = resolved.id;

			const card = await db.card.findUnique({ where: { id: cardId } });
			if (!card) return err("Card not found.");

			const comment = await db.comment.create({
				data: { cardId, content, authorType: "AGENT", authorName: AGENT_NAME },
			});

			return ok({ id: comment.id, ref: `#${card.number}`, created: true });
		});
	})
);

server.registerTool(
	"searchCards",
	{
		title: "Search Cards",
		description:
			"Search cards by title/description across all projects. Tag filter is exact-match.",
		inputSchema: {
			query: z.string().describe("Text to match in title and description"),
			tag: z.string().optional().describe("Exact tag match (e.g. 'bug')"),
		},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("searchCards", async ({ query, tag }) => {
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
				description: card.description ? card.description.slice(0, 200) + (card.description.length > 200 ? "…" : "") : "",
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
	})
);

server.registerTool(
	"getRoadmap",
	{
		title: "Get Roadmap",
		description:
			"Roadmap view: cards grouped by milestone and horizon. Includes blockedBy refs, assignee breakdown, and progress per milestone. Horizons: In Progress/Review=Now, Up Next=Next, Backlog=Later, Done=Done.",
		inputSchema: {
			boardId: z.string().describe("Board UUID"),
			format: z.enum(["json", "toon"]).default("toon").describe("Default 'toon'; use 'json' for raw"),
		},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("getRoadmap", async ({ boardId, format }) => {
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
									relationsTo: { where: { type: "blocks" }, select: { fromCard: { select: { number: true } } } },
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
						(r) => `#${r.fromCard.number}`,
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
					const blocked = cards.filter((c) => c.blockedBy.length > 0 && c.horizon !== "done").length;
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
	})
);

// ─── Onboarding (Essential) ──────────────────────────────────────────

server.registerTool(
	"checkOnboarding",
	{
		title: "Check Onboarding",
		description:
			"Detect DB state and get onboarding guidance. Call at session start if no board ID is known.",
		inputSchema: {},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("checkOnboarding", async () => {
		const [projectCount, boardCount, cardCount, handoffCount, projects] = await Promise.all([
			db.project.count(),
			db.board.count(),
			db.card.count(),
			db.sessionHandoff.count(),
			db.project.findMany({
				orderBy: { createdAt: "desc" },
				include: {
					boards: {
						select: {
							id: true,
							name: true,
							columns: {
								select: { name: true, _count: { select: { cards: true } } },
								orderBy: { position: "asc" },
							},
						},
					},
				},
			}),
		]);

		let state: "empty" | "existing" | "returning";
		if (projectCount === 0) {
			state = "empty";
		} else if (handoffCount > 0) {
			state = "returning";
		} else {
			state = "existing";
		}

		const offerSampleProject = state === "empty" || (state === "existing" && cardCount === 0);

		const options: Array<{ action: string; description: string }> = [];
		if (offerSampleProject) {
			options.push(
				{ action: "runTool({ tool: 'seedTutorial' })", description: "Create tutorial project with 17 example cards" },
				{ action: "onboarding prompt (quickstart)", description: "Set up your own project" },
				{ action: "onboarding prompt (tutorial)", description: "Step-by-step guided walkthrough" },
			);
		}
		if (state === "returning") {
			options.push(
				{ action: "Use MCP prompt 'resume-session' with { boardId } — or call runTool({ tool: 'loadHandoff', params: { boardId } }) as a tool-based alternative", description: "Continue where you left off" },
			);
		} else if (state === "existing") {
			options.push(
				{ action: "Use MCP prompt 'resume-session' with { boardId } — or call runTool({ tool: 'loadHandoff', params: { boardId } }) as a tool-based alternative", description: "Start working on a board" },
			);
		}

		// Check staleness across all projects
		const allWarnings = (
			await Promise.all(projects.map((p) => checkStaleness(p.id)))
		).flat();
		const stalenessWarnings = allWarnings.length > 0 ? formatStalenessWarnings(allWarnings) : null;

		return ok({
			state,
			stats: { projects: projectCount, boards: boardCount, cards: cardCount, handoffs: handoffCount },
			toolArchitecture: {
				essential: "10 tools are always visible: getBoard, createCard, updateCard, moveCard, addComment, searchCards, getRoadmap, checkOnboarding, getTools, runTool.",
				extended: `${getRegistrySize()} additional tools are behind getTools/runTool. Call getTools() to see categories, getTools({ category }) to list tools, runTool({ tool, params }) to execute.`,
				prompts: "8 MCP prompts are available (resume-session, end-session, onboarding, deep-dive, sprint-review, plan-work, setup-project, holistic-review). Prompts are invoked via the MCP prompts/get protocol, not via runTool.",
			},
			offerSampleProject,
			projects: projects.map((p) => ({
				id: p.id,
				name: p.name,
				...(p.projectPrompt ? { projectPrompt: p.projectPrompt } : {}),
				boards: p.boards.map((b) => ({
					id: b.id,
					name: b.name,
					columns: b.columns.map((c) => ({ name: c.name, cards: c._count.cards })),
				})),
			})),
			options,
			stalenessWarnings,
		});
	})
);

// ─── Meta-Tools (Essential + Catalog pattern) ──────────────────────

server.registerTool(
	"getTools",
	{
		title: "Get Tools",
		description: `Browse ${getRegistrySize()} extended tools. No args=categories, category=list tools, tool=full schema.`,
		inputSchema: {
			category: z.string().optional().describe("e.g. 'cards', 'milestones', 'notes'"),
			tool: z.string().optional().describe("Tool name for full parameter schema"),
		},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("getTools", async ({ category, tool }) => {
		const result = getToolCatalog({ category, tool });
		if (!result)
			return err(
				`Tool "${tool}" not found.`,
				"Call getTools() with no args to see all categories."
			);
		return ok(result);
	})
);

server.registerTool(
	"runTool",
	{
		title: "Run Tool",
		description: "Execute an extended tool by name with validated parameters.",
		inputSchema: {
			tool: z.string().describe("e.g. 'bulkCreateCards', 'listActivity', 'createNote'"),
			params: z
				.record(z.string(), z.unknown())
				.default({})
				.describe("Tool parameters — use getTools({ tool: 'toolName' }) to see required params and their types"),
		},
	},
	async ({ tool, params }) => {
		return executeTool(tool, params);
	}
);

// ─── Prompts ───────────────────────────────────────────────────────

server.registerPrompt(
	"resume-session",
	{
		title: "Resume Session",
		description: "Load board state + last handoff + diff. Use at the start of every conversation.",
		argsSchema: {
			boardId: z.string().describe("Board ID"),
		},
	},
	async ({ boardId }) => {
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
								checklists: true,
								_count: { select: { comments: true } },
								relationsTo: { where: { type: "blocks" }, select: { id: true } },
							},
						},
					},
				},
			},
		});

		if (!board) {
			const projectCount = await db.project.count();
			const hint =
				projectCount === 0
					? "Board not found and the database is empty. Call `checkOnboarding` to get started — it will detect your setup state and suggest next steps."
					: "Board not found. Use `runTool({ tool: 'listBoards' })` to find available boards.";
			return {
				messages: [{ role: "user" as const, content: { type: "text" as const, text: hint } }],
			};
		}

		// Last handoff
		const lastHandoff = await db.sessionHandoff.findFirst({
			where: { boardId },
			orderBy: { createdAt: "desc" },
		});

		// Board diff since last handoff
		let diffSummary = "";
		if (lastHandoff) {
			const cardIds = board.columns.flatMap((c) => c.cards.map((card) => card.id));
			const recentActivity = await db.activity.findMany({
				where: { cardId: { in: cardIds }, createdAt: { gt: lastHandoff.createdAt } },
				include: { card: { select: { number: true } } },
				orderBy: { createdAt: "desc" },
				take: 20,
			});
			if (recentActivity.length > 0) {
				diffSummary =
					`\n## Changes since last session (${recentActivity.length})\n` +
					recentActivity
						.slice(0, 10)
						.map((a) => `- #${a.card.number}: ${a.details ?? a.action}`)
						.join("\n");
			}
		}

		const inProgress = board.columns.find((c) => hasRole(c, "active"))?.cards ?? [];
		const todo = board.columns.find((c) => hasRole(c, "todo"))?.cards ?? [];
		const blocked = board.columns.flatMap((c) => c.cards).filter((c) => c.relationsTo.length > 0);

		// Detect available features
		const features = await detectFeatures();
		const missingFeatures = Object.entries(features)
			.filter(([key, val]) => key !== "version" && val === false)
			.map(([key]) => key);

		const lines = [
			`# Session — ${board.project.name} / ${board.name}`,
			`Board: \`${boardId}\` | Project: \`${board.project.id}\` | Schema v${features.version}`,
		];

		if (missingFeatures.length > 0) {
			lines.push(
				"",
				`> **Migration needed**: Run \`npm run db:push\` to enable: ${missingFeatures.join(", ")}`,
				"> Some tools (relations, decisions, handoffs, git links, scratchpad) may not work until schema is updated."
			);
		}

		if (lastHandoff) {
			const handoffData = {
				agent: lastHandoff.agentName,
				summary: lastHandoff.summary,
				nextSteps: JSON.parse(lastHandoff.nextSteps) as string[],
				blockers: JSON.parse(lastHandoff.blockers) as string[],
			};
			lines.push(
				"",
				"## Last Handoff",
				`Agent: ${handoffData.agent} | ${lastHandoff.createdAt.toISOString()}`
			);
			if (handoffData.summary) lines.push(handoffData.summary);
			if (handoffData.nextSteps.length > 0) {
				lines.push("**Next steps:**");
				for (const s of handoffData.nextSteps) lines.push(`- ${s}`);
			}
			if (handoffData.blockers.length > 0) {
				lines.push("**Blockers:**");
				for (const b of handoffData.blockers) lines.push(`- ${b}`);
			}
		}

		if (diffSummary) lines.push(diffSummary);

		lines.push("", `## In Progress (${inProgress.length})`);
		for (const c of inProgress) {
			const done = c.checklists.filter((i) => i.completed).length;
			const total = c.checklists.length;
			lines.push(
				`- #${c.number} ${c.title}${total > 0 ? ` [${done}/${total}]` : ""} (${c.priority})`
			);
		}

		if (todo.length > 0) {
			lines.push("", `## Ready (${todo.length})`);
			for (const c of todo.slice(0, 5)) lines.push(`- #${c.number} ${c.title} (${c.priority})`);
			if (todo.length > 5) lines.push(`  ...and ${todo.length - 5} more`);
		}

		if (blocked.length > 0) {
			lines.push("", `## Blocked (${blocked.length})`);
			for (const c of blocked) lines.push(`- #${c.number} ${c.title}`);
		}

		const text = lines.join("\n");
		const tokens = Math.ceil(text.length / 4);
		lines.push(
			"",
			`---`,
			`~${tokens} tokens | Use \`getFocusContext\` for deep work. Call \`end-session\` before wrapping up.`
		);

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: lines.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"end-session",
	{
		title: "End Session",
		description: "Review board accuracy, save handoff, and clean up before ending a conversation.",
		argsSchema: {
			boardId: z.string().describe("Board ID"),
		},
	},
	async ({ boardId }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: { select: { name: true } },
				columns: {
					orderBy: { position: "asc" },
					include: {
						cards: {
							orderBy: { position: "asc" },
							include: { checklists: { select: { text: true, completed: true } } },
						},
					},
				},
			},
		});

		if (!board) {
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};
		}

		const inProgress = board.columns.find((c) => hasRole(c, "active"))?.cards ?? [];

		const prompt = [
			`# End Session — ${board.project.name} / ${board.name}`,
			"",
			"Before wrapping up, complete this checklist:",
			"",
			"## 1. Review board accuracy",
			"Check each In Progress card — is it still accurate?",
			...inProgress.map((c) => {
				const done = c.checklists.filter((i) => i.completed).length;
				const total = c.checklists.length;
				return `- #${c.number} ${c.title}${total > 0 ? ` [${done}/${total}]` : ""}`;
			}),
			"",
			"## 2. Move completed cards",
			"Any cards fully done? → `moveCard` to Done",
			"",
			"## 3. Update checklists",
			"Mark completed items → `runTool('toggleChecklistItem', ...)`",
			"",
			"## 4. Save handoff",
			"```",
			`runTool('saveHandoff', {`,
			`  boardId: '${boardId}',`,
			`  workingOn: ['what you worked on'],`,
			`  findings: ['key findings'],`,
			`  nextSteps: ['what to do next'],`,
			`  blockers: ['any blockers'],`,
			`  summary: 'Brief summary of this session'`,
			`})`,
			"```",
			"",
			"## 5. Add context comments",
			"Add comments on cards with important context for the next session.",
			"",
			"## 6. Report summary",
			"Tell the user what was accomplished.",
		];

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: prompt.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"deep-dive",
	{
		title: "Deep Dive",
		description:
			"Load focused context for deep work on a specific card. Returns card + relations + decisions + related cards.",
		argsSchema: {
			boardId: z.string().describe("Board ID"),
			cardId: z.string().describe("Card ID or #number"),
		},
	},
	async ({ boardId, cardId: cardRef }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			select: { projectId: true, name: true },
		});
		if (!board)
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};

		const cardResolved = await resolveCardRef(cardRef, board.projectId);
		if (!cardResolved.ok)
			return {
				messages: [
					{
						role: "user" as const,
						content: { type: "text" as const, text: `Card "${cardRef}" not found.` },
					},
				],
			};

		const prompt = [
			`# Deep Dive — ${board.name}`,
			"",
			`Load full context for card \`${cardRef}\`:`,
			"```",
			`runTool('getFocusContext', { boardId: '${boardId}', cardId: '${cardRef}' })`,
			"```",
			"",
			"Then work on the card. When done, update checklist items, add comments with findings, and move the card if complete.",
		];

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: prompt.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"sprint-review",
	{
		title: "Sprint Review",
		description: "Review board progress: velocity, milestone status, stale cards, blockers.",
		argsSchema: {
			boardId: z.string().describe("Board ID"),
			since: z
				.string()
				.describe("ISO datetime or relative (e.g. '7 days ago')")
				.default(new Date(Date.now() - 7 * 86400000).toISOString()),
		},
	},
	async ({ boardId, since }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: {
					include: {
						milestones: {
							orderBy: { position: "asc" },
							include: { _count: { select: { cards: true } } },
						},
					},
				},
				columns: {
					orderBy: { position: "asc" },
					include: {
						cards: {
							include: {
								checklists: { select: { completed: true } },
								relationsTo: {
									where: { type: "blocks" },
									select: { fromCard: { select: { number: true, title: true } } },
								},
							},
						},
					},
				},
			},
		});

		if (!board)
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};

		const sinceDate = new Date(since);
		const allCards = board.columns.flatMap((c) => c.cards);
		const cardIds = allCards.map((c) => c.id);

		// Completed since
		const completedActivities = await db.activity.findMany({
			where: {
				cardId: { in: cardIds },
				action: "moved",
				details: { contains: '"Done"' },
				createdAt: { gt: sinceDate },
			},
			select: { cardId: true },
		});
		const completedCount = new Set(completedActivities.map((a) => a.cardId)).size;

		// Stale cards (not updated in 7+ days, not in Done)
		const staleThreshold = new Date(Date.now() - 7 * 86400000);
		const doneCol = board.columns.find((c) => hasRole(c, "done"));
		const stale = allCards.filter(
			(c) => c.columnId !== doneCol?.id && new Date(c.updatedAt) < staleThreshold
		);

		// Blocked cards
		const blocked = allCards.filter((c) => c.relationsTo.length > 0);

		const daysDiff = Math.max(1, Math.ceil((Date.now() - sinceDate.getTime()) / 86400000));

		const lines = [
			`# Sprint Review — ${board.project.name} / ${board.name}`,
			`Period: ${sinceDate.toLocaleDateString()} → now (${daysDiff} days)`,
			"",
			`## Velocity`,
			`Cards completed: ${completedCount} (~${(completedCount / daysDiff).toFixed(1)}/day)`,
			"",
			`## Milestones`,
			...board.project.milestones.map((ms) => {
				return `- ${ms.name}: ${ms._count.cards} cards${ms.targetDate ? ` (target: ${ms.targetDate.toLocaleDateString()})` : ""}`;
			}),
			"",
		];

		if (blocked.length > 0) {
			lines.push(`## Blocked (${blocked.length})`);
			for (const c of blocked) {
				const blockers = c.relationsTo.map((r) => `#${r.fromCard.number}`).join(", ");
				lines.push(`- #${c.number} ${c.title} ← blocked by ${blockers}`);
			}
			lines.push("");
		}

		if (stale.length > 0) {
			lines.push(`## Stale Cards (${stale.length})`);
			for (const c of stale.slice(0, 10)) {
				const days = Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 86400000);
				lines.push(`- #${c.number} ${c.title} (${days}d stale)`);
			}
			if (stale.length > 10) lines.push(`  ...and ${stale.length - 10} more`);
			lines.push("");
		}

		lines.push(
			"## Actions",
			"Review stale cards — move to Parking Lot or update. Unblock blocked cards. Check milestone progress."
		);

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: lines.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"plan-work",
	{
		title: "Plan Work",
		description:
			"Create a structured plan for upcoming work. Returns a template you can fill in and execute with bulkCreateCards.",
		argsSchema: {
			boardId: z.string().describe("Board ID to plan for"),
		},
	},
	async ({ boardId }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: true,
				columns: { select: { name: true } },
			},
		});

		if (!board) {
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};
		}

		const columnNames = board.columns.map((c) => c.name).join(", ");

		const template = [
			`# Planning — ${board.project.name} / ${board.name}`,
			"",
			`Columns: ${columnNames}`,
			`Board ID: \`${boardId}\` | Project ID: \`${board.project.id}\``,
			"",
			"Use `runTool('bulkCreateCards', {...})` to batch-create cards.",
			"Use `runTool('addChecklistItem', {...})` to add sub-tasks.",
			"",
			"Templates via `runTool('createCardFromTemplate', {...})`:",
			"Bug Report, Feature, Spike / Research, Tech Debt, Epic",
		];

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: template.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"setup-project",
	{
		title: "Setup Project",
		description:
			"Guide for setting up a new project on the tracker board. Use this when connecting a project for the first time.",
		argsSchema: {
			projectName: z.string().describe("Name of the project to set up"),
		},
	},
	async ({ projectName }) => {
		const existing = await db.project.findFirst({
			where: { name: { equals: projectName } },
			include: { boards: { include: { columns: true } } },
		});

		const instructions = [`# Project Setup — ${projectName}`, ""];

		if (existing) {
			instructions.push(
				`Project "${projectName}" already exists (ID: \`${existing.id}\`).`,
				existing.boards.length > 0
					? `It has ${existing.boards.length} board(s): ${existing.boards.map((b) => `"${b.name}" (\`${b.id}\`)`).join(", ")}`
					: "It has no boards yet — create one with a descriptive name.",
				"",
				"Skip to Step 3 below to populate the board."
			);
		} else {
			instructions.push(
				"## Step 1: Create the project",
				"",
				`Use \`runTool('createProject', { name: "${projectName}", description: "..." })\``,
				"This creates a default board with standard columns (Backlog, Up Next, In Progress, Review, Done, Parking Lot).",
				""
			);
		}

		instructions.push(
			"",
			"## Step 2: Populate the board",
			"",
			"Read the project's README, CLAUDE.md, and `git log --oneline -20` to understand state.",
			"Then create cards: Completed→Done, Active→In Progress, Next→Up Next, Future→Backlog, Ideas→Parking Lot.",
			"Use `runTool('bulkCreateCards', {...})` to batch-create.",
			"",
			"## Step 3: Add to the project's CLAUDE.md",
			"",
			"```",
			"## Project Tracking",
			"This project uses the `project-tracker` MCP tools.",
			"Use the `resume-session` prompt with the board ID at the start of each conversation.",
			"Use `end-session` before wrapping up to save handoff for the next session.",
			'Reference cards by #number (e.g. "working on #7").',
			"```",
			"",
			"Keep cards PR-sized. Use tags (`feature:X`, `bug`, `debt`). Use `getTools()` to discover all tools."
		);

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: instructions.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"holistic-review",
	{
		title: "Holistic Review",
		description:
			"Review the entire board against the actual codebase. Syncs board state with reality.",
		argsSchema: {
			boardId: z.string().describe("Board ID to review"),
		},
	},
	async ({ boardId }) => {
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
								checklists: true,
								milestone: { select: { id: true, name: true } },
								_count: { select: { comments: true } },
							},
						},
					},
				},
			},
		});

		if (!board) {
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};
		}

		const boardState = board.columns.map((col) => ({
			column: col.name,
			cards: col.cards.map((c) => ({
				ref: `#${c.number}`,
				title: c.title,
				description: c.description?.substring(0, 200),
				priority: c.priority,
				tags: JSON.parse(c.tags),
				milestone: c.milestone?.name ?? null,
				checklist: `${c.checklists.filter((i) => i.completed).length}/${c.checklists.length}`,
				assignee: c.assignee,
			})),
		}));

		const milestones = board.project.milestones.map((m) => ({
			name: m.name,
			targetDate: m.targetDate,
			description: m.description,
		}));

		// TOON encoding for compact board state (~40% token savings)
		const boardStateToon = toToon(boardState);

		const prompt = [
			`# Holistic Board Review — ${board.project.name} / ${board.name}`,
			"",
			`Board ID: \`${boardId}\` | Project ID: \`${board.project.id}\``,
			"",
			"## Current Board State (TOON encoded)",
			"```",
			boardStateToon,
			"```",
			"",
			milestones.length > 0 ? `## Milestones\n${JSON.stringify(milestones, null, 2)}\n` : "",
			"## Instructions",
			"",
			"Review the codebase thoroughly and compare it against the board state above. For each finding, take action:",
			"",
			"1. **Untracked work**: If you find code not represented by any card → `createCard`",
			"2. **Stale cards**: If a card is clearly done in code but not in Done column → `moveCard`",
			"3. **Outdated descriptions**: If a card doesn't match code reality → `updateCard`",
			"4. **Missing context**: Architecture decisions or important context → `addComment`",
			"5. **Priority misalignment**: If priorities don't reflect codebase needs → `updateCard`",
			"6. **Milestone alignment**: Ungrouped cards that belong to a milestone → `runTool('setMilestone', ...)`",
			"7. **Checklist updates**: Items completed in code → `runTool('toggleChecklistItem', ...)`",
			"",
			"Explore codebase structure and key files, compare against board, take corrective actions, then summarize changes.",
		];

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: prompt.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"onboarding",
	{
		title: "Onboarding",
		description:
			"Guide a new user through setup. 'tutorial' seeds a sample project to explore; 'quickstart' helps create their first real project.",
		argsSchema: {
			mode: z
				.enum(["tutorial", "quickstart"])
				.describe(
					"'tutorial' creates a sample project to explore; 'quickstart' starts a real project"
				),
		},
	},
	async ({ mode }) => {
		if (mode === "tutorial") {
			const result = await seedTutorialProject(db);
			if (result) {
				const text = [
					"# Welcome to Project Tracker! 🎓",
					"",
					`I've created a tutorial project for you to explore. Use the **resume-session** prompt with boardId \`${result.boardId}\` to see the board.`,
					"",
					"## What's inside",
					"",
					'The "Learn Project Tracker" project has **17 cards** across all 6 columns, each teaching a different feature:',
					"",
					"- **Cards & columns** — how tasks flow from Backlog → Done",
					"- **Checklists** — break cards into subtasks (card #6 has a partial checklist)",
					"- **Milestones** — group related cards (cards #10, #11)",
					"- **Card relations** — blocking dependencies (#8 blocks #7)",
					"- **Comments** — discussion threads on cards",
					"- **Decision records** — document architectural choices",
					"- **Session handoffs** — continuity between agent sessions",
					"- **Notes** — project-level knowledge base",
					"- **Tags & priorities** — organize and filter cards",
					"- **Parking Lot** — ideas you're not ready to work on",
					"",
					"## Try these",
					"",
					`1. \`resume-session\` with boardId \`${result.boardId}\` to see the full board`,
					"2. Open a card to read its description — each one explains the feature",
					"3. Try moving a card, adding a checklist item, or creating a comment",
					"4. Use `getTools` to discover all available tools",
				].join("\n");
				return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
			}
			// Already exists
			const existing = await db.project.findUnique({
				where: { slug: "learn-project-tracker" },
				include: { boards: { take: 1 } },
			});
			const boardId = existing?.boards[0]?.id ?? "unknown";
			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: `Tutorial project already exists. Use **resume-session** with boardId \`${boardId}\` to explore it.`,
						},
					},
				],
			};
		}

		// quickstart mode
		const text = [
			"# Quick Start — Create Your First Project",
			"",
			"Let's set up a real project. I need a few details:",
			"",
			'1. **Project name** — What are you building? (e.g. "My App", "Website Redesign")',
			'2. **Board name** — Optional, defaults to "Main Board"',
			"3. **Initial columns** — A board starts with: Backlog, Up Next, In Progress, Review, Done, Parking Lot",
			"",
			"Once you tell me the project name, I'll:",
			"- Create the project with `createProject`",
			"- The board and columns are created automatically",
			"- Then use `resume-session` to load the board",
			"",
			"## After setup",
			"",
			"- **Create cards**: describe tasks and I'll create them with `createCard` or `bulkCreateCards`",
			"- **Organize**: set priorities, add tags, group into milestones",
			"- **Track progress**: move cards through columns, check off subtasks",
			"- **Handoffs**: I'll save a session summary when we're done so the next session picks up where we left off",
			"",
			"What's your project name?",
		].join("\n");
		return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
	}
);

// ─── Resources ────────────────────────────────────────────────────
registerResources(server);

// ─── Start ──────────────────────────────────────────────────────────

async function main() {
	// Initialize FTS5 virtual table for cross-source knowledge search
	await initFts5().catch((e) => console.error("FTS5 init failed (non-fatal):", e));

	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(
		`Project Tracker MCP v2.1 — 10 essential tools + ${getRegistrySize()} extended tools via getTools/runTool`
	);
}

main().catch((error) => {
	console.error("Failed to start MCP server:", error);
	process.exit(1);
});
