import type { Milestone } from "prisma/generated/client";
import { getHorizon } from "@/lib/column-roles";
import type {
	CreateMilestoneInput,
	ReorderMilestonesInput,
	UpdateMilestoneInput,
} from "@/lib/schemas/milestone-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type MilestoneWithCounts = Milestone & {
	_count: { cards: number };
	cardsByStatus: { now: number; later: number; done: number };
};

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

export const milestoneService = {
	list,
	getById,
	create,
	update,
	reorder,
	delete: deleteMilestone,
};
