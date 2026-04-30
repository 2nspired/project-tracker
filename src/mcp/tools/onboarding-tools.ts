import { z } from "zod";
import { seedTutorialProject } from "../../lib/onboarding/seed-runner.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, safeExecute } from "../utils.js";

// ─── Onboarding ──────────────────────────────────────────────────

registerExtendedTool("seedTutorial", {
	category: "setup",
	description:
		'Create the "Learn Pigeon" tutorial project with sample cards, checklists, milestones, and more. Idempotent — safe to call multiple times.',
	parameters: z.object({}),
	handler: () =>
		safeExecute(async () => {
			const result = await seedTutorialProject(db);
			if (!result) {
				return ok({
					alreadyExists: true,
					message: "Tutorial project already exists. No changes made.",
				});
			}
			return ok({
				alreadyExists: false,
				projectId: result.projectId,
				boardId: result.boardId,
				message:
					"Tutorial project created! Use `resume-session` prompt with the boardId to explore it.",
			});
		}),
});
