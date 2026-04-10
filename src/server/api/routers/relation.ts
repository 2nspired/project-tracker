import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createRelationSchema } from "@/lib/schemas/relation-schemas";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { relationService } from "@/server/services/relation-service";

export const relationRouter = createTRPCRouter({
	link: publicProcedure.input(createRelationSchema).mutation(async ({ input }) => {
		const result = await relationService.link(input);
		if (!result.success) {
			throw new TRPCError({
				code: result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
				message: result.error.message,
			});
		}
		return result.data;
	}),

	unlink: publicProcedure
		.input(
			z.object({
				fromCardId: z.string().uuid(),
				toCardId: z.string().uuid(),
				type: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await relationService.unlink(input.fromCardId, input.toCardId, input.type);
			if (!result.success) {
				throw new TRPCError({
					code: result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
					message: result.error.message,
				});
			}
			return result.data;
		}),

	getForCard: publicProcedure
		.input(z.object({ cardId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await relationService.getForCard(input.cardId);
			if (!result.success) {
				throw new TRPCError({
					code: result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
					message: result.error.message,
				});
			}
			return result.data;
		}),

	getBlockers: publicProcedure
		.input(z.object({ boardId: z.string().uuid().optional() }).optional())
		.query(async ({ input }) => {
			const result = await relationService.getBlockers(input?.boardId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),
});
