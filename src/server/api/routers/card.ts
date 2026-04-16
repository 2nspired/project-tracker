import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitCardChanged, emitCardChangedViaColumn } from "@/lib/events";
import { createCardSchema, moveCardSchema, updateCardSchema } from "@/lib/schemas/card-schemas";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { cardService } from "@/server/services/card-service";
import { commitSummaryService } from "@/server/services/commit-summary-service";

export const cardRouter = createTRPCRouter({
	listAll: publicProcedure
		.input(
			z
				.object({
					priority: z.string().optional(),
					tag: z.string().optional(),
					search: z.string().optional(),
				})
				.optional()
		)
		.query(async ({ input }) => {
			const result = await cardService.listAll(input);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getById: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
		const result = await cardService.getById(input.id);
		if (!result.success) {
			throw new TRPCError({ code: "NOT_FOUND", message: result.error.message });
		}
		return result.data;
	}),

	create: publicProcedure.input(createCardSchema).mutation(async ({ input }) => {
		const result = await cardService.create(input);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		emitCardChangedViaColumn(input.columnId);
		return result.data;
	}),

	update: publicProcedure
		.input(z.object({ id: z.string().uuid(), data: updateCardSchema }))
		.mutation(async ({ input }) => {
			const result = await cardService.update(input.id, input.data);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			emitCardChanged(input.id);
			return result.data;
		}),

	move: publicProcedure
		.input(z.object({ id: z.string().uuid(), data: moveCardSchema }))
		.mutation(async ({ input }) => {
			const result = await cardService.move(input.id, input.data);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			emitCardChangedViaColumn(input.data.columnId);
			return result.data;
		}),

	getCommitSummary: publicProcedure
		.input(z.object({ cardId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await commitSummaryService.getForCard(input.cardId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
		const result = await cardService.delete(input.id);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		emitCardChangedViaColumn(result.data.columnId);
		return result.data;
	}),
});
