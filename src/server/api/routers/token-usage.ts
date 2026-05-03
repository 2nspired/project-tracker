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
		.input(
			z.object({
				projectId: z.string().uuid(),
				// Optional board scope (#200 Phase 1a). When set, narrows the
				// summary to the cards on that board via the same session-
				// expansion rule as `getCardSummary` — so a session that touched
				// cards on multiple boards contributes its full cost to *each*
				// board's total, and `boardA + boardB > project` is *expected*,
				// not a bug. UI plumbing (board picker, route segment) follows
				// in Phase 2a; this just exposes the optional knob.
				boardId: z.string().uuid().optional(),
			})
		)
		.query(async ({ input }) => {
			const result = await tokenUsageService.getProjectSummary(input.projectId, input.boardId);
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

	getTopSessions: publicProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				boardId: z.string().uuid().optional(),
				limit: z.number().int().min(1).max(100).optional(),
			})
		)
		.query(async ({ input }) => {
			const result = await tokenUsageService.getTopSessions(input.projectId, {
				boardId: input.boardId,
				limit: input.limit,
			});
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getDailyCostSeries: publicProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				// Optional board scope (#200 Phase 1a) — same semantics as
				// `getProjectSummary.boardId`. React Query's cache key picks up
				// the new param automatically, so existing callers that don't
				// supply `boardId` keep their cache entries.
				boardId: z.string().uuid().optional(),
			})
		)
		.query(async ({ input }) => {
			const result = await tokenUsageService.getDailyCostSeries(input.projectId, input.boardId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getDailyCostShareSeries: publicProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				boardId: z.string().uuid(),
			})
		)
		.query(async ({ input }) => {
			const result = await tokenUsageService.getDailyCostShareSeries(
				input.projectId,
				input.boardId
			);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getDiagnostics: publicProcedure.query(async () => {
		const result = await tokenUsageService.getDiagnostics();
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
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

	// Measure briefMe payload vs. naive bootstrap and persist on
	// Project.metadata.tokenBaseline. Backs the "Pigeon paid for itself"
	// surface — invoked from the project settings page (and via the MCP
	// recalibrateBaseline tool). #192
	recalibrateBaseline: publicProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.mutation(async ({ input }) => {
			const result = await tokenUsageService.recalibrateBaseline(input.projectId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	// Per-session Pigeon overhead — used by `<PigeonOverheadChip>` on
	// session-detail surfaces. Returns 0/0 (not an error) when the session
	// has no `ToolCallLog` rows so the chip can self-hide. #194
	getSessionPigeonOverhead: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.query(async ({ input }) => {
			const result = await tokenUsageService.getSessionPigeonOverhead(input.sessionId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	// Card-scoped Pigeon overhead — backs `<CardPigeonOverheadChip>` on the
	// card-detail sheet. Aggregates across every session that touched the
	// card via the same session-expansion rule as `getCardSummary`. #194
	getCardPigeonOverhead: publicProcedure
		.input(z.object({ cardId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await tokenUsageService.getCardPigeonOverhead(input.cardId);
			if (!result.success) {
				throw new TRPCError({
					code: result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
					message: result.error.message,
				});
			}
			return result.data;
		}),

	// Project-wide Pigeon overhead — backs `<PigeonOverheadSection>` on
	// the Costs page (revived in #274 after #236 dropped it). Aggregates
	// `ToolCallLog.responseTokens` across every session in the project,
	// priced at each session's primary-model output rate. Optional
	// `boardId` narrows scope via the same session-expansion rule as
	// `getProjectSummary`.
	getProjectPigeonOverhead: publicProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				boardId: z.string().uuid().optional(),
			})
		)
		.query(async ({ input }) => {
			const result = await tokenUsageService.getProjectPigeonOverhead(input.projectId, {
				boardId: input.boardId,
			});
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),
});
