import { z } from "zod";

export const tagStateSchema = z.enum(["active", "archived"]);

export const listTagsSchema = z.object({
	projectId: z.string().uuid(),
	state: tagStateSchema.optional(),
});

export const createTagSchema = z.object({
	projectId: z.string().uuid(),
	label: z.string().min(1, "Label is required.").max(50),
});

export const renameTagSchema = z.object({
	tagId: z.string().uuid(),
	label: z.string().min(1).max(50),
});

export const mergeTagsSchema = z.object({
	fromTagId: z.string().uuid(),
	intoTagId: z.string().uuid(),
});

export const deleteTagSchema = z.object({
	tagId: z.string().uuid(),
});

export type TagStateInput = z.infer<typeof tagStateSchema>;
export type ListTagsInput = z.infer<typeof listTagsSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type RenameTagInput = z.infer<typeof renameTagSchema>;
export type MergeTagsInput = z.infer<typeof mergeTagsSchema>;
export type DeleteTagInput = z.infer<typeof deleteTagSchema>;
