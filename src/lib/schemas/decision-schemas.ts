import { z } from "zod";

export const decisionStatuses = ["proposed", "accepted", "rejected", "superseded"] as const;
export type DecisionStatus = (typeof decisionStatuses)[number];

export const createDecisionSchema = z.object({
	projectId: z.string().uuid(),
	cardId: z.string().uuid().nullable().optional(),
	title: z.string().min(1).max(200),
	status: z.enum(decisionStatuses).default("proposed"),
	decision: z.string().min(1),
	alternatives: z.array(z.string()).default([]),
	rationale: z.string().default(""),
	author: z.string().default("HUMAN"),
});

export const updateDecisionSchema = z.object({
	title: z.string().min(1).max(200).optional(),
	status: z.enum(decisionStatuses).optional(),
	decision: z.string().min(1).optional(),
	alternatives: z.array(z.string()).optional(),
	rationale: z.string().optional(),
});

export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;
export type UpdateDecisionInput = z.infer<typeof updateDecisionSchema>;
