import { seedTutorialProject } from "@/lib/onboarding/seed-runner";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

interface SeedTutorialResult {
	alreadyExists: boolean;
	projectId: string;
	boardId: string;
}

async function seedTutorial(): Promise<ServiceResult<SeedTutorialResult>> {
	try {
		const result = await seedTutorialProject(db);
		if (!result) {
			// Already exists — look up the existing IDs
			const existing = await db.project.findUnique({
				where: { slug: "learn-project-tracker" },
				include: { boards: { take: 1, select: { id: true } } },
			});
			if (!existing || existing.boards.length === 0) {
				return {
					success: false,
					error: {
						code: "SEED_FAILED",
						message:
							"Tutorial project lookup returned no rows after seedTutorialProject reported alreadyExists",
					},
				};
			}
			return {
				success: true,
				data: {
					alreadyExists: true,
					projectId: existing.id,
					boardId: existing.boards[0].id,
				},
			};
		}
		return {
			success: true,
			data: {
				alreadyExists: false,
				projectId: result.projectId,
				boardId: result.boardId,
			},
		};
	} catch (e) {
		return {
			success: false,
			error: {
				code: "SEED_FAILED",
				message: e instanceof Error ? e.message : "Failed to seed tutorial project",
			},
		};
	}
}

export const onboardingService = { seedTutorial };
