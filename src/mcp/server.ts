import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { db } from "./db.js";

const server = new McpServer({
	name: "project-tracker",
	version: "1.0.0",
});

/**
 * Resolve a card reference — accepts either a UUID or "#number" (requires projectId for number lookup).
 */
async function resolveCardId(ref: string, projectId?: string): Promise<string | null> {
	// If it looks like a UUID, use directly
	if (ref.includes("-") && ref.length > 10) return ref;

	// Strip leading # if present
	const num = Number.parseInt(ref.replace(/^#/, ""), 10);
	if (Number.isNaN(num)) return null;

	// If projectId provided, look up by project + number
	if (projectId) {
		const card = await db.card.findUnique({
			where: { projectId_number: { projectId, number: num } },
			select: { id: true },
		});
		return card?.id ?? null;
	}

	// Otherwise search across all projects (less precise but convenient)
	const card = await db.card.findFirst({
		where: { number: num },
		select: { id: true },
	});
	return card?.id ?? null;
}

// ─── Discovery & Context ────────────────────────────────────────────

server.tool(
	"listProjects",
	"List all projects in the tracker",
	async () => {
		const projects = await db.project.findMany({
			orderBy: { createdAt: "desc" },
			include: { _count: { select: { boards: true } } },
		});
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						projects.map((p) => ({
							id: p.id,
							name: p.name,
							slug: p.slug,
							description: p.description,
							boardCount: p._count.boards,
						})),
						null,
						2,
					),
				},
			],
		};
	},
);

server.tool(
	"getBoard",
	"Get full board state including all columns, cards, and checklist progress. Use this at the start of a conversation to understand current project state.",
	{ boardId: z.string().describe("Board ID (UUID)") },
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
								checklists: { orderBy: { position: "asc" } },
								_count: { select: { comments: true } },
							},
						},
					},
				},
			},
		});

		if (!board) {
			return { content: [{ type: "text" as const, text: "Board not found." }], isError: true };
		}

		const summary = {
			id: board.id,
			name: board.name,
			project: board.project.name,
			columns: board.columns.map((col) => ({
				id: col.id,
				name: col.name,
				description: col.description,
				isParking: col.isParking,
				cards: col.cards.map((card) => ({
					id: card.id,
					number: card.number,
					ref: `#${card.number}`,
					title: card.title,
					description: card.description,
					priority: card.priority,
					tags: JSON.parse(card.tags),
					assignee: card.assignee,
					createdBy: card.createdBy,
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
				})),
			})),
		};

		return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
	},
);

server.tool(
	"listBoards",
	"List all boards for a project",
	{ projectId: z.string().describe("Project ID (UUID)") },
	async ({ projectId }) => {
		const boards = await db.board.findMany({
			where: { projectId },
			orderBy: { createdAt: "desc" },
			include: { _count: { select: { columns: true } } },
		});
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						boards.map((b) => ({
							id: b.id,
							name: b.name,
							description: b.description,
						})),
						null,
						2,
					),
				},
			],
		};
	},
);

server.tool(
	"searchCards",
	"Search cards across all projects by title, description, or tag",
	{
		query: z.string().describe("Search text to match against card title or description"),
		tag: z.string().optional().describe("Filter by tag (exact match)"),
	},
	async ({ query, tag }) => {
		const cards = await db.card.findMany({
			where: {
				OR: [
					{ title: { contains: query } },
					{ description: { contains: query } },
				],
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
			description: card.description,
			priority: card.priority,
			tags: JSON.parse(card.tags),
			column: card.column.name,
			board: card.column.board.name,
			project: card.column.board.project.name,
		}));

		if (tag) {
			results = results.filter((r) => r.tags.includes(tag));
		}

		return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
	},
);

// ─── Card Management ────────────────────────────────────────────────

server.tool(
	"createCard",
	"Create a new card in a column. Use columnName to specify the column by name (e.g. 'In Progress') instead of ID.",
	{
		boardId: z.string().describe("Board ID (UUID)"),
		columnName: z.string().describe("Column name (e.g. 'To Do', 'In Progress', 'Backlog')"),
		title: z.string().describe("Card title"),
		description: z.string().optional().describe("Card description"),
		priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE").describe("Priority level"),
		tags: z.array(z.string()).default([]).describe("Tags (e.g. ['bug', 'feature:auth'])"),
		assignee: z.enum(["HUMAN", "AGENT"]).optional().describe("Who is assigned"),
	},
	async ({ boardId, columnName, title, description, priority, tags, assignee }) => {
		const column = await db.column.findFirst({
			where: {
				boardId,
				name: { equals: columnName },
			},
		});

		if (!column) {
			const columns = await db.column.findMany({
				where: { boardId },
				select: { name: true },
			});
			return {
				content: [
					{
						type: "text" as const,
						text: `Column "${columnName}" not found. Available columns: ${columns.map((c) => c.name).join(", ")}`,
					},
				],
				isError: true,
			};
		}

		// Get projectId from board
		const board = await db.board.findUnique({ where: { id: boardId }, select: { projectId: true } });
		if (!board) {
			return { content: [{ type: "text" as const, text: "Board not found." }], isError: true };
		}

		const maxPosition = await db.card.aggregate({
			where: { columnId: column.id },
			_max: { position: true },
		});

		// Assign next card number
		const project = await db.project.update({
			where: { id: board.projectId },
			data: { nextCardNumber: { increment: 1 } },
		});
		const cardNumber = project.nextCardNumber - 1;

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
				createdBy: "AGENT",
				position: (maxPosition._max.position ?? -1) + 1,
			},
		});

		await db.activity.create({
			data: {
				cardId: card.id,
				action: "created",
				details: `Card #${cardNumber} "${title}" created in ${columnName}`,
				actorType: "AGENT",
				actorName: "Claude",
			},
		});

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ id: card.id, number: cardNumber, ref: `#${cardNumber}`, title: card.title, column: columnName }, null, 2),
				},
			],
		};
	},
);

server.tool(
	"updateCard",
	"Update a card's title, description, priority, tags, or assignee",
	{
		cardId: z.string().describe("Card ref — UUID or #number (e.g. '#7')"),
		title: z.string().optional().describe("New title"),
		description: z.string().optional().describe("New description"),
		priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional().describe("New priority"),
		tags: z.array(z.string()).optional().describe("Replace all tags"),
		assignee: z.enum(["HUMAN", "AGENT"]).nullable().optional().describe("New assignee (null to unassign)"),
	},
	async ({ cardId: cardRef, title, description, priority, tags, assignee }) => {
		const cardId = await resolveCardId(cardRef);
		if (!cardId) {
			return { content: [{ type: "text" as const, text: `Card "${cardRef}" not found.` }], isError: true };
		}
		const existing = await db.card.findUnique({ where: { id: cardId } });
		if (!existing) {
			return { content: [{ type: "text" as const, text: "Card not found." }], isError: true };
		}

		const card = await db.card.update({
			where: { id: cardId },
			data: {
				title,
				description,
				priority,
				tags: tags ? JSON.stringify(tags) : undefined,
				assignee,
			},
		});

		return {
			content: [{ type: "text" as const, text: JSON.stringify({ id: card.id, title: card.title, updated: true }, null, 2) }],
		};
	},
);

server.tool(
	"moveCard",
	"Move a card to a different column by column name. Use this to update card status (e.g. move to 'In Progress' when starting work).",
	{
		cardId: z.string().describe("Card ref — UUID or #number (e.g. '#7')"),
		columnName: z.string().describe("Target column name (e.g. 'In Progress', 'Done')"),
		position: z.number().int().min(0).optional().describe("Position within column (0 = top). Defaults to bottom."),
	},
	async ({ cardId: cardRef, columnName, position }) => {
		const cardId = await resolveCardId(cardRef);
		if (!cardId) {
			return { content: [{ type: "text" as const, text: `Card "${cardRef}" not found.` }], isError: true };
		}
		const card = await db.card.findUnique({
			where: { id: cardId },
			include: { column: { include: { board: true } } },
		});
		if (!card) {
			return { content: [{ type: "text" as const, text: "Card not found." }], isError: true };
		}

		const targetColumn = await db.column.findFirst({
			where: {
				boardId: card.column.boardId,
				name: { equals: columnName },
			},
		});
		if (!targetColumn) {
			return {
				content: [{ type: "text" as const, text: `Column "${columnName}" not found.` }],
				isError: true,
			};
		}

		const cardsInTarget = await db.card.findMany({
			where: { columnId: targetColumn.id },
			orderBy: { position: "asc" },
		});

		const filtered = cardsInTarget.filter((c) => c.id !== cardId);
		const insertAt = position !== undefined ? Math.min(position, filtered.length) : filtered.length;
		filtered.splice(insertAt, 0, card);

		const updates = filtered.map((c, i) =>
			db.card.update({
				where: { id: c.id },
				data: { columnId: targetColumn.id, position: i },
			}),
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
					actorName: "Claude",
				},
			});
		}

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ id: cardId, title: card.title, from: fromCol, to: columnName }, null, 2),
				},
			],
		};
	},
);

server.tool(
	"deleteCard",
	"Delete a card from the board",
	{ cardId: z.string().describe("Card ref — UUID or #number (e.g. '#7')") },
	async ({ cardId: cardRef }) => {
		const cardId = await resolveCardId(cardRef);
		if (!cardId) {
			return { content: [{ type: "text" as const, text: `Card "${cardRef}" not found.` }], isError: true };
		}
		const card = await db.card.findUnique({ where: { id: cardId } });
		if (!card) {
			return { content: [{ type: "text" as const, text: "Card not found." }], isError: true };
		}
		await db.card.delete({ where: { id: cardId } });
		return {
			content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, title: card.title }, null, 2) }],
		};
	},
);

// ─── Progress Tracking ──────────────────────────────────────────────

server.tool(
	"addChecklistItem",
	"Add a checklist sub-task to a card",
	{
		cardId: z.string().describe("Card ref — UUID or #number (e.g. '#7')"),
		text: z.string().describe("Checklist item text"),
	},
	async ({ cardId: cardRef, text }) => {
		const cardId = await resolveCardId(cardRef);
		if (!cardId) {
			return { content: [{ type: "text" as const, text: `Card "${cardRef}" not found.` }], isError: true };
		}
		const card = await db.card.findUnique({ where: { id: cardId } });
		if (!card) {
			return { content: [{ type: "text" as const, text: "Card not found." }], isError: true };
		}

		const maxPos = await db.checklistItem.aggregate({
			where: { cardId },
			_max: { position: true },
		});

		const item = await db.checklistItem.create({
			data: {
				cardId,
				text,
				position: (maxPos._max.position ?? -1) + 1,
			},
		});

		return {
			content: [{ type: "text" as const, text: JSON.stringify({ id: item.id, text: item.text }, null, 2) }],
		};
	},
);

server.tool(
	"toggleChecklistItem",
	"Toggle a checklist item complete/incomplete",
	{
		checklistItemId: z.string().describe("Checklist item ID (UUID)"),
		completed: z.boolean().describe("Whether the item is completed"),
	},
	async ({ checklistItemId, completed }) => {
		const item = await db.checklistItem.findUnique({ where: { id: checklistItemId } });
		if (!item) {
			return { content: [{ type: "text" as const, text: "Checklist item not found." }], isError: true };
		}

		const updated = await db.checklistItem.update({
			where: { id: checklistItemId },
			data: { completed },
		});

		if (completed) {
			await db.activity.create({
				data: {
					cardId: item.cardId,
					action: "checklist_completed",
					details: `Completed: ${item.text}`,
					actorType: "AGENT",
					actorName: "Claude",
				},
			});
		}

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ id: updated.id, text: updated.text, completed: updated.completed }, null, 2),
				},
			],
		};
	},
);

server.tool(
	"addComment",
	"Add a comment/note to a card. Use this to record decisions, context, or blockers.",
	{
		cardId: z.string().describe("Card ref — UUID or #number (e.g. '#7')"),
		content: z.string().describe("Comment text"),
	},
	async ({ cardId: cardRef, content }) => {
		const cardId = await resolveCardId(cardRef);
		if (!cardId) {
			return { content: [{ type: "text" as const, text: `Card "${cardRef}" not found.` }], isError: true };
		}
		const card = await db.card.findUnique({ where: { id: cardId } });
		if (!card) {
			return { content: [{ type: "text" as const, text: "Card not found." }], isError: true };
		}

		const comment = await db.comment.create({
			data: {
				cardId,
				content,
				authorType: "AGENT",
				authorName: "Claude",
			},
		});

		return {
			content: [{ type: "text" as const, text: JSON.stringify({ id: comment.id, created: true }, null, 2) }],
		};
	},
);

// ─── Planning ───────────────────────────────────────────────────────

server.tool(
	"createProject",
	"Create a new project with a default board",
	{
		name: z.string().describe("Project name"),
		description: z.string().optional().describe("Project description"),
		boardName: z.string().default("Main Board").describe("Name for the default board"),
	},
	async ({ name, description, boardName }) => {
		let slug = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");

		const existing = await db.project.findUnique({ where: { slug } });
		if (existing) {
			slug = `${slug}-${Date.now().toString(36)}`;
		}

		const project = await db.project.create({
			data: {
				name,
				description,
				slug,
				boards: {
					create: {
						name: boardName,
						columns: {
							create: [
								{ name: "Backlog", description: "This hasn't been started", position: 0 },
								{ name: "To Do", description: "This is ready to be picked up", position: 1 },
								{ name: "In Progress", description: "This is actively being worked on", position: 2 },
								{ name: "Review", description: "This is in review", position: 3 },
								{ name: "Done", description: "This has been completed", position: 4 },
								{ name: "Parking Lot", description: "Ideas and items to revisit later", position: 5, isParking: true },
							],
						},
					},
				},
			},
			include: { boards: true },
		});

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							projectId: project.id,
							projectName: project.name,
							slug: project.slug,
							boardId: project.boards[0].id,
							boardName: project.boards[0].name,
						},
						null,
						2,
					),
				},
			],
		};
	},
);

server.tool(
	"createColumn",
	"Add a new column to a board",
	{
		boardId: z.string().describe("Board ID (UUID)"),
		name: z.string().describe("Column name"),
		description: z.string().optional().describe("Column description"),
	},
	async ({ boardId, name, description }) => {
		const maxPos = await db.column.aggregate({
			where: { boardId },
			_max: { position: true },
		});

		const column = await db.column.create({
			data: {
				boardId,
				name,
				description,
				position: (maxPos._max.position ?? -1) + 1,
			},
		});

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ id: column.id, name: column.name }, null, 2),
				},
			],
		};
	},
);

server.tool(
	"bulkCreateCards",
	"Create multiple cards at once. Useful for planning sessions.",
	{
		boardId: z.string().describe("Board ID (UUID)"),
		cards: z.array(
			z.object({
				columnName: z.string().describe("Column name"),
				title: z.string().describe("Card title"),
				description: z.string().optional(),
				priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE"),
				tags: z.array(z.string()).default([]),
			}),
		).describe("Array of cards to create"),
	},
	async ({ boardId, cards }) => {
		const board = await db.board.findUnique({ where: { id: boardId }, select: { projectId: true } });
		if (!board) {
			return { content: [{ type: "text" as const, text: "Board not found." }], isError: true };
		}

		const columns = await db.column.findMany({ where: { boardId } });
		const columnMap = new Map(columns.map((c) => [c.name.toLowerCase(), c]));

		const created: Array<{ id: string; number: number; ref: string; title: string; column: string }> = [];
		const errors: string[] = [];

		for (const cardInput of cards) {
			const col = columnMap.get(cardInput.columnName.toLowerCase());
			if (!col) {
				errors.push(`Column "${cardInput.columnName}" not found for card "${cardInput.title}"`);
				continue;
			}

			const maxPos = await db.card.aggregate({
				where: { columnId: col.id },
				_max: { position: true },
			});

			const project = await db.project.update({
				where: { id: board.projectId },
				data: { nextCardNumber: { increment: 1 } },
			});
			const cardNumber = project.nextCardNumber - 1;

			const card = await db.card.create({
				data: {
					columnId: col.id,
					projectId: board.projectId,
					number: cardNumber,
					title: cardInput.title,
					description: cardInput.description,
					priority: cardInput.priority,
					tags: JSON.stringify(cardInput.tags),
					createdBy: "AGENT",
					position: (maxPos._max.position ?? -1) + 1,
				},
			});

			await db.activity.create({
				data: {
					cardId: card.id,
					action: "created",
					details: `Card #${cardNumber} "${cardInput.title}" created in ${col.name}`,
					actorType: "AGENT",
					actorName: "Claude",
				},
			});

			created.push({ id: card.id, number: cardNumber, ref: `#${cardNumber}`, title: card.title, column: col.name });
		}

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ created, errors: errors.length > 0 ? errors : undefined }, null, 2),
				},
			],
		};
	},
);

server.tool(
	"createCardFromTemplate",
	"Create a card from a template (Bug Report, Feature, Spike, Tech Debt, Epic). Includes pre-filled description, tags, priority, and checklist.",
	{
		boardId: z.string().describe("Board ID (UUID)"),
		columnName: z.string().describe("Column name (e.g. 'To Do', 'Backlog')"),
		template: z.enum(["Bug Report", "Feature", "Spike / Research", "Tech Debt", "Epic"]).describe("Template name"),
		title: z.string().describe("Card title (appended to template prefix)"),
	},
	async ({ boardId, columnName, template, title }) => {
		const templates: Record<string, { prefix: string; description: string; priority: string; tags: string[]; checklist: string[] }> = {
			"Bug Report": {
				prefix: "Bug: ", description: "**What happened:**\n\n**Expected behavior:**\n\n**Steps to reproduce:**\n1. \n\n**Environment:**\n",
				priority: "HIGH", tags: ["bug"], checklist: ["Reproduce the issue", "Identify root cause", "Write fix", "Test fix"],
			},
			"Feature": {
				prefix: "Feature: ", description: "**Goal:**\n\n**Approach:**\n\n**Acceptance criteria:**\n- \n",
				priority: "MEDIUM", tags: ["feature"], checklist: ["Design approach", "Implement", "Add tests", "Update docs if needed"],
			},
			"Spike / Research": {
				prefix: "Spike: ", description: "**Question to answer:**\n\n**Time-box:** 2 hours\n\n**Options to evaluate:**\n1. \n\n**Decision:**\n",
				priority: "LOW", tags: ["spike"], checklist: ["Research options", "Prototype if needed", "Document findings", "Make recommendation"],
			},
			"Tech Debt": {
				prefix: "Refactor: ", description: "**Current state:**\n\n**Desired state:**\n\n**Why now:**\n",
				priority: "LOW", tags: ["debt"], checklist: ["Assess impact", "Refactor", "Verify no regressions"],
			},
			"Epic": {
				prefix: "Epic: ", description: "**Overview:**\n\n**Sub-tasks:**\nCreate individual cards for each sub-task.\n\n**Success criteria:**\n- \n",
				priority: "MEDIUM", tags: ["epic"], checklist: ["Break down into cards", "Prioritize sub-tasks", "Track progress"],
			},
		};

		const tmpl = templates[template];
		if (!tmpl) {
			return { content: [{ type: "text" as const, text: `Template "${template}" not found.` }], isError: true };
		}

		const column = await db.column.findFirst({ where: { boardId, name: { equals: columnName } } });
		if (!column) {
			return { content: [{ type: "text" as const, text: `Column "${columnName}" not found.` }], isError: true };
		}

		const board = await db.board.findUnique({ where: { id: boardId }, select: { projectId: true } });
		if (!board) {
			return { content: [{ type: "text" as const, text: "Board not found." }], isError: true };
		}

		const maxPos = await db.card.aggregate({ where: { columnId: column.id }, _max: { position: true } });
		const project = await db.project.update({ where: { id: board.projectId }, data: { nextCardNumber: { increment: 1 } } });
		const cardNumber = project.nextCardNumber - 1;
		const fullTitle = `${tmpl.prefix}${title}`;

		const card = await db.card.create({
			data: {
				columnId: column.id,
				projectId: board.projectId,
				number: cardNumber,
				title: fullTitle,
				description: tmpl.description,
				priority: tmpl.priority,
				tags: JSON.stringify(tmpl.tags),
				createdBy: "AGENT",
				position: (maxPos._max.position ?? -1) + 1,
			},
		});

		// Create checklist items
		for (let i = 0; i < tmpl.checklist.length; i++) {
			await db.checklistItem.create({
				data: { cardId: card.id, text: tmpl.checklist[i], position: i },
			});
		}

		await db.activity.create({
			data: {
				cardId: card.id,
				action: "created",
				details: `Card #${cardNumber} "${fullTitle}" created from ${template} template`,
				actorType: "AGENT",
				actorName: "Claude",
			},
		});

		return {
			content: [{
				type: "text" as const,
				text: JSON.stringify({ id: card.id, number: cardNumber, ref: `#${cardNumber}`, title: fullTitle, template, column: columnName, checklistItems: tmpl.checklist.length }, null, 2),
			}],
		};
	},
);

// ─── Prompts ───────────────────────────────────────────────────────

server.prompt(
	"start-session",
	"Get current project state and suggested next actions. Use this at the start of every conversation.",
	{ boardId: z.string().describe("Board ID to review") },
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
							},
						},
					},
				},
			},
		});

		if (!board) {
			return { messages: [{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } }] };
		}

		const inProgress = board.columns.find((c) => c.name === "In Progress")?.cards ?? [];
		const todo = board.columns.find((c) => c.name === "To Do")?.cards ?? [];
		const review = board.columns.find((c) => c.name === "Review")?.cards ?? [];
		const blocked = board.columns.flatMap((c) => c.cards).filter((card) => {
			const tags: string[] = JSON.parse(card.tags);
			return tags.includes("blocked");
		});

		const summary = [
			`# Session Start — ${board.project.name} / ${board.name}`,
			"",
			`## Currently In Progress (${inProgress.length})`,
			...inProgress.map((c) => {
				const done = c.checklists.filter((i) => i.completed).length;
				const total = c.checklists.length;
				const progress = total > 0 ? ` [${done}/${total}]` : "";
				return `- #${c.number} ${c.title}${progress} (${c.priority})`;
			}),
			"",
			`## Ready (To Do) (${todo.length})`,
			...todo.map((c) => `- #${c.number} ${c.title} (${c.priority})`),
			"",
			`## In Review (${review.length})`,
			...review.map((c) => `- #${c.number} ${c.title}`),
			"",
		];

		if (blocked.length > 0) {
			summary.push(`## Blocked (${blocked.length})`);
			for (const c of blocked) {
				summary.push(`- #${c.number} ${c.title}`);
			}
			summary.push("");
		}

		summary.push(
			"## Suggested Actions",
			"1. Continue work on any In Progress cards — check their checklists for next sub-task",
			"2. If In Progress is clear, pick the highest priority card from To Do",
			"3. Check Review cards if any need follow-up",
			blocked.length > 0 ? "4. Address blocked items if possible" : "",
			"",
			`Use \`getBoard\` with boardId "${boardId}" for full details including all columns.`,
		);

		return {
			messages: [{
				role: "user" as const,
				content: { type: "text" as const, text: summary.join("\n") },
			}],
		};
	},
);

server.prompt(
	"plan-work",
	"Create a structured plan for upcoming work. Returns a template you can fill in and execute with bulkCreateCards.",
	{ boardId: z.string().describe("Board ID to plan for") },
	async ({ boardId }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: true,
				columns: { select: { name: true } },
			},
		});

		if (!board) {
			return { messages: [{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } }] };
		}

		const columnNames = board.columns.map((c) => c.name).join(", ");

		const template = [
			`# Planning Session — ${board.project.name} / ${board.name}`,
			"",
			`Available columns: ${columnNames}`,
			`Board ID: ${boardId}`,
			"",
			"## Plan your work",
			"",
			"Break down the work into cards. For each card, specify:",
			"- **Column**: Which column it starts in (usually Backlog or To Do)",
			"- **Title**: Clear, actionable title",
			"- **Priority**: NONE, LOW, MEDIUM, HIGH, or URGENT",
			"- **Tags**: Relevant tags (feature:X, epic:Y, bug, etc.)",
			"",
			"Once you have your plan, use `bulkCreateCards` to create all cards at once.",
			"Then use `addChecklistItem` to add sub-tasks to individual cards.",
			"",
			"## Templates available",
			"Use `createCardFromTemplate` for common card types:",
			"- **Bug Report** — pre-filled with repro steps, checklist for fix workflow",
			"- **Feature** — goal, approach, acceptance criteria, implementation checklist",
			"- **Spike / Research** — question, time-box, options, decision template",
			"- **Tech Debt** — current state, desired state, refactor checklist",
			"- **Epic** — overview, sub-task breakdown, tracking checklist",
		];

		return {
			messages: [{
				role: "user" as const,
				content: { type: "text" as const, text: template.join("\n") },
			}],
		};
	},
);

server.prompt(
	"setup-project",
	"Guide for setting up a new project on the tracker board. Use this when connecting a project for the first time.",
	{
		projectName: z.string().describe("Name of the project to set up"),
	},
	async ({ projectName }) => {
		// Check if project already exists
		const existing = await db.project.findFirst({
			where: { name: { equals: projectName } },
			include: { boards: { include: { columns: true } } },
		});

		const instructions = [
			`# Project Setup — ${projectName}`,
			"",
		];

		if (existing) {
			instructions.push(
				`Project "${projectName}" already exists (ID: ${existing.id}).`,
				existing.boards.length > 0
					? `It has ${existing.boards.length} board(s): ${existing.boards.map((b) => `"${b.name}" (${b.id})`).join(", ")}`
					: "It has no boards yet — create one with a descriptive name.",
				"",
				"Skip to Step 3 below to populate the board.",
			);
		} else {
			instructions.push(
				"## Step 1: Create the project",
				"",
				`Use \`createProject\` with name "${projectName}" and a brief description.`,
				"This will create a default board with standard columns (Backlog, To Do, In Progress, Review, Done, Parking Lot).",
				"",
			);
		}

		instructions.push(
			"",
			"## Step 2: Understand the columns",
			"",
			"| Column | Purpose |",
			"|---|---|",
			"| **Backlog** | Known work, not yet prioritized. \"We should do this eventually.\" |",
			"| **To Do** | Prioritized and ready to pick up. The active work queue. |",
			"| **In Progress** | Actively being worked on. Limit to 2-3 cards. |",
			"| **Review** | Code written, needs human review or testing. |",
			"| **Done** | Shipped, merged, verified. |",
			"| **Parking Lot** | Ideas and maybes. Low-cost storage for future possibilities. |",
			"",
			"## Step 3: Populate the board",
			"",
			"Read the project's docs to understand current state:",
			"- README, CLAUDE.md, STATUS.md, PHASES.md, or similar planning docs",
			"- Recent git history (`git log --oneline -20`)",
			"- Any ADRs or decision records",
			"",
			"Then create cards based on what you find:",
			"",
			"1. **Completed work** → Done column (so the board reflects history)",
			"2. **Current/active work** → In Progress",
			"3. **Next priorities** → To Do (limit to what's realistically next)",
			"4. **Future work** → Backlog (organized by phase or area)",
			"5. **Ideas and open questions** → Parking Lot",
			"",
			"Use `bulkCreateCards` to create them efficiently. Add checklist items for sub-tasks on larger cards.",
			"",
			"## Step 4: Set up the project's CLAUDE.md",
			"",
			"Add this section to the project's CLAUDE.md so future conversations use the board:",
			"",
			"```",
			"## Project Tracking",
			"",
			"This project is tracked in the Project Tracker board.",
			"Use the `project-tracker` MCP tools to read and update the board.",
			`At the start of each conversation, use the \`start-session\` prompt with the board ID.`,
			"Reference cards by #number in conversation (e.g. \"working on #7\").",
			"```",
			"",
			"## Tips",
			"",
			"- Each card should be roughly one work session or PR in size",
			"- Use tags for cross-cutting concerns: `feature:auth`, `epic:v2`, `bug`, `debt`",
			"- Set priority on cards: URGENT and HIGH get attention first",
			"- Add checklist items for sub-tasks on larger cards",
			"- Use `createCardFromTemplate` for standard card types (Bug, Feature, Spike, Tech Debt, Epic)",
			"- Ask the user questions before creating cards — they may have context about priorities and scope",
		);

		return {
			messages: [{
				role: "user" as const,
				content: { type: "text" as const, text: instructions.join("\n") },
			}],
		};
	},
);

// ─── Start ──────────────────────────────────────────────────────────

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Project Tracker MCP server running on stdio");
}

main().catch((error) => {
	console.error("Failed to start MCP server:", error);
	process.exit(1);
});
