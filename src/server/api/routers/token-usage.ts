import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { tokenUsageService } from "@/server/services/token-usage-service";

const modelPricingSchema = z.object({
	inputPerMTok: z.number().min(0).optional(),
	outputPerMTok: z.number().min(0).optional(),
	cacheReadPerMTok: z.number().min(0).optional(),
	cacheCreation1hPerMTok: z.number().min(0).optional(),
	cacheCreation5mPerMTok: z.number().min(0).optional(),
});

export const tokenUsageRouter = createTRPCRouter({
	getProjectSummary: publicProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await tokenUsageService.getProjectSummary(input.projectId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getSessionSummary: publicProcedure
		.input(z.object({ sessionId: z.string(), projectId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await tokenUsageService.getSessionSummary(input.sessionId, input.projectId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getCardSummary: publicProcedure
		.input(z.object({ cardId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await tokenUsageService.getCardSummary(input.cardId);
			if (!result.success) {
				throw new TRPCError({
					code: result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
					message: result.error.message,
				});
			}
			return result.data;
		}),

	getMilestoneSummary: publicProcedure
		.input(z.object({ milestoneId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await tokenUsageService.getMilestoneSummary(input.milestoneId);
			if (!result.success) {
				throw new TRPCError({
					code: result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
					message: result.error.message,
				});
			}
			return result.data;
		}),

	getPricing: publicProcedure.query(async () => {
		const result = await tokenUsageService.getPricing();
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	updatePricing: publicProcedure
		.input(z.object({ overrides: z.record(z.string(), modelPricingSchema) }))
		.mutation(async ({ input }) => {
			const result = await tokenUsageService.updatePricing(input.overrides);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),
});
