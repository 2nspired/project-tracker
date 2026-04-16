import { z } from "zod";
import { db } from "./db.js";
import { registerExtendedTool } from "./tool-registry.js";
import { AGENT_NAME, resolveCardRef, resolveOrCreateMilestone, ok, err, errWithToolHint, safeExecute, checkVersionConflict } from "./utils.js";
import { parseCardScope, scopeSchema } from "../lib/schemas/card-schemas.js";
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
	description: "Full card detail: description, checklist, comments, activity history. TOON by default.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		format: z.enum(["json", "toon"]).default("toon").describe("Default 'toon'; use 'json' for raw"),
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
			assignee: card.assignee,
			createdBy: card.createdBy,
			milestone: card.milestone,
			column: card.column.name,
			board: card.column.board.name,
			boardId: card.column.board.id,
			dueDate: card.dueDate,
			...(card.metadata && card.metadata !== "{}" && { metadata: JSON.parse(card.metadata) }),
			...(card.scope && card.scope !== "{}" && { scope: JSON.parse(card.scope) }),
			createdAt: card.createdAt,
			updatedAt: card.updatedAt,
			version: card.version,
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
							select: { priority: true, assignee: true, milestoneId: true },
						},
					},
				},
			},
		});
		if (!board) return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

		const allCards = board.columns.flatMap((c) => c.cards);
		const priorities: Record<string, number> = {};
		const assignees: Record<string, number> = { HUMAN: 0, AGENT: 0, unassigned: 0 };
		for (const card of allCards) {
			priorities[card.priority] = (priorities[card.priority] ?? 0) + 1;
			if (card.assignee) assignees[card.assignee]++;
			else assignees.unassigned++;
		}

		return ok({
			board: board.name,
			project: { id: board.project.id, name: board.project.name },
			totalCards: allCards.length,
			columns: board.columns.map((c) => ({ name: c.name, cards: c.cards.length, isParking: c.isParking })),
			byPriority: priorities,
			byAssignee: assignees,
		});
	}),
});

// ─── Cards (Extended) ───────────────────────────────────────────────

registerExtendedTool("deleteCard", {
	category: "cards",
	description: "Permanently delete a card and all its data. Cannot be undone.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ cardId }) => safeExecute(async () => {
		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;
		const card = await db.card.findUnique({ where: { id } });
		if (!card) return err("Card not found.");

		await db.card.delete({ where: { id } });
		return ok({ deleted: true, ref: `#${card.number}`, title: card.title });
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
			scope: z.object({
				acceptanceCriteria: z.array(z.string()).optional(),
				outOfScope: z.array(z.string()).optional(),
				contextBudget: z.enum(["quick-fix", "standard", "deep-dive"]).nullable().optional(),
				approachHint: z.string().nullable().optional(),
			}).optional().describe("Scope guards"),
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
					scope: input.scope ? JSON.stringify(scopeSchema.parse(input.scope)) : undefined,
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
		const templates: Record<string, { prefix: string; description: string; priority: string; tags: string[]; checklist: string[]; scope?: Record<string, unknown> }> = {
			"Bug Report": {
				prefix: "Bug: ", description: "**What happened:**\n\n**Expected behavior:**\n\n**Steps to reproduce:**\n1. \n\n**Environment:**\n",
				priority: "HIGH", tags: ["bug"], checklist: ["Reproduce the issue", "Identify root cause", "Write fix", "Test fix"],
				scope: { contextBudget: "standard", acceptanceCriteria: ["Bug is no longer reproducible", "No regression in related flows"] },
			},
			Feature: {
				prefix: "Feature: ", description: "**Goal:**\n\n**Approach:**\n\n**Acceptance criteria:**\n- \n",
				priority: "MEDIUM", tags: ["feature"], checklist: ["Design approach", "Implement", "Add tests", "Update docs if needed"],
				scope: { contextBudget: "standard" },
			},
			"Spike / Research": {
				prefix: "Spike: ", description: "**Question to answer:**\n\n**Time-box:** 2 hours\n\n**Options to evaluate:**\n1. \n\n**Decision:**\n",
				priority: "LOW", tags: ["spike"], checklist: ["Research options", "Prototype if needed", "Document findings", "Make recommendation"],
				scope: { contextBudget: "quick-fix", approachHint: "Time-box strictly. Document findings in card comment." },
			},
			"Tech Debt": {
				prefix: "Refactor: ", description: "**Current state:**\n\n**Desired state:**\n\n**Why now:**\n",
				priority: "LOW", tags: ["debt"], checklist: ["Assess impact", "Refactor", "Verify no regressions"],
				scope: { contextBudget: "standard", acceptanceCriteria: ["No regressions", "Code quality improved"] },
			},
			Epic: {
				prefix: "Epic: ", description: "**Overview:**\n\n**Sub-tasks:**\nCreate individual cards for each sub-task.\n\n**Success criteria:**\n- \n",
				priority: "MEDIUM", tags: ["epic"], checklist: ["Break down into cards", "Prioritize sub-tasks", "Track progress"],
				scope: { contextBudget: "deep-dive" },
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
				scope: tmpl.scope ? JSON.stringify(scopeSchema.parse(tmpl.scope)) : undefined,
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
			const resolved = await resolveCardRef(ref);
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
	description: "Update multiple cards in one call. Each entry can set priority, tags, assignee, and/or milestone. Omitted fields are unchanged.",
	parameters: z.object({
		cards: z.array(z.object({
			cardId: z.string().describe("Card UUID or #number"),
			version: z.number().int().optional().describe("Expected version for optimistic locking"),
			priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
			tags: z.array(z.string()).optional().describe("Replaces all tags"),
			assignee: z.enum(["HUMAN", "AGENT"]).nullable().optional().describe("null to unassign"),
			milestoneName: z.string().nullable().optional().describe("null to unassign; auto-creates if new"),
			metadata: z.record(z.string(), z.unknown()).optional().describe("Agent-writable JSON metadata (merged with existing; set key to null to delete)"),
			scope: z.object({
				acceptanceCriteria: z.array(z.string()).optional(),
				outOfScope: z.array(z.string()).optional(),
				contextBudget: z.enum(["quick-fix", "standard", "deep-dive"]).nullable().optional(),
				approachHint: z.string().nullable().optional(),
			}).optional().describe("Scope guards — each sub-field replaces its entry"),
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

			if (input.version !== undefined && input.version !== existing.version) {
				errors.push(`Version conflict on card #${existing.number}: sent version ${input.version}, current is ${existing.version}`);
				continue;
			}

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

			// Merge scope: per-sub-field replacement
			let mergedScope: string | undefined;
			if (input.scope) {
				const existingScope = parseCardScope(existing.scope);
				mergedScope = JSON.stringify(scopeSchema.parse({ ...existingScope, ...(input.scope as Record<string, unknown>) }));
			}

			const card = await db.card.update({
				where: { id },
				data: {
					priority: input.priority as string | undefined,
					tags: input.tags ? JSON.stringify(input.tags) : undefined,
					assignee: input.assignee as string | null | undefined,
					milestoneId: milestoneId !== undefined ? milestoneId : undefined,
					metadata: mergedMetadata,
					scope: mergedScope,
					version: { increment: 1 },
					lastEditedBy: AGENT_NAME,
				},
				include: { milestone: { select: { name: true } } },
			});

			updated.push({
				ref: `#${card.number}`,
				title: card.title,
				priority: card.priority,
				tags: JSON.parse(card.tags),
				assignee: card.assignee,
				milestone: card.milestone?.name ?? null,
				...(card.metadata && card.metadata !== "{}" && { metadata: JSON.parse(card.metadata) }),
				...(card.scope && card.scope !== "{}" && { scope: JSON.parse(card.scope) }),
			});
		}

		return ok({ updated, errors: errors.length > 0 ? errors : undefined });
	}),
});

registerExtendedTool("bulkAddChecklistItems", {
	category: "checklist",
	description: "Add multiple checklist items to a card in one call.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		items: z.array(z.string()).min(1).describe("Checklist item texts"),
	}),
	handler: ({ cardId, items }) => safeExecute(async () => {
		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;

		const maxPos = await db.checklistItem.aggregate({ where: { cardId: id }, _max: { position: true } });
		let pos = (maxPos._max.position ?? -1) + 1;

		const created: Array<{ id: string; text: string }> = [];
		for (const text of items as string[]) {
			const item = await db.checklistItem.create({
				data: { cardId: id, text, position: pos++ },
			});
			created.push({ id: item.id, text: item.text });
		}

		return ok({ cardRef: cardId, added: created.length, items: created });
	}),
});

registerExtendedTool("bulkAddChecklistItemsMulti", {
	category: "checklist",
	description: "Add checklist items to multiple cards in one call. Accepts an array of { cardId, items } objects.",
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

registerExtendedTool("bulkSetMilestone", {
	category: "milestones",
	description: "Assign a milestone to multiple cards at once. Auto-creates milestone if name is new.",
	parameters: z.object({
		milestoneName: z.string().describe("Milestone name to assign"),
		cardIds: z.array(z.string()).min(1).describe("Card UUIDs or #numbers"),
	}),
	annotations: { idempotentHint: true },
	handler: ({ milestoneName, cardIds }) => safeExecute(async () => {
		const assigned: string[] = [];
		const errors: string[] = [];

		for (const ref of cardIds as string[]) {
			const resolved = await resolveCardRef(ref);
			if (!resolved.ok) { errors.push(resolved.message); continue; }
			const id = resolved.id;

			const card = await db.card.findUnique({ where: { id } });
			if (!card) { errors.push(`Card "${ref}" not found`); continue; }

			const milestoneId = await resolveOrCreateMilestone(card.projectId, milestoneName as string);
			await db.card.update({ where: { id }, data: { milestoneId } });
			assigned.push(`#${card.number}`);
		}

		return ok({ milestone: milestoneName, assigned, errors: errors.length > 0 ? errors : undefined });
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
		if (!item) return err("Checklist item not found.", "Get item IDs from getBoard (full mode, not summary) or getFocusContext({ boardId, cardRef: '#number' }).");

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

registerExtendedTool("deleteChecklistItem", {
	category: "checklist",
	description: "Delete a checklist item.",
	parameters: z.object({
		checklistItemId: z.string().describe("UUID from getBoard or getCard"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ checklistItemId }) => safeExecute(async () => {
		const item = await db.checklistItem.findUnique({ where: { id: checklistItemId as string } });
		if (!item) return err("Checklist item not found.");

		await db.checklistItem.delete({ where: { id: checklistItemId as string } });
		return ok({ deleted: true, text: item.text });
	}),
});

registerExtendedTool("reorderChecklistItem", {
	category: "checklist",
	description: "Move a checklist item to a new position within its card. Other items shift to accommodate.",
	parameters: z.object({
		checklistItemId: z.string().describe("UUID of the checklist item to move"),
		position: z.number().int().min(0).describe("New zero-based position index"),
	}),
	handler: ({ checklistItemId, position }) => safeExecute(async () => {
		const item = await db.checklistItem.findUnique({ where: { id: checklistItemId as string } });
		if (!item) return err("Checklist item not found.");

		const allItems = await db.checklistItem.findMany({
			where: { cardId: item.cardId },
			orderBy: { position: "asc" },
		});

		const targetPos = Math.min(position as number, allItems.length - 1);
		const filtered = allItems.filter((i) => i.id !== item.id);
		filtered.splice(targetPos, 0, item);

		for (let i = 0; i < filtered.length; i++) {
			if (filtered[i].position !== i) {
				await db.checklistItem.update({ where: { id: filtered[i].id }, data: { position: i } });
			}
		}

		return ok({ id: item.id, text: item.text, newPosition: targetPos });
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

registerExtendedTool("deleteComment", {
	category: "comments",
	description: "Delete a comment.",
	parameters: z.object({
		commentId: z.string().describe("UUID from listComments or getCard"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ commentId }) => safeExecute(async () => {
		const comment = await db.comment.findUnique({ where: { id: commentId as string } });
		if (!comment) return errWithToolHint("Comment not found.", "listComments", { cardId: '"#number"' });

		await db.comment.delete({ where: { id: commentId as string } });
		return ok({ deleted: true, content: comment.content.substring(0, 50) });
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

registerExtendedTool("setMilestone", {
	category: "milestones",
	description: "Assign/unassign a card's milestone. Use milestoneId (precise) or milestoneName (auto-creates if new). Pass null to unassign.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
		milestoneId: z.string().nullable().optional().describe("Milestone UUID — precise, no typo risk. null to unassign."),
		milestoneName: z.string().nullable().optional().describe("Milestone name — auto-creates if new. null to unassign."),
	}),
	annotations: { idempotentHint: true },
	handler: ({ cardId, milestoneId: msId, milestoneName }) => safeExecute(async () => {
		if (msId === undefined && milestoneName === undefined) {
			return err("Provide either milestoneId or milestoneName.", "Use milestoneId for precision, milestoneName for convenience.");
		}

		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;

		const card = await db.card.findUnique({ where: { id } });
		if (!card) return err("Card not found.");

		let resolvedMilestoneId: string | null = null;
		let resolvedName: string | null = null;

		if (msId !== undefined) {
			// ID-based: precise lookup
			if (msId === null) {
				resolvedMilestoneId = null;
			} else {
				const milestone = await db.milestone.findUnique({ where: { id: msId as string } });
				if (!milestone) return errWithToolHint(`Milestone "${msId}" not found.`, "listMilestones", { projectId: '"<projectId>"' });
				resolvedMilestoneId = milestone.id;
				resolvedName = milestone.name;
			}
		} else if (milestoneName !== undefined) {
			// Name-based: auto-create
			if (milestoneName === null) {
				resolvedMilestoneId = null;
			} else {
				resolvedMilestoneId = await resolveOrCreateMilestone(card.projectId, milestoneName as string);
				resolvedName = milestoneName as string;
			}
		}

		await db.card.update({ where: { id }, data: { milestoneId: resolvedMilestoneId } });
		return ok({ ref: `#${card.number}`, milestone: resolvedName, action: resolvedMilestoneId ? "assigned" : "unassigned" });
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

registerExtendedTool("deleteNote", {
	category: "notes",
	description: "Delete a note.",
	parameters: z.object({
		noteId: z.string().describe("UUID from listNotes"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ noteId }) => safeExecute(async () => {
		const note = await db.note.findUnique({ where: { id: noteId as string } });
		if (!note) return err("Note not found.");

		await db.note.delete({ where: { id: noteId as string } });
		return ok({ deleted: true, title: note.title });
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
				assignee: card.assignee,
			})),
		).sort((a, b) => b.score - a.score);

		return ok({
			suggestions: scored.slice(0, limit as number),
			total: scored.length,
		});
	}),
});
