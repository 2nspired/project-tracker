import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createProjectSchema, updateProjectSchema } from "@/lib/schemas/project-schemas";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import { onboardingService } from "@/server/services/onboarding-service";
import { projectService } from "@/server/services/project-service";

export const projectRouter = createTRPCRouter({
	list: publicProcedure.query(async () => {
		const result = await projectService.list();
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	getById: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
		const result = await projectService.getById(input.id);
		if (!result.success) {
			throw new TRPCError({ code: "NOT_FOUND", message: result.error.message });
		}
		return result.data;
	}),

	create: publicProcedure.input(createProjectSchema).mutation(async ({ input }) => {
		const result = await projectService.create(input);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	update: publicProcedure
		.input(z.object({ id: z.string().uuid(), data: updateProjectSchema }))
		.mutation(async ({ input }) => {
			const result = await projectService.update(input.id, input.data);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
		const result = await projectService.delete(input.id);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	toggleFavorite: publicProcedure
		.input(z.object({ id: z.string().uuid() }))
		.mutation(async ({ input }) => {
			const result = await projectService.getById(input.id);
			if (!result.success) {
				throw new TRPCError({ code: "NOT_FOUND", message: result.error.message });
			}
			const updated = await projectService.update(input.id, { favorite: !result.data.favorite });
			if (!updated.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: updated.error.message });
			}
			return updated.data;
		}),

	setDefaultBoard: publicProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				boardId: z.string().uuid().nullable(),
			})
		)
		.mutation(async ({ input }) => {
			if (input.boardId !== null) {
				const board = await db.board.findUnique({
					where: { id: input.boardId },
					select: { projectId: true },
				});
				if (!board || board.projectId !== input.projectId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Board does not belong to this project.",
					});
				}
			}
			const updated = await projectService.update(input.projectId, {
				defaultBoardId: input.boardId,
			});
			if (!updated.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: updated.error.message });
			}
			return updated.data;
		}),

	seedTutorial: publicProcedure.mutation(async () => {
		const result = await onboardingService.seedTutorial();
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),
});
