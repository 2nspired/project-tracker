import { z } from "zod";

export const createBoardSchema = z.object({
	projectId: z.string().uuid(),
	name: z.string().min(1, "Name is required.").max(100),
	description: z.string().max(500).optional(),
});

export const updateBoardSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).optional(),
	staleInProgressDays: z.number().int().min(0).max(365).nullable().optional(),
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
