import { z } from "zod";

// 6-digit hex color (e.g. "#3b82f6"). Strict: 3-digit shorthand, named
// colors, and out-of-range hex are rejected so the persisted value is
// always a single render-ready format. The settings UI clears via null;
// undefined means "leave unchanged" on update.
export const accentColorSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, "Accent color must be a 6-digit hex like #3b82f6.")
	.nullable()
	.optional();

export const createBoardSchema = z.object({
	projectId: z.string().uuid(),
	name: z.string().min(1, "Name is required.").max(100),
	description: z.string().max(500).optional(),
});

export const updateBoardSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).optional(),
	staleInProgressDays: z.number().int().min(0).max(365).nullable().optional(),
	accentColor: accentColorSchema,
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
