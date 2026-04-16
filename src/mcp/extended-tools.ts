import { z } from "zod";
import { db } from "./db.js";
import { registerExtendedTool } from "./tool-registry.js";
import { AGENT_NAME, getProjectIdForBoard, resolveCardRef, resolveOrCreateMilestone, ok, err, errWithToolHint, safeExecute } from "./utils.js";
import { toToon } from "./toon.js";

// ─── Discovery ──────────────────────────────────────────────────────

registerExtendedTool("listProjects", {
	category: "discovery",
	description: "List all projects with board and card counts.",
	parameters: z.object({}),
	annotations: { readOnlyHint: true },
	handler: () => safeExecute(async () => {
		const projects = await db.project.findMany({
			orderBy: { createdAt: "desc" },
			include: { _count: { select: { boards: true, cards: true } } },
		});
		return ok(projects.map((p) => ({
			id: p.id,
			name: p.name,
			slug: p.slug,
			description: p.description,
			boardCount: p._count.boards,
			cardCount: p._count.cards,
		})));
	}),
});

registerExtendedTool("listBoards", {
	category: "discovery",
	description: "List boards for a project with column summaries.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId }) => safeExecute(async () => {
		const boards = await db.board.findMany({
			where: { projectId: projectId as string },
			orderBy: { createdAt: "desc" },
			include: {
				columns: {
					select: { name: true, _count: { select: { cards: true } } },
					orderBy: { position: "asc" },
				},
			},
		});
		return ok(boards.map((b) => ({
			id: b.id,
			name: b.name,
			description: b.description,
			columns: b.columns.map((c) => ({ name: c.name, cards: c._count.cards })),
		})));
	}),
});

registerExtendedTool("updateProjectPrompt", {
	category: "discovery",
	description:
		"Set or clear a project's prompt — a short orientation paragraph auto-loaded at session start via checkOnboarding. Use this instead of per-account PROJECT_PROMPT.md files so all agents share one source of truth.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		prompt: z
			.string()
			.nullable()
			.describe("The prompt text to set, or null to clear it"),
	}),
	handler: ({ projectId, prompt }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({
				where: { id: projectId as string },
			});
			if (!project)
				return err(
					"Project not found.",
					"Use listProjects to find a valid projectId."
				);

			const updated = await db.project.update({
				where: { id: projectId as string },
				data: { projectPrompt: (prompt as string | null) ?? null },
			});

			return ok({
				projectId: updated.id,
				projectName: updated.name,
				projectPrompt: updated.projectPrompt,
				updated: true,
			});
		}),
});

// ─── Cards ──────────────────────────────────────────────────────────

registerExtendedTool("getCard", {
	category: "discovery",
	description: "Full card detail: description, checklist, comments, activity history.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		format: z.enum(["json", "toon"]).default("json").describe("'json' (default) or 'toon' (flat tabular shapes only)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ cardId, format }) => safeExecute(async () => {
		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;

		const card = await db.card.findUnique({
			where: { id },
			include: {
				checklists: { orderBy: { position: "asc" } },
				comments: { orderBy: { createdAt: "asc" } },
				activities: { orderBy: { createdAt: "desc" }, take: 20 },
				milestone: { select: { id: true, name: true } },
				column: { select: { name: true, board: { select: { id: true, name: true } } } },
				relationsFrom: { include: { toCard: { select: { id: true, number: true, title: true } } } },
				relationsTo: { include: { fromCard: { select: { id: true, number: true, title: true } } } },
				decisions: { select: { id: true, title: true, status: true }, orderBy: { createdAt: "desc" } },
			},
		});
		if (!card) return err("Card not found.");

		// Build relation groups
		const blocks = card.relationsFrom.filter((r) => r.type === "blocks").map((r) => ({ id: r.toCard.id, number: r.toCard.number, ref: `#${r.toCard.number}`, title: r.toCard.title }));
		const blockedBy = card.relationsTo.filter((r) => r.type === "blocks").map((r) => ({ id: r.fromCard.id, number: r.fromCard.number, ref: `#${r.fromCard.number}`, title: r.fromCard.title }));
		const relatedTo = [
			...card.relationsFrom.filter((r) => r.type === "related").map((r) => ({ id: r.toCard.id, number: r.toCard.number, ref: `#${r.toCard.number}`, title: r.toCard.title })),
			...card.relationsTo.filter((r) => r.type === "related").map((r) => ({ id: r.fromCard.id, number: r.fromCard.number, ref: `#${r.fromCard.number}`, title: r.fromCard.title })),
		];

		return ok({
			id: card.id,
			number: card.number,
			ref: `#${card.number}`,
			title: card.title,
			description: card.description,
			priority: card.priority,
			tags: JSON.parse(card.tags),
			createdBy: card.createdBy,
			milestone: card.milestone,
			column: card.column.name,
			board: card.column.board.name,
			boardId: card.column.board.id,
			dueDate: card.dueDate,
			...(card.metadata && card.metadata !== "{}" && { metadata: JSON.parse(card.metadata) }),
			createdAt: card.createdAt,
			updatedAt: card.updatedAt,
			lastEditedBy: card.lastEditedBy,
			relations: { blocks, blockedBy, relatedTo },
			decisions: card.decisions,
			checklist: card.checklists.map((c) => ({
				id: c.id,
				text: c.text,
				completed: c.completed,
			})),
			comments: card.comments.map((c) => ({
				id: c.id,
				content: c.content,
				authorType: c.authorType,
				authorName: c.authorName,
				createdAt: c.createdAt,
			})),
			recentActivity: card.activities.map((a) => ({
				action: a.action,
				details: a.details,
				actor: a.actorName ?? a.actorType,
				createdAt: a.createdAt,
			})),
		}, format as "json" | "toon");
	}),
});

registerExtendedTool("getStats", {
	category: "discovery",
	description: "Board statistics: card counts per column, priority breakdown. Lighter than getBoard.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId }) => safeExecute(async () => {
		const board = await db.board.findUnique({
			where: { id: boardId as string },
			include: {
				project: { select: { id: true, name: true } },
				columns: {
					orderBy: { position: "asc" },
					include: {
						cards: {
							select: { priority: true, milestoneId: true },
						},
					},
				},
			},
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const allCards = board.columns.flatMap((c) => c.cards);
		const priorities: Record<string, number> = {};
		for (const card of allCards) {
			priorities[card.priority] = (priorities[card.priority] ?? 0) + 1;
		}

		return ok({
			board: board.name,
			project: { id: board.project.id, name: board.project.name },
			totalCards: allCards.length,
			columns: board.columns.map((c) => ({ name: c.name, cards: c.cards.length, isParking: c.isParking })),
			byPriority: priorities,
		});
	}),
});

// ─── Cards (Extended) ───────────────────────────────────────────────

registerExtendedTool("deleteCard", {
	category: "cards",
	description: "Permanently delete a card and all its data. Cannot be undone. Agents must pass `intent` explaining why.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		intent: z
			.string()
			.min(1, "intent is required — explain why you're deleting this card")
			.max(120, "intent must be ≤ 120 chars")
			.describe("Short rationale for the deletion (e.g. 'duplicate of #41')"),
		boardId: z.string().optional().describe("Board UUID — scopes #number resolution to this board's project"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ cardId, boardId }) => safeExecute(async () => {
		const projectId = boardId ? await getProjectIdForBoard(boardId as string) : undefined;
		const resolved = await resolveCardRef(cardId as string, projectId);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;
		const card = await db.card.findUnique({ where: { id } });
		if (!card) return err("Card not found.");

		await db.card.delete({ where: { id } });
		return ok({ deleted: true, ref: `#${card.number}`, title: card.title, ...(resolved.warning && { _warning: resolved.warning }) });
	}),
});

registerExtendedTool("bulkCreateCards", {
	category: "cards",
	description: "Create multiple cards in one call.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		cards: z.array(z.object({
			columnName: z.string().describe("Column name (e.g. 'Up Next', 'Backlog')"),
			title: z.string().describe("Card title"),
			description: z.string().optional().describe("Markdown"),
			priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE"),
			tags: z.array(z.string()).default([]),
			milestoneName: z.string().optional().describe("Auto-creates if new"),
			metadata: z.record(z.string(), z.unknown()).optional().describe("Agent-writable JSON metadata"),
		})),
	}),
	handler: ({ boardId, cards }) => safeExecute(async () => {
		const board = await db.board.findUnique({
			where: { id: boardId as string },
			select: { projectId: true },
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const columns = await db.column.findMany({ where: { boardId: boardId as string } });
		const columnMap = new Map(columns.map((c) => [c.name.toLowerCase(), c]));

		const created: Array<{ ref: string; title: string; column: string }> = [];
		const errors: string[] = [];

		for (const input of cards as Array<Record<string, unknown>>) {
			const col = columnMap.get((input.columnName as string).toLowerCase());
			if (!col) {
				errors.push(`Column "${input.columnName}" not found for "${input.title}". Available: ${columns.map((c) => c.name).join(", ")}`);
				continue;
			}

			const maxPos = await db.card.aggregate({ where: { columnId: col.id }, _max: { position: true } });
			const project = await db.project.update({
				where: { id: board.projectId },
				data: { nextCardNumber: { increment: 1 } },
			});
			const cardNumber = project.nextCardNumber - 1;

			let milestoneId: string | undefined;
			if (input.milestoneName) {
				milestoneId = await resolveOrCreateMilestone(board.projectId, input.milestoneName as string);
			}

			const card = await db.card.create({
				data: {
					columnId: col.id,
					projectId: board.projectId,
					number: cardNumber,
					title: input.title as string,
					description: input.description as string | undefined,
					priority: (input.priority as string) ?? "NONE",
					tags: JSON.stringify(input.tags ?? []),
					milestoneId,
					metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
					createdBy: "AGENT",
					position: (maxPos._max.position ?? -1) + 1,
				},
			});

			await db.activity.create({
				data: {
					cardId: card.id,
					action: "created",
					details: `Card #${cardNumber} "${input.title}" created in ${col.name}`,
					actorType: "AGENT",
					actorName: AGENT_NAME,
				},
			});

			created.push({ ref: `#${cardNumber}`, title: card.title, column: col.name });
		}

		return ok({ created, errors: errors.length > 0 ? errors : undefined });
	}),
});

registerExtendedTool("createCardFromTemplate", {
	category: "cards",
	description: "Create a card from a pre-filled template. Templates: Bug Report, Feature, Spike / Research, Tech Debt, Epic.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		columnName: z.string().describe("Column name (e.g. 'Up Next')"),
		template: z.enum(["Bug Report", "Feature", "Spike / Research", "Tech Debt", "Epic"]),
		title: z.string().describe("Card title (auto-prefixed with template type)"),
	}),
	handler: ({ boardId, columnName, template, title }) => safeExecute(async () => {
		const templates: Record<string, { prefix: string; description: string; priority: string; tags: string[]; checklist: string[] }> = {
			"Bug Report": {
				prefix: "Bug: ", description: "**What happened:**\n\n**Expected behavior:**\n\n**Steps to reproduce:**\n1. \n\n**Environment:**\n",
				priority: "HIGH", tags: ["bug"], checklist: ["Reproduce the issue", "Identify root cause", "Write fix", "Test fix"],
			},
			Feature: {
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
			Epic: {
				prefix: "Epic: ", description: "**Overview:**\n\n**Sub-tasks:**\nCreate individual cards for each sub-task.\n\n**Success criteria:**\n- \n",
				priority: "MEDIUM", tags: ["epic"], checklist: ["Break down into cards", "Prioritize sub-tasks", "Track progress"],
			},
		};

		const tmpl = templates[template as string];
		if (!tmpl) return err(`Template "${template}" not found.`);

		const column = await db.column.findFirst({ where: { boardId: boardId as string, name: { equals: columnName as string } } });
		if (!column) {
			const cols = await db.column.findMany({ where: { boardId: boardId as string }, select: { name: true } });
			return err(`Column "${columnName}" not found.`, `Available: ${cols.map((c) => c.name).join(", ")}`);
		}

		const board = await db.board.findUnique({ where: { id: boardId as string }, select: { projectId: true } });
		if (!board) return err("Board not found.");

		const maxPos = await db.card.aggregate({ where: { columnId: column.id }, _max: { position: true } });
		const project = await db.project.update({ where: { id: board.projectId }, data: { nextCardNumber: { increment: 1 } } });
		const cardNumber = project.nextCardNumber - 1;
		const fullTitle = `${tmpl.prefix}${title}`;

		const card = await db.card.create({
			data: {
				columnId: column.id, projectId: board.projectId, number: cardNumber,
				title: fullTitle, description: tmpl.description, priority: tmpl.priority,
				tags: JSON.stringify(tmpl.tags), createdBy: "AGENT",
				position: (maxPos._max.position ?? -1) + 1,
			},
		});

		for (let i = 0; i < tmpl.checklist.length; i++) {
			await db.checklistItem.create({ data: { cardId: card.id, text: tmpl.checklist[i], position: i } });
		}

		await db.activity.create({
			data: { cardId: card.id, action: "created", details: `Card #${cardNumber} "${fullTitle}" created from ${template} template`, actorType: "AGENT", actorName: AGENT_NAME },
		});

		return ok({ ref: `#${cardNumber}`, title: fullTitle, template, column: columnName, checklistItems: tmpl.checklist.length });
	}),
});

registerExtendedTool("bulkMoveCards", {
	category: "cards",
	description: "Move multiple cards to a column in one call.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		cardIds: z.array(z.string()).describe("UUIDs or #numbers"),
		columnName: z.string().describe("Target column name"),
	}),
	handler: ({ boardId, cardIds, columnName }) => safeExecute(async () => {
		const projectId = await getProjectIdForBoard(boardId as string);
		const column = await db.column.findFirst({
			where: { boardId: boardId as string, name: { equals: columnName as string } },
		});
		if (!column) {
			const cols = await db.column.findMany({ where: { boardId: boardId as string }, select: { name: true } });
			return err(`Column "${columnName}" not found.`, `Available: ${cols.map((c) => c.name).join(", ")}`);
		}

		const moved: string[] = [];
		const errors: string[] = [];

		for (const ref of cardIds as string[]) {
			const resolved = await resolveCardRef(ref, projectId);
			if (!resolved.ok) { errors.push(resolved.message); continue; }
			const id = resolved.id;

			const card = await db.card.findUnique({ where: { id }, include: { column: true } });
			if (!card) { errors.push(`Card "${ref}" not found`); continue; }

			const maxPos = await db.card.aggregate({ where: { columnId: column.id }, _max: { position: true } });
			await db.card.update({ where: { id }, data: { columnId: column.id, position: (maxPos._max.position ?? -1) + 1 } });

			if (card.column.name !== columnName) {
				await db.activity.create({
					data: { cardId: id, action: "moved", details: `Moved from "${card.column.name}" to "${columnName}"`, actorType: "AGENT", actorName: AGENT_NAME },
				});
			}
			moved.push(`#${card.number}`);
		}

		return ok({ moved, target: columnName, errors: errors.length > 0 ? errors : undefined });
	}),
});

registerExtendedTool("bulkUpdateCards", {
	category: "cards",
	description: "Update multiple cards in one call. Each entry can set priority, tags, and/or milestone. Omitted fields are unchanged.",
	parameters: z.object({
		cards: z.array(z.object({
			cardId: z.string().describe("Card UUID or #number"),
			priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
			tags: z.array(z.string()).optional().describe("Replaces all tags"),
			milestoneName: z.string().nullable().optional().describe("null to unassign; auto-creates if new"),
			metadata: z.record(z.string(), z.unknown()).optional().describe("Agent-writable JSON metadata (merged with existing; set key to null to delete)"),
		}).strict()),
	}),
	handler: ({ cards }) => safeExecute(async () => {
		const updated: Array<Record<string, unknown>> = [];
		const errors: string[] = [];

		for (const input of cards as Array<Record<string, unknown>>) {
			const resolved = await resolveCardRef(input.cardId as string);
			if (!resolved.ok) { errors.push(resolved.message); continue; }
			const id = resolved.id;

			const existing = await db.card.findUnique({ where: { id } });
			if (!existing) { errors.push(`Card "${input.cardId}" not found`); continue; }

			let milestoneId: string | null | undefined;
			if (input.milestoneName !== undefined) {
				milestoneId = input.milestoneName
					? await resolveOrCreateMilestone(existing.projectId, input.milestoneName as string)
					: null;
			}

			// Merge metadata if provided
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
					tags: input.tags ? JSON.stringify(input.tags) : undefined,
					milestoneId: milestoneId !== undefined ? milestoneId : undefined,
					metadata: mergedMetadata,
					lastEditedBy: AGENT_NAME,
				},
				include: { milestone: { select: { name: true } } },
			});

			updated.push({
				ref: `#${card.number}`,
				title: card.title,
				priority: card.priority,
				tags: JSON.parse(card.tags),
				milestone: card.milestone?.name ?? null,
				...(card.metadata && card.metadata !== "{}" && { metadata: JSON.parse(card.metadata) }),
			});
		}

		return ok({ updated, errors: errors.length > 0 ? errors : undefined });
	}),
});

registerExtendedTool("bulkAddChecklistItems", {
	category: "checklist",
	description: "Add checklist items to one or more cards. Pass an array of { cardId, items } objects.",
	parameters: z.object({
		cards: z.array(z.object({
			cardId: z.string().describe("Card UUID or #number"),
			items: z.array(z.string()).min(1).describe("Checklist item texts"),
		})).min(1).describe("Array of card + items pairs"),
	}),
	handler: ({ cards }) => safeExecute(async () => {
		const results: Array<{ cardRef: string; added: number; items: Array<{ id: string; text: string }> }> = [];
		const errors: string[] = [];

		for (const entry of cards as Array<{ cardId: string; items: string[] }>) {
			const resolved = await resolveCardRef(entry.cardId);
			if (!resolved.ok) { errors.push(resolved.message); continue; }
			const id = resolved.id;

			const maxPos = await db.checklistItem.aggregate({ where: { cardId: id }, _max: { position: true } });
			let pos = (maxPos._max.position ?? -1) + 1;

			const created: Array<{ id: string; text: string }> = [];
			for (const text of entry.items) {
				const item = await db.checklistItem.create({
					data: { cardId: id, text, position: pos++ },
				});
				created.push({ id: item.id, text: item.text });
			}

			results.push({ cardRef: entry.cardId, added: created.length, items: created });
		}

		return ok({ results, errors: errors.length > 0 ? errors : undefined });
	}),
});

// ─── Checklist ──────────────────────────────────────────────────────

registerExtendedTool("addChecklistItem", {
	category: "checklist",
	description: "Add a checklist item to a card.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		text: z.string().describe("Item text"),
	}),
	handler: ({ cardId, text }) => safeExecute(async () => {
		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;

		const maxPos = await db.checklistItem.aggregate({ where: { cardId: id }, _max: { position: true } });
		const item = await db.checklistItem.create({
			data: { cardId: id, text: text as string, position: (maxPos._max.position ?? -1) + 1 },
		});

		return ok({ id: item.id, text: item.text, completed: false });
	}),
});

registerExtendedTool("toggleChecklistItem", {
	category: "checklist",
	description: "Toggle a checklist item complete or incomplete.",
	parameters: z.object({
		checklistItemId: z.string().describe("UUID from getBoard (columns[].cards[].checklist.items[].id) or getCard"),
		completed: z.boolean().describe("true=complete, false=incomplete"),
	}),
	handler: ({ checklistItemId, completed }) => safeExecute(async () => {
		const item = await db.checklistItem.findUnique({ where: { id: checklistItemId as string } });
		if (!item) return err("Checklist item not found.", "Get item IDs from getBoard (full mode, not summary) or getCardContext({ boardId, cardId: '#number' }).");

		const updated = await db.checklistItem.update({
			where: { id: checklistItemId as string },
			data: { completed: completed as boolean },
		});

		if (completed) {
			await db.activity.create({
				data: { cardId: item.cardId, action: "checklist_completed", details: `Completed: ${item.text}`, actorType: "AGENT", actorName: AGENT_NAME },
			});
		}

		return ok({ id: updated.id, text: updated.text, completed: updated.completed });
	}),
});

// ─── Comments ───────────────────────────────────────────────────────

registerExtendedTool("listComments", {
	category: "comments",
	description: "List comments on a card. (getBoard returns only counts, not content.)",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ cardId }) => safeExecute(async () => {
		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;

		const comments = await db.comment.findMany({
			where: { cardId: id },
			orderBy: { createdAt: "asc" },
		});

		return ok(comments.map((c) => ({
			id: c.id,
			content: c.content,
			authorType: c.authorType,
			authorName: c.authorName,
			createdAt: c.createdAt,
		})));
	}),
});

// ─── Milestones ─────────────────────────────────────────────────────

registerExtendedTool("createMilestone", {
	category: "milestones",
	description: "Create a milestone for a project.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		name: z.string().describe("e.g. 'MVP', 'v1.1', 'Q2 Launch'"),
		description: z.string().optional(),
		targetDate: z.string().datetime().optional().describe("ISO 8601"),
	}),
	handler: ({ projectId, name, description, targetDate }) => safeExecute(async () => {
		const maxPos = await db.milestone.aggregate({ where: { projectId: projectId as string }, _max: { position: true } });
		const milestone = await db.milestone.create({
			data: {
				projectId: projectId as string,
				name: name as string,
				description: description as string | undefined,
				targetDate: targetDate ? new Date(targetDate as string) : undefined,
				position: (maxPos._max.position ?? -1) + 1,
			},
		});
		return ok({ id: milestone.id, name: milestone.name, created: true });
	}),
});

registerExtendedTool("updateMilestone", {
	category: "milestones",
	description: "Update a milestone's name, description, or target date.",
	parameters: z.object({
		milestoneId: z.string().describe("UUID from getRoadmap or listMilestones"),
		name: z.string().optional(),
		description: z.string().nullable().optional().describe("null to clear"),
		targetDate: z.string().datetime().nullable().optional().describe("ISO 8601, null to clear"),
	}),
	annotations: { idempotentHint: true },
	handler: ({ milestoneId, name, description, targetDate }) => safeExecute(async () => {
		const existing = await db.milestone.findUnique({ where: { id: milestoneId as string } });
		if (!existing) return errWithToolHint("Milestone not found.", "listMilestones", { projectId: '"<projectId>"' });

		const milestone = await db.milestone.update({
			where: { id: milestoneId as string },
			data: {
				name: name as string | undefined,
				description: description as string | null | undefined,
				targetDate: targetDate !== undefined ? (targetDate ? new Date(targetDate as string) : null) : undefined,
			},
		});
		return ok({ id: milestone.id, name: milestone.name, updated: true });
	}),
});

registerExtendedTool("listMilestones", {
	category: "milestones",
	description: "List milestones for a project with card counts, done/total breakdown, and completion percentage.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId }) => safeExecute(async () => {
		const milestones = await db.milestone.findMany({
			where: { projectId: projectId as string },
			orderBy: { position: "asc" },
			include: {
				_count: { select: { cards: true } },
				cards: {
					select: { column: { select: { role: true } } },
				},
			},
		});
		return ok(milestones.map((m) => {
			const total = m._count.cards;
			const done = m.cards.filter((c) => c.column.role === "done").length;
			const { cards: _, ...rest } = m;
			return {
				id: rest.id,
				name: rest.name,
				description: rest.description,
				targetDate: rest.targetDate,
				cardCount: total,
				done,
				progress: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%",
				position: rest.position,
			};
		}));
	}),
});

// ─── Notes ──────────────────────────────────────────────────────────

registerExtendedTool("listNotes", {
	category: "notes",
	description: "List project notes. Omit projectId to list all.",
	parameters: z.object({
		projectId: z.string().optional().describe("Project UUID, omit for all"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId }) => safeExecute(async () => {
		const notes = await db.note.findMany({
			where: projectId ? { projectId: projectId as string } : {},
			orderBy: { updatedAt: "desc" },
			include: { project: { select: { id: true, name: true } } },
		});
		return ok(notes.map((n) => ({
			id: n.id,
			title: n.title,
			content: n.content.substring(0, 200) + (n.content.length > 200 ? "..." : ""),
			tags: JSON.parse(n.tags),
			project: n.project?.name ?? null,
			updatedAt: n.updatedAt,
		})));
	}),
});

registerExtendedTool("createNote", {
	category: "notes",
	description: "Create a project note. Omit projectId for a global note.",
	parameters: z.object({
		title: z.string(),
		content: z.string().optional().describe("Markdown"),
		tags: z.array(z.string()).default([]),
		projectId: z.string().optional().describe("Project UUID, omit for global"),
	}),
	handler: ({ title, content, tags, projectId }) => safeExecute(async () => {
		const note = await db.note.create({
			data: {
				title: title as string,
				content: (content as string) ?? "",
				tags: JSON.stringify(tags ?? []),
				projectId: projectId as string | undefined,
			},
		});
		return ok({ id: note.id, title: note.title, created: true });
	}),
});

registerExtendedTool("updateNote", {
	category: "notes",
	description: "Update a note.",
	parameters: z.object({
		noteId: z.string().describe("UUID from listNotes"),
		title: z.string().optional(),
		content: z.string().optional().describe("Markdown"),
		tags: z.array(z.string()).optional().describe("Replaces all tags"),
	}),
	annotations: { idempotentHint: true },
	handler: ({ noteId, title, content, tags }) => safeExecute(async () => {
		const existing = await db.note.findUnique({ where: { id: noteId as string } });
		if (!existing) return errWithToolHint("Note not found.", "listNotes", { projectId: '"<projectId>"' });

		const note = await db.note.update({
			where: { id: noteId as string },
			data: {
				title: title as string | undefined,
				content: content as string | undefined,
				tags: tags ? JSON.stringify(tags) : undefined,
			},
		});
		return ok({ id: note.id, title: note.title, updated: true });
	}),
});

// ─── Activity ───────────────────────────────────────────────────────

registerExtendedTool("listActivity", {
	category: "activity",
	description: "Recent activity for a board: what changed, who did it, when.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		limit: z.number().int().min(1).max(100).default(30).describe("Max items (1–100)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, limit }) => safeExecute(async () => {
		const board = await db.board.findUnique({
			where: { id: boardId as string },
			include: {
				columns: {
					select: {
						cards: {
							select: { id: true },
						},
					},
				},
			},
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const cardIds = board.columns.flatMap((c) => c.cards.map((card) => card.id));

		const activities = await db.activity.findMany({
			where: { cardId: { in: cardIds } },
			orderBy: { createdAt: "desc" },
			take: limit as number,
			include: {
				card: { select: { number: true, title: true } },
			},
		});

		return ok(activities.map((a) => ({
			ref: `#${a.card.number}`,
			card: a.card.title,
			action: a.action,
			details: a.details,
			actor: a.actorName ?? a.actorType,
			when: a.createdAt,
		})));
	}),
});

// ─── Setup ──────────────────────────────────────────────────────────

registerExtendedTool("createProject", {
	category: "setup",
	description: "Create a project with default board and columns (Backlog, Up Next, In Progress, Done, Parking Lot).",
	parameters: z.object({
		name: z.string(),
		description: z.string().optional(),
		boardName: z.string().default("Main Board"),
	}),
	handler: ({ name, description, boardName }) => safeExecute(async () => {
		let slug = (name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		const existing = await db.project.findUnique({ where: { slug } });
		if (existing) slug = `${slug}-${Date.now().toString(36)}`;

		const project = await db.project.create({
			data: {
				name: name as string,
				description: description as string | undefined,
				slug,
				boards: {
					create: {
						name: boardName as string,
						columns: {
							create: [
								{ name: "Backlog", description: "This hasn't been started", position: 0, role: "backlog" },
								{ name: "Up Next", description: "This is ready to be picked up", position: 1, role: "todo" },
								{ name: "In Progress", description: "This is actively being worked on", position: 2, role: "active" },
								{ name: "Done", description: "This has been completed", position: 3, role: "done" },
								{ name: "Parking Lot", description: "Ideas and items to revisit later", position: 4, role: "parking", isParking: true },
							],
						},
					},
				},
			},
			include: { boards: true },
		});

		return ok({
			projectId: project.id,
			projectName: project.name,
			slug: project.slug,
			boardId: project.boards[0].id,
			boardName: project.boards[0].name,
		});
	}),
});

registerExtendedTool("createColumn", {
	category: "setup",
	description: "Add a custom column. Standard columns are created by createProject.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		name: z.string(),
		description: z.string().optional(),
	}),
	handler: ({ boardId, name, description }) => safeExecute(async () => {
		const maxPos = await db.column.aggregate({ where: { boardId: boardId as string }, _max: { position: true } });
		const column = await db.column.create({
			data: {
				boardId: boardId as string,
				name: name as string,
				description: description as string | undefined,
				position: (maxPos._max.position ?? -1) + 1,
			},
		});
		return ok({ id: column.id, name: column.name });
	}),
});

// ─── Smart Prioritization ──────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = {
	URGENT: 5, HIGH: 4, MEDIUM: 3, LOW: 2, NONE: 0,
};

function computeScore(card: {
	priority: string;
	updatedAt: Date;
	dueDate: Date | null;
	checklists: Array<{ completed: boolean }>;
	blockedByCount: number;
	blocksOtherCount: number;
}): number {
	const ageDays = Math.floor(
		(Date.now() - new Date(card.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
	);

	if (card.blockedByCount > 0) return -100 + (PRIORITY_WEIGHT[card.priority] ?? 0);

	let score = (PRIORITY_WEIGHT[card.priority] ?? 0) * 30;
	score += Math.min(ageDays, 14) * 2;
	score += card.blocksOtherCount * 15;

	if (card.dueDate) {
		const daysUntilDue = Math.floor(
			(new Date(card.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
		);
		if (daysUntilDue < 0) score += 50;
		else if (daysUntilDue <= 1) score += 40;
		else if (daysUntilDue <= 3) score += 25;
		else if (daysUntilDue <= 7) score += 10;
	}

	const total = card.checklists.length;
	if (total > 0) {
		const done = card.checklists.filter((c) => c.completed).length;
		score += Math.round((done / total) * 10);
	}

	return score;
}

registerExtendedTool("getWorkNextSuggestion", {
	category: "discovery",
	description: "Get top cards to work on next, ranked by a composite score of priority, age, blockers, due dates, and progress.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		limit: z.number().int().min(1).max(20).default(5).describe("How many suggestions (1-20, default 5)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ boardId, limit }) => safeExecute(async () => {
		const board = await db.board.findUnique({
			where: { id: boardId as string },
			include: {
				columns: {
					where: { role: { notIn: ["done", "parking"] } },
					include: {
						cards: {
							include: {
								checklists: { select: { completed: true } },
								relationsTo: { where: { type: "blocks" }, select: { id: true } },
								relationsFrom: { where: { type: "blocks" }, select: { id: true } },
							},
						},
					},
				},
			},
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const scored = board.columns.flatMap((col) =>
			col.cards.map((card) => ({
				ref: `#${card.number}`,
				title: card.title,
				priority: card.priority,
				column: col.name,
				score: computeScore({
					priority: card.priority,
					updatedAt: card.updatedAt,
					dueDate: card.dueDate,
					checklists: card.checklists,
					blockedByCount: card.relationsTo.length,
					blocksOtherCount: card.relationsFrom.length,
				}),
				isBlocked: card.relationsTo.length > 0,
				tags: JSON.parse(card.tags) as string[],
			})),
		).sort((a, b) => b.score - a.score);

		return ok({
			suggestions: scored.slice(0, limit as number),
			total: scored.length,
		});
	}),
});
