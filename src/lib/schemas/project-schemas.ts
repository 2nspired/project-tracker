import { z } from "zod";

export const PROJECT_COLORS = [
	"slate", "red", "orange", "amber", "yellow", "lime", "green",
	"emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
	"purple", "fuchsia", "pink", "rose",
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const createProjectSchema = z.object({
	name: z.string().min(1, "Name is required.").max(100),
	description: z.string().max(500).optional(),
	color: z.enum(PROJECT_COLORS).default("slate"),
});

export const updateProjectSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).optional(),
	color: z.enum(PROJECT_COLORS).optional(),
	favorite: z.boolean().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
