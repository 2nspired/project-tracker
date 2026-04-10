import { z } from "zod";

export const setRepoPathSchema = z.object({
	projectId: z.string().uuid(),
	repoPath: z.string().min(1),
});

export const syncGitSchema = z.object({
	projectId: z.string().uuid(),
	since: z.string().optional().describe("ISO datetime or git date string like '2 weeks ago'"),
});

export type SetRepoPathInput = z.infer<typeof setRepoPathSchema>;
export type SyncGitInput = z.infer<typeof syncGitSchema>;
