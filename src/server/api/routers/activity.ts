import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { activityService } from "@/server/services/activity-service";

export const activityRouter = createTRPCRouter({
	list: publicProcedure.input(z.object({ cardId: z.string().uuid() })).query(async ({ input }) => {
		const result = await activityService.listByCard(input.cardId);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	listByBoard: publicProcedure
		.input(z.object({ boardId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await activityService.listByBoard(input.boardId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	flowMetrics: publicProcedure
		.input(z.object({ boardId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await activityService.getFlowMetrics(input.boardId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),
});
