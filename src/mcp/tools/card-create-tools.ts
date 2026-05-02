import { z } from "zod";
import { db } from "../db.js";
import {
	buildTaxonomyMeta,
	resolveMilestoneForWrite,
	resolveTagsForWrite,
	syncCardTags,
} from "../taxonomy-utils.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, err, ok, safeExecute } from "../utils.js";

registerExtendedTool("bulkCreateCards", {
	category: "cards",
	description:
		"Create multiple cards in one call. Prefer `tagSlugs` (strict) and `milestoneId` (strict). Legacy `tags` and `milestoneName` still work but emit `_deprecated` warnings; slated for removal in the next major version.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		cards: z.array(
			z.object({
				columnName: z.string().describe("Column name (e.g. 'Backlog', 'In Progress')"),
				title: z.string().describe("Card title"),
				description: z.string().optional().describe("Markdown"),
				priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE"),
				tagSlugs: z
					.array(z.string())
					.optional()
					.describe("Strict — slugs must already exist in the project."),
				tags: z
					.array(z.string())
					.optional()
					.describe("Deprecated (removed v5.0.0) — use tagSlugs."),
				milestoneId: z
					.string()
					.uuid()
					.nullable()
					.optional()
					.describe("Strict — milestone UUID; null to leave unassigned."),
				milestoneName: z
					.string()
					.optional()
					.describe("Deprecated (removed v5.0.0) — use milestoneId."),
				metadata: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Agent-writable JSON metadata"),
			})
		),
	}),
	handler: ({ boardId, cards }) =>
		safeExecute(async () => {
			const board = await db.board.findUnique({
				where: { id: boardId as string },
				select: { projectId: true },
			});
			if (!board)
				return err("Board not found.", "Use listProjects → listBoards to find a valid boardId.");

			const columns = await db.column.findMany({ where: { boardId: boardId as string } });
			const columnMap = new Map(columns.map((c) => [c.name.toLowerCase(), c]));

			const created: Array<Record<string, unknown>> = [];
			const errors: string[] = [];
			const deprecatedSeen = new Set<string>();

			for (const input of cards as Array<Record<string, unknown>>) {
				const col = columnMap.get((input.columnName as string).toLowerCase());
				if (!col) {
					errors.push(
						`Column "${input.columnName}" not found for "${input.title}". Available: ${columns.map((c) => c.name).join(", ")}`
					);
					continue;
				}

				const tagResolution = await resolveTagsForWrite(db, board.projectId, {
					tagSlugs: input.tagSlugs as string[] | undefined,
					tags: input.tags as string[] | undefined,
				});
				if (!tagResolution.ok) {
					errors.push(
						`Tags for "${input.title}": ${tagResolution.errors.map((e) => e.slug).join(", ")} not found.`
					);
					continue;
				}

				const milestoneResolution = await resolveMilestoneForWrite(db, board.projectId, {
					milestoneId: input.milestoneId as string | null | undefined,
					milestoneName: input.milestoneName as string | null | undefined,
				});
				if (!milestoneResolution.ok) {
					errors.push(`Milestone for "${input.title}": ${milestoneResolution.error}`);
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
						title: input.title as string,
						description: input.description as string | undefined,
						priority: (input.priority as string) ?? "NONE",
						tags: JSON.stringify(tagResolution.applied ? tagResolution.labels : []),
						milestoneId:
							milestoneResolution.applied && milestoneResolution.milestoneId !== null
								? milestoneResolution.milestoneId
								: undefined,
						metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
						createdBy: "AGENT",
						position: (maxPos._max.position ?? -1) + 1,
					},
				});

				if (tagResolution.applied) {
					await syncCardTags(db, card.id, tagResolution.tagIds);
				}

				await db.activity.create({
					data: {
						cardId: card.id,
						action: "created",
						details: `Card #${cardNumber} "${input.title}" created in ${col.name}`,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				});

				const meta = buildTaxonomyMeta(tagResolution, milestoneResolution);
				if (meta?._deprecated) {
					for (const m of meta._deprecated) deprecatedSeen.add(m);
				}
				created.push({
					ref: `#${cardNumber}`,
					title: card.title,
					column: col.name,
					...(meta?._didYouMean ? { _didYouMean: meta._didYouMean } : {}),
				});
			}

			return ok({
				created,
				errors: errors.length > 0 ? errors : undefined,
				...(deprecatedSeen.size > 0 ? { _deprecated: [...deprecatedSeen] } : {}),
			});
		}),
});

registerExtendedTool("createCardFromTemplate", {
	category: "cards",
	description:
		"Create a card from a pre-filled template. Templates: Bug Report, Feature, Spike / Research, Tech Debt, Epic.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		columnName: z.string().describe("Column name (e.g. 'Backlog')"),
		template: z.enum(["Bug Report", "Feature", "Spike / Research", "Tech Debt", "Epic"]),
		title: z.string().describe("Card title (auto-prefixed with template type)"),
	}),
	handler: ({ boardId, columnName, template, title }) =>
		safeExecute(async () => {
			const templates: Record<
				string,
				{
					prefix: string;
					description: string;
					priority: string;
					tags: string[];
					checklist: string[];
				}
			> = {
				"Bug Report": {
					prefix: "Bug: ",
					description:
						"**What happened:**\n\n**Expected behavior:**\n\n**Steps to reproduce:**\n1. \n\n**Environment:**\n",
					priority: "HIGH",
					tags: ["bug"],
					checklist: ["Reproduce the issue", "Identify root cause", "Write fix", "Test fix"],
				},
				Feature: {
					prefix: "Feature: ",
					description: "**Goal:**\n\n**Approach:**\n\n**Acceptance criteria:**\n- \n",
					priority: "MEDIUM",
					tags: ["feature"],
					checklist: ["Design approach", "Implement", "Add tests", "Update docs if needed"],
				},
				"Spike / Research": {
					prefix: "Spike: ",
					description:
						"**Question to answer:**\n\n**Time-box:** 2 hours\n\n**Options to evaluate:**\n1. \n\n**Decision:**\n",
					priority: "LOW",
					tags: ["spike"],
					checklist: [
						"Research options",
						"Prototype if needed",
						"Document findings",
						"Make recommendation",
					],
				},
				"Tech Debt": {
					prefix: "Refactor: ",
					description: "**Current state:**\n\n**Desired state:**\n\n**Why now:**\n",
					priority: "LOW",
					tags: ["debt"],
					checklist: ["Assess impact", "Refactor", "Verify no regressions"],
				},
				Epic: {
					prefix: "Epic: ",
					description:
						"**Overview:**\n\n**Sub-tasks:**\nCreate individual cards for each sub-task.\n\n**Success criteria:**\n- \n",
					priority: "MEDIUM",
					tags: ["epic"],
					checklist: ["Break down into cards", "Prioritize sub-tasks", "Track progress"],
				},
			};

			const tmpl = templates[template as string];
			if (!tmpl) return err(`Template "${template}" not found.`);

			const column = await db.column.findFirst({
				where: { boardId: boardId as string, name: { equals: columnName as string } },
			});
			if (!column) {
				const cols = await db.column.findMany({
					where: { boardId: boardId as string },
					select: { name: true },
				});
				return err(
					`Column "${columnName}" not found.`,
					`Available: ${cols.map((c) => c.name).join(", ")}`
				);
			}

			const board = await db.board.findUnique({
				where: { id: boardId as string },
				select: { projectId: true },
			});
			if (!board) return err("Board not found.");

			const maxPos = await db.card.aggregate({
				where: { columnId: column.id },
				_max: { position: true },
			});
			const project = await db.project.update({
				where: { id: board.projectId },
				data: { nextCardNumber: { increment: 1 } },
			});
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
					actorName: AGENT_NAME,
				},
			});

			return ok({
				ref: `#${cardNumber}`,
				title: fullTitle,
				template,
				column: columnName,
				checklistItems: tmpl.checklist.length,
			});
		}),
});
