import { z } from "zod";
import { getHorizon } from "../../lib/column-roles.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, errWithToolHint, ok, resolveCardRef, safeExecute } from "../utils.js";

// ─── Card Context ─────────────────────────────────────────────────

registerExtendedTool("getCardContext", {
	category: "context",
	description:
		"Deep context for a single card: description, checklist, comments, relations, decisions, commits, and related cards.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		cardId: z.string().describe("Card UUID or #number"),
		format: z.enum(["json", "toon"]).default("json").describe("Response format"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) =>
		safeExecute(async () => {
			const {
				boardId,
				cardId: cardRef,
				format,
			} = params as { boardId: string; cardId: string; format: "json" | "toon" };

			const board = await db.board.findUnique({
				where: { id: boardId },
				select: { id: true, projectId: true },
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const resolved = await resolveCardRef(cardRef, board.projectId);
			if (!resolved.ok) return err(resolved.message);
			const cardId = resolved.id;

			const card = await db.card.findUnique({
				where: { id: cardId },
				include: {
					checklists: {
						orderBy: { position: "asc" },
						select: { id: true, text: true, completed: true },
					},
					comments: {
						orderBy: { createdAt: "desc" },
						take: 5,
						select: { content: true, authorName: true, authorType: true, createdAt: true },
					},
					milestone: { select: { id: true, name: true } },
					column: { select: { name: true, role: true } },
					relationsFrom: {
						include: {
							toCard: { select: { id: true, number: true, title: true, priority: true } },
						},
					},
					relationsTo: {
						include: {
							fromCard: { select: { id: true, number: true, title: true, priority: true } },
						},
					},
					gitLinks: {
						select: { commitHash: true, message: true, commitDate: true },
						orderBy: { commitDate: "desc" },
						take: 5,
					},
				},
			});
			if (!card) return err("Card not found.");

			const decisionClaims = await db.claim.findMany({
				where: { kind: "decision", cardId },
				select: { id: true, statement: true, status: true, body: true },
				orderBy: { createdAt: "desc" },
			});
			const cardDecisions = decisionClaims.map((c) => {
				const [decisionText] = c.body.split(/\n{2,}/);
				return {
					id: c.id,
					title: c.statement,
					status: c.status,
					decision: decisionText ?? c.body,
				};
			});

			// Related cards (same milestone or overlapping tags, max 3)
			const cardTags: string[] = JSON.parse(card.tags);
			let relatedCards: Array<{
				number: number;
				ref: string;
				title: string;
				priority: string;
				column: string;
			}> = [];
			if (card.milestoneId || cardTags.length > 0) {
				const candidates = await db.card.findMany({
					where: {
						id: { not: cardId },
						column: { boardId },
						OR: [
							...(card.milestoneId ? [{ milestoneId: card.milestoneId }] : []),
							...(cardTags.length > 0 ? cardTags.map((t) => ({ tags: { contains: t } })) : []),
						],
					},
					select: {
						number: true,
						title: true,
						priority: true,
						column: { select: { name: true, role: true } },
					},
					take: 3,
				});
				relatedCards = candidates.map((c) => ({
					number: c.number,
					ref: `#${c.number}`,
					title: c.title,
					priority: c.priority,
					column: c.column.name,
				}));
			}

			const blocks = card.relationsFrom
				.filter((r) => r.type === "blocks")
				.map((r) => ({ ref: `#${r.toCard.number}`, title: r.toCard.title }));
			const blockedBy = card.relationsTo
				.filter((r) => r.type === "blocks")
				.map((r) => ({ ref: `#${r.fromCard.number}`, title: r.fromCard.title }));

			return ok(
				{
					scope: "card",
					card: {
						ref: `#${card.number}`,
						title: card.title,
						description: card.description,
						priority: card.priority,
						tags: cardTags,
						column: card.column.name,
						milestone: card.milestone?.name ?? null,
					},
					checklist: card.checklists,
					comments: card.comments.map((c) => ({
						content: c.content,
						author: c.authorName ?? c.authorType,
						when: c.createdAt,
					})),
					relations: { blocks, blockedBy },
					decisions: cardDecisions,
					commits: card.gitLinks.map((g) => ({
						hash: g.commitHash.slice(0, 8),
						message: g.message,
						date: g.commitDate,
					})),
					relatedCards,
				},
				format
			);
		}),
});

// ─── Milestone Context ────────────────────────────────────────────

registerExtendedTool("getMilestoneContext", {
	category: "context",
	description:
		"Cards and progress for a milestone, grouped by horizon (now/next/later/done). Includes decisions.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		milestone: z.string().describe("Milestone name"),
		format: z.enum(["json", "toon"]).default("json").describe("Response format"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) =>
		safeExecute(async () => {
			const { boardId, milestone, format } = params as {
				boardId: string;
				milestone: string;
				format: "json" | "toon";
			};

			const board = await db.board.findUnique({
				where: { id: boardId },
				select: { id: true, projectId: true },
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const ms = await db.milestone.findUnique({
				where: { projectId_name: { projectId: board.projectId, name: milestone } },
				select: { id: true, name: true, description: true, targetDate: true },
			});
			if (!ms)
				return errWithToolHint(`Milestone "${milestone}" not found.`, "getRoadmap", {
					projectId: '"<projectId>"',
				});

			const cards = await db.card.findMany({
				where: { milestoneId: ms.id, column: { boardId } },
				include: {
					column: { select: { name: true, role: true } },
					checklists: { select: { completed: true } },
					relationsTo: {
						where: { type: "blocks" },
						include: { fromCard: { select: { number: true, title: true } } },
					},
				},
				orderBy: { position: "asc" },
			});

			const decisionClaims = await db.claim.findMany({
				where: {
					projectId: board.projectId,
					kind: "decision",
					card: { milestoneId: ms.id },
				},
				select: { id: true, statement: true, status: true },
			});
			const decisions = decisionClaims.map((c) => ({
				id: c.id,
				title: c.statement,
				status: c.status,
			}));

			type MilestoneCard = {
				ref: string;
				title: string;
				priority: string;
				checklist: string;
				blockedBy?: Array<{ ref: string; title: string }>;
			};
			const grouped: Record<string, MilestoneCard[]> = { now: [], next: [], later: [], done: [] };
			for (const c of cards) {
				const horizon = getHorizon(c.column);
				const done = c.checklists.filter((cl) => cl.completed).length;
				const total = c.checklists.length;
				const blockers = c.relationsTo.map((r) => ({
					ref: `#${r.fromCard.number}`,
					title: r.fromCard.title,
				}));
				grouped[horizon].push({
					ref: `#${c.number}`,
					title: c.title,
					priority: c.priority,
					checklist: total > 0 ? `${done}/${total}` : "",
					...(blockers.length > 0 && { blockedBy: blockers }),
				});
			}

			return ok(
				{
					scope: "milestone",
					milestone: { name: ms.name, description: ms.description, targetDate: ms.targetDate },
					total: cards.length,
					done: grouped.done.length,
					progress:
						cards.length > 0 ? `${Math.round((grouped.done.length / cards.length) * 100)}%` : "0%",
					now: grouped.now,
					next: grouped.next,
					later: grouped.later,
					doneCards: grouped.done,
					decisions,
				},
				format
			);
		}),
});

// ─── Tag Context ──────────────────────────────────────────────────

registerExtendedTool("getTagContext", {
	category: "context",
	description: "All cards with a given tag, grouped by column.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		tag: z.string().describe("Tag to filter by"),
		format: z.enum(["json", "toon"]).default("json").describe("Response format"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) =>
		safeExecute(async () => {
			const { boardId, tag, format } = params as {
				boardId: string;
				tag: string;
				format: "json" | "toon";
			};

			const board = await db.board.findUnique({
				where: { id: boardId },
				select: { id: true },
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const allCards = await db.card.findMany({
				where: { column: { boardId } },
				include: {
					column: { select: { name: true, role: true } },
					checklists: { select: { completed: true } },
				},
				orderBy: { position: "asc" },
			});

			const tagged = allCards.filter((c) => {
				const tags: string[] = JSON.parse(c.tags);
				return tags.includes(tag);
			});

			const byColumn: Record<
				string,
				Array<{ ref: string; title: string; priority: string; checklist: string }>
			> = {};
			for (const c of tagged) {
				const col = c.column.name;
				if (!byColumn[col]) byColumn[col] = [];
				const done = c.checklists.filter((cl) => cl.completed).length;
				const total = c.checklists.length;
				byColumn[col].push({
					ref: `#${c.number}`,
					title: c.title,
					priority: c.priority,
					checklist: total > 0 ? `${done}/${total}` : "",
				});
			}

			return ok(
				{
					scope: "tag",
					tag,
					total: tagged.length,
					byColumn,
				},
				format
			);
		}),
});
