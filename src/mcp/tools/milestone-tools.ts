import { z } from "zod";
import { editDistance as nameDistance, slugify as slugifyName } from "@/lib/slugify";
import { milestoneService } from "@/server/services/milestone-service";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, errWithToolHint, ok, safeExecute } from "../utils.js";

registerExtendedTool("createMilestone", {
	category: "milestones",
	description: "Create a milestone for a project.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		name: z.string().describe("e.g. 'MVP', 'v1.1', 'Q2 Launch'"),
		description: z.string().optional(),
		targetDate: z.string().datetime().optional().describe("ISO 8601"),
	}),
	handler: ({ projectId, name, description, targetDate }) =>
		safeExecute(async () => {
			const maxPos = await db.milestone.aggregate({
				where: { projectId: projectId as string },
				_max: { position: true },
			});
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
	description:
		'Update a milestone\'s name, description, target date, or state. Pass `state: "archived"` to hide the milestone from the picker without deleting it.',
	parameters: z.object({
		milestoneId: z.string().describe("UUID from getRoadmap or listMilestones"),
		name: z.string().optional(),
		description: z.string().nullable().optional().describe("null to clear"),
		targetDate: z.string().datetime().nullable().optional().describe("ISO 8601, null to clear"),
		state: z
			.enum(["active", "archived"])
			.optional()
			.describe("'archived' hides the milestone from the picker; cards keep their assignment."),
	}),
	annotations: { idempotentHint: true },
	handler: ({ milestoneId, name, description, targetDate, state }) =>
		safeExecute(async () => {
			const existing = await db.milestone.findUnique({ where: { id: milestoneId as string } });
			if (!existing)
				return errWithToolHint("Milestone not found.", "listMilestones", {
					projectId: '"<projectId>"',
				});

			const milestone = await db.milestone.update({
				where: { id: milestoneId as string },
				data: {
					name: name as string | undefined,
					description: description as string | null | undefined,
					targetDate:
						targetDate !== undefined
							? targetDate
								? new Date(targetDate as string)
								: null
							: undefined,
					state: state as "active" | "archived" | undefined,
				},
			});
			return ok({
				id: milestone.id,
				name: milestone.name,
				state: milestone.state,
				updated: true,
			});
		}),
});

registerExtendedTool("mergeMilestones", {
	category: "milestones",
	description:
		"Merge one milestone into another within the same project. Rewrites every card's milestoneId from `from` to `into`, then deletes the source milestone. Use this when an agent or human created a duplicate (e.g. 'Getting Started' vs 'getting started' on a pre-v4.2 schema).",
	parameters: z.object({
		fromMilestoneId: z.string().uuid().describe("Source milestone UUID — deleted after merge"),
		intoMilestoneId: z.string().uuid().describe("Destination milestone UUID — kept"),
	}),
	handler: ({ fromMilestoneId, intoMilestoneId }) =>
		safeExecute(async () => {
			const result = await milestoneService.merge({
				fromMilestoneId: fromMilestoneId as string,
				intoMilestoneId: intoMilestoneId as string,
			});
			if (!result.success) return err(result.error.message);
			return ok({
				merged: true,
				rewroteCount: result.data.rewroteCount,
			});
		}),
});

registerExtendedTool("listMilestones", {
	category: "milestones",
	description:
		"List milestones for a project with card counts, done/total breakdown, completion percentage, state, and v4.2 governance hints (singleton-after-days, possible-merge near-miss neighbours). Use the hints to drive a one-time triage pass with mergeMilestones / updateMilestone({ state: 'archived' }).",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId }) =>
		safeExecute(async () => {
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

			// Pre-compute slugs for all milestones in the project so we can
			// build the possibleMerge neighbour list in O(n²) without a DB
			// round-trip per milestone. n is bounded by the per-project count
			// (current high-water mark across the whole codebase: ~10).
			const slugged = milestones.map((m) => ({
				id: m.id,
				name: m.name,
				slug: slugifyName(m.name),
				createdAt: m.createdAt,
			}));
			const SINGLETON_DAYS = 60;
			const NOW = Date.now();

			return ok(
				milestones.map((m, i) => {
					const total = m._count.cards;
					const done = m.cards.filter((c) => c.column.role === "done").length;
					const ageDays = Math.floor((NOW - m.createdAt.getTime()) / (1000 * 60 * 60 * 24));

					const possibleMerge: Array<{ id: string; name: string; distance: number }> = [];
					const mineSlug = slugged[i].slug;
					if (mineSlug) {
						for (let j = 0; j < slugged.length; j++) {
							if (j === i) continue;
							const other = slugged[j];
							if (!other.slug) continue;
							const distance = nameDistance(mineSlug, other.slug, 2);
							if (distance <= 2) {
								possibleMerge.push({ id: other.id, name: other.name, distance });
							}
						}
						possibleMerge.sort((a, b) => a.distance - b.distance);
					}

					const governanceHints: Record<string, unknown> = {};
					if (total === 1 && ageDays > SINGLETON_DAYS) {
						governanceHints.singletonAfterDays = ageDays;
					}
					if (possibleMerge.length > 0) {
						governanceHints.possibleMerge = possibleMerge;
					}

					return {
						id: m.id,
						name: m.name,
						description: m.description,
						targetDate: m.targetDate,
						state: m.state,
						cardCount: total,
						done,
						progress: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%",
						position: m.position,
						...(Object.keys(governanceHints).length > 0 && {
							_governanceHints: governanceHints,
						}),
					};
				})
			);
		}),
});
