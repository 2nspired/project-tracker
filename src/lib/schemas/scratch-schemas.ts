import { z } from "zod";

export const setScratchSchema = z.object({
	boardId: z.string().uuid(),
	agentName: z.string().min(1).max(50),
	key: z.string().min(1).max(100),
	value: z.string(),
	ttlDays: z.number().int().min(1).max(90).default(7),
});

export type SetScratchInput = z.infer<typeof setScratchSchema>;
