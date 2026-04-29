import { z } from "zod";

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

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type RenameTagInput = z.infer<typeof renameTagSchema>;
export type MergeTagsInput = z.infer<typeof mergeTagsSchema>;
