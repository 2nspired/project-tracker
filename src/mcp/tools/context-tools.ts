import { z } from "zod";
import { getHorizon } from "../../lib/column-roles.js";
import {
	getColumnPrompt,
	loadTrackerPolicy,
	type TrackerPolicy,
} from "../../lib/services/tracker-policy.js";
import { slugify } from "../../lib/slugify.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import {
	err,
	errWithToolHint,
	ok,
	resolveCardRef,
	safeExecute,
	type ToolResult,
} from "../utils.js";

// ─── Card Context ─────────────────────────────────────────────────

/**
 * Card-context payload as `getCardContext` returns it. Shared with
 * `planCard` so both tools surface the same shape.
 */
export type CardContextPayload = {
	scope: "card";
	card: {
		ref: string;
		title: string;
		description: string | null;
		priority: string;
		tags: string[];
		column: string;
		milestone: string | null;
	};
	checklist: Array<{ id: string; text: string; completed: boolean }>;
	comments: Array<{ content: string; author: string; when: Date }>;
	relations: {
		blocks: Array<{ ref: string; title: string }>;
		blockedBy: Array<{ ref: string; title: string }>;
	};
	decisions: Array<{ id: string; title: string; status: string; decision: string }>;
	commits: Array<{ hash: string; message: string; date: Date }>;
	relatedCards: Array<{
		number: number;
		ref: string;
		title: string;
		priority: string;
		column: string;
	}>;
	policy?: { columnPrompt: string };
};

export type LoadedCardContext = {
	payload: CardContextPayload;
	cardId: string;
	cardNumber: number;
	columnName: string;
	description: string | null;
	policy: TrackerPolicy | null;
	columnPrompt: string | undefined;
};

/**
 * Shared loader for card-scope context. Used by `getCardContext` (returns
 * `payload` directly) and `planCard` (embeds `payload` as `card` and uses
 * the rest as decision input). Encapsulates the relations + decisions +
 * relatedCards + policy lookup so callers stay thin.
 */
export async function loadCardContext(
	boardId: string,
	cardRef: string
): Promise<{ ok: true; data: LoadedCardContext } | { ok: false; error: ToolResult }> {
	const board = await db.board.findUnique({
		where: { id: boardId },
		select: {
			id: true,
			projectId: true,
			project: { select: { repoPath: true } },
		},
	});
	if (!board)
		return {
			ok: false,
			error: err("Board not found.", "Use listProjects → listBoards to find a valid boardId."),
		};

	const resolved = await resolveCardRef(cardRef, board.projectId);
	if (!resolved.ok) return { ok: false, error: err(resolved.message) };
	const cardId = resolved.id;

	const card = await db.card.findUnique({
		where: { id: cardId },
		include: {
			checklists: {
				orderBy: { position: "asc" },
				select: { id: true, text: true, completed: true },
			},
			comments: {
				orderBy: { createdAt: "asc" },
				take: 50,
				select: { content: true, authorName: true, authorType: true, createdAt: true },
			},
			milestone: { select: { id: true, name: true } },
			column: { select: { name: true, role: true } },
			cardTags: { include: { tag: { select: { label: true, slug: true } } } },
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
	if (!card) return { ok: false, error: err("Card not found.") };

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

	const cardTags: string[] = card.cardTags.map((ct) => ct.tag.label);
	const cardTagSlugs: string[] = card.cardTags.map((ct) => ct.tag.slug);
	let relatedCards: CardContextPayload["relatedCards"] = [];
	if (card.milestoneId || cardTagSlugs.length > 0) {
		const candidates = await db.card.findMany({
			where: {
				id: { not: cardId },
				column: { boardId },
				OR: [
					...(card.milestoneId ? [{ milestoneId: card.milestoneId }] : []),
					...(cardTagSlugs.length > 0
						? [{ cardTags: { some: { tag: { slug: { in: cardTagSlugs } } } } }]
						: []),
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

	const policyResult = await loadTrackerPolicy({
		repoPath: board.project.repoPath,
	});
	const columnPrompt = getColumnPrompt(policyResult.policy, card.column.name);

	const payload: CardContextPayload = {
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
		...(columnPrompt !== undefined ? { policy: { columnPrompt } } : {}),
	};

	return {
		ok: true,
		data: {
			payload,
			cardId: card.id,
			cardNumber: card.number,
			columnName: card.column.name,
			description: card.description,
			policy: policyResult.policy,
			columnPrompt,
		},
	};
}

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

			const result = await loadCardContext(boardId, cardRef);
			if (!result.ok) return result.error;
			return ok(result.data.payload, format);
		}),
});

// ─── Milestone Context ────────────────────────────────────────────

registerExtendedTool("getMilestoneContext", {
	category: "context",
	description:
		"Cards and progress for a milestone, grouped by horizon (now/later/done). Includes decisions.",
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
			const grouped: Record<string, MilestoneCard[]> = { now: [], later: [], done: [] };
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
	description:
		"All cards with a given tag, grouped by column. Input is normalized to a slug — 'Bug', 'bug', and 'BUG' all match the same tag.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		tag: z.string().describe("Tag label or slug — slugified for the lookup"),
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

			const tagSlug = slugify(tag);
			if (!tagSlug) {
				return err(`"${tag}" produces an empty slug — pass a tag with alphanumeric characters.`);
			}

			const tagged = await db.card.findMany({
				where: {
					column: { boardId },
					cardTags: { some: { tag: { slug: tagSlug } } },
				},
				include: {
					column: { select: { name: true, role: true } },
					checklists: { select: { completed: true } },
				},
				orderBy: { position: "asc" },
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
					slug: tagSlug,
					total: tagged.length,
					byColumn,
				},
				format
			);
		}),
});
