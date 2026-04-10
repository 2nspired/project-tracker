import { z } from "zod";

export const relationTypes = ["blocks", "related", "parent"] as const;
export type RelationType = (typeof relationTypes)[number];

export const createRelationSchema = z.object({
	fromCardId: z.string().uuid(),
	toCardId: z.string().uuid(),
	type: z.enum(relationTypes),
});

export type CreateRelationInput = z.infer<typeof createRelationSchema>;
