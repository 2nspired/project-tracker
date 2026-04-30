import { z } from "zod";

export const createMilestoneSchema = z.object({
	projectId: z.string().uuid(),
	name: z.string().min(1, "Name is required.").max(100),
	description: z.string().max(2000).optional(),
	targetDate: z.string().datetime().optional(),
	position: z.number().int().min(0).optional(),
});

export const updateMilestoneSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(2000).nullable().optional(),
	targetDate: z.string().datetime().nullable().optional(),
	position: z.number().int().min(0).optional(),
	state: z.enum(["active", "archived"]).optional(),
});

export const reorderMilestonesSchema = z.object({
	projectId: z.string().uuid(),
	orderedIds: z.array(z.string().uuid()),
});

export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;
export type ReorderMilestonesInput = z.infer<typeof reorderMilestonesSchema>;
