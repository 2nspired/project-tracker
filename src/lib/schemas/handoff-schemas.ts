import { z } from "zod";

export const createHandoffSchema = z.object({
	boardId: z.string().uuid(),
	agentName: z.string().min(1).max(50),
	workingOn: z.array(z.string()).default([]),
	findings: z.array(z.string()).default([]),
	nextSteps: z.array(z.string()).default([]),
	blockers: z.array(z.string()).default([]),
	summary: z.string().default(""),
});

export type CreateHandoffInput = z.infer<typeof createHandoffSchema>;
