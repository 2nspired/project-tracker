import { z } from "zod";

export const priorityValues = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type Priority = (typeof priorityValues)[number];

export const actorValues = ["HUMAN", "AGENT"] as const;
export type ActorType = (typeof actorValues)[number];

export const createCardSchema = z.object({
	columnId: z.string().uuid(),
	title: z.string().min(1, "Title is required.").max(200),
	description: z.string().max(5000).optional(),
	priority: z.enum(priorityValues).default("NONE"),
	tags: z.array(z.string().max(50)).default([]),
	dueDate: z.string().datetime().optional(),
	milestoneId: z.string().uuid().nullable().optional(),
	createdBy: z.enum(actorValues).default("HUMAN"),
});

export const updateCardSchema = z.object({
	title: z.string().min(1).max(200).optional(),
	description: z.string().max(5000).optional(),
	priority: z.enum(priorityValues).optional(),
	tags: z.array(z.string().max(50)).optional(),
	dueDate: z.string().datetime().nullable().optional(),
	milestoneId: z.string().uuid().nullable().optional(),
});

export const moveCardSchema = z.object({
	columnId: z.string().uuid(),
	position: z.number().int().min(0),
});

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type MoveCardInput = z.infer<typeof moveCardSchema>;
