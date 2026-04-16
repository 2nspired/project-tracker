import { z } from "zod";

export const queryCardsSchema = z.object({
	boardId: z.string().uuid(),
	priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
	columnName: z.string().optional(),
	tags: z.array(z.string()).optional(),
	milestoneName: z.string().optional(),
	createdBefore: z.string().datetime().optional(),
	updatedBefore: z.string().datetime().optional(),
	staleDays: z.number().int().min(1).optional(),
	hasBlockers: z.boolean().optional(),
	limit: z.number().int().min(1).max(200).default(50),
});

export type QueryCardsInput = z.infer<typeof queryCardsSchema>;
