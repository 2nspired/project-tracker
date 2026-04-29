import type { Milestone, PrismaClient } from "prisma/generated/client";
import { getHorizon } from "@/lib/column-roles";
import type {
	CreateMilestoneInput,
	ReorderMilestonesInput,
	UpdateMilestoneInput,
} from "@/lib/schemas/milestone-schemas";
import { editDistance, slugify } from "@/lib/slugify";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type MilestoneWithCounts = Milestone & {
	_count: { cards: number };
	cardsByStatus: { now: number; later: number; done: number };
};

export type MilestoneResolveResult = {
	id: string;
	name: string;
	created: boolean;
	// Existing milestones within Levenshtein 2 of the input slug. Empty on
	// exact (case-insensitive slug) hits and on first-time creates with no
	// near neighbours. Sorted ascending by distance.
	didYouMean: { id: string; name: string; distance: number }[];
};

// Standalone factory-style helper — the MCP process can call this with its
// own PrismaClient instance. Replaces the legacy `resolveOrCreateMilestone`
// in src/mcp/utils.ts (which now delegates here). The two key behaviour
// changes vs. the legacy version:
//   1. Case-insensitive lookup via `slugify()` — "Getting Started" and
//      "getting started" no longer create two milestones.
//   2. `_didYouMean` neighbours surfaced for near-miss creates so callers
//      can flag possible drift in the response payload.
export async function resolveOrCreateMilestone(
	prisma: PrismaClient,
	projectId: string,
	name: string
): Promise<ServiceResult<MilestoneResolveResult>> {
	try {
		const trimmed = name.trim();
		if (!trimmed) {
			return {
				success: false,
				error: { code: "INVALID_INPUT", message: "Milestone name cannot be empty." },
			};
		}
		const inputSlug = slugify(trimmed);
		if (!inputSlug) {
			return {
				success: false,
				error: {
					code: "INVALID_INPUT",
					message: `"${name}" must contain alphanumeric characters.`,
				},
			};
		}

		const candidates = await prisma.milestone.findMany({
			where: { projectId },
			select: { id: true, name: true },
		});

		let exact: { id: string; name: string } | null = null;
		const didYouMean: { id: string; name: string; distance: number }[] = [];
		for (const m of candidates) {
			const mSlug = slugify(m.name);
			if (mSlug === inputSlug) {
				exact = m;
				break;
			}
			const distance = editDistance(inputSlug, mSlug, 2);
			if (distance <= 2) {
				didYouMean.push({ id: m.id, name: m.name, distance });
			}
		}
		if (exact) {
			return {
				success: true,
				data: { id: exact.id, name: exact.name, created: false, didYouMean: [] },
			};
		}
		didYouMean.sort((a, b) => a.distance - b.distance);

		const maxPos = await prisma.milestone.aggregate({
			where: { projectId },
			_max: { position: true },
		});
		const created = await prisma.milestone.create({
			data: { projectId, name: trimmed, position: (maxPos._max.position ?? -1) + 1 },
		});
		return {
			success: true,
			data: { id: created.id, name: created.name, created: true, didYouMean },
		};
	} catch (error) {
		console.error("[MILESTONE_SERVICE] resolveOrCreate error:", error);
		return {
			success: false,
			error: { code: "RESOLVE_FAILED", message: "Failed to resolve or create milestone." },
		};
	}
}

async function list(projectId: string): Promise<ServiceResult<MilestoneWithCounts[]>> {
	try {
		const milestones = await db.milestone.findMany({
			where: { projectId },
			orderBy: { position: "asc" },
			include: {
				_count: { select: { cards: true } },
				cards: {
					select: {
						column: { select: { name: true, role: true, isParking: true } },
					},
				},
			},
		});

		const data = milestones.map((m) => {
			const cardsByStatus = { now: 0, later: 0, done: 0 };
			for (const card of m.cards) {
				cardsByStatus[getHorizon(card.column)]++;
			}
			const { cards: _, ...rest } = m;
			return { ...rest, cardsByStatus };
		});

		return { success: true, data };
	} catch (error) {
		console.error("[MILESTONE_SERVICE] list error:", error);
		return {
			success: false,
			error: { code: "LIST_FAILED", message: "Failed to fetch milestones." },
		};
	}
}

async function getById(
	milestoneId: string
): Promise<
	ServiceResult<
		Milestone & { cards: Array<{ id: string; title: string; number: number; priority: string }> }
	>
> {
	try {
		const milestone = await db.milestone.findUnique({
			where: { id: milestoneId },
			include: {
				cards: {
					select: { id: true, title: true, number: true, priority: true },
					orderBy: { position: "asc" },
				},
			},
		});
		if (!milestone) {
			return { success: false, error: { code: "NOT_FOUND", message: "Milestone not found." } };
		}
		return { success: true, data: milestone };
	} catch (error) {
		console.error("[MILESTONE_SERVICE] getById error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch milestone." } };
	}
}

async function create(data: CreateMilestoneInput): Promise<ServiceResult<Milestone>> {
	try {
		// Auto-assign position if not provided
		let position = data.position;
		if (position === undefined) {
			const max = await db.milestone.aggregate({
				where: { projectId: data.projectId },
				_max: { position: true },
			});
			position = (max._max.position ?? -1) + 1;
		}

		const milestone = await db.milestone.create({
			data: {
				projectId: data.projectId,
				name: data.name,
				description: data.description,
				targetDate: data.targetDate ? new Date(data.targetDate) : undefined,
				position,
			},
		});
		return { success: true, data: milestone };
	} catch (error) {
		console.error("[MILESTONE_SERVICE] create error:", error);
		return {
			success: false,
			error: { code: "CREATE_FAILED", message: "Failed to create milestone." },
		};
	}
}

async function update(
	milestoneId: string,
	data: UpdateMilestoneInput
): Promise<ServiceResult<Milestone>> {
	try {
		const existing = await db.milestone.findUnique({ where: { id: milestoneId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Milestone not found." } };
		}

		const milestone = await db.milestone.update({
			where: { id: milestoneId },
			data: {
				name: data.name,
				description: data.description,
				targetDate:
					data.targetDate !== undefined
						? data.targetDate
							? new Date(data.targetDate)
							: null
						: undefined,
				position: data.position,
				state: data.state,
			},
		});
		return { success: true, data: milestone };
	} catch (error) {
		console.error("[MILESTONE_SERVICE] update error:", error);
		return {
			success: false,
			error: { code: "UPDATE_FAILED", message: "Failed to update milestone." },
		};
	}
}

async function reorder(data: ReorderMilestonesInput): Promise<ServiceResult<boolean>> {
	try {
		const updates = data.orderedIds.map((id, i) =>
			db.milestone.update({ where: { id }, data: { position: i } })
		);
		await db.$transaction(updates);
		return { success: true, data: true };
	} catch (error) {
		console.error("[MILESTONE_SERVICE] reorder error:", error);
		return {
			success: false,
			error: { code: "REORDER_FAILED", message: "Failed to reorder milestones." },
		};
	}
}

async function merge(input: {
	fromMilestoneId: string;
	intoMilestoneId: string;
}): Promise<ServiceResult<{ rewroteCount: number; projectId: string }>> {
	try {
		if (input.fromMilestoneId === input.intoMilestoneId) {
			return {
				success: false,
				error: { code: "INVALID_INPUT", message: "Cannot merge a milestone into itself." },
			};
		}
		const result = await db.$transaction(async (tx) => {
			const [from, into] = await Promise.all([
				tx.milestone.findUnique({ where: { id: input.fromMilestoneId } }),
				tx.milestone.findUnique({ where: { id: input.intoMilestoneId } }),
			]);
			if (!from || !into) {
				throw new Error("One or both milestones not found.");
			}
			if (from.projectId !== into.projectId) {
				throw new Error("Cannot merge milestones across projects.");
			}
			const update = await tx.card.updateMany({
				where: { milestoneId: input.fromMilestoneId },
				data: { milestoneId: input.intoMilestoneId },
			});
			await tx.milestone.delete({ where: { id: input.fromMilestoneId } });
			return { rewroteCount: update.count, projectId: from.projectId };
		});
		return { success: true, data: result };
	} catch (error) {
		console.error("[MILESTONE_SERVICE] merge error:", error);
		return {
			success: false,
			error: {
				code: "MERGE_FAILED",
				message: error instanceof Error ? error.message : "Failed to merge milestones.",
			},
		};
	}
}

async function deleteMilestone(milestoneId: string): Promise<ServiceResult<Milestone>> {
	try {
		const existing = await db.milestone.findUnique({ where: { id: milestoneId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Milestone not found." } };
		}

		const milestone = await db.milestone.delete({ where: { id: milestoneId } });
		return { success: true, data: milestone };
	} catch (error) {
		console.error("[MILESTONE_SERVICE] delete error:", error);
		return {
			success: false,
			error: { code: "DELETE_FAILED", message: "Failed to delete milestone." },
		};
	}
}

// Singleton-style method for tRPC callers — wraps the standalone factory
// function with the Next.js db. MCP callers should call
// `resolveOrCreateMilestone` directly with their own PrismaClient.
async function resolveOrCreate(projectId: string, name: string) {
	return resolveOrCreateMilestone(db, projectId, name);
}

export const milestoneService = {
	list,
	getById,
	create,
	update,
	reorder,
	resolveOrCreate,
	merge,
	delete: deleteMilestone,
};
