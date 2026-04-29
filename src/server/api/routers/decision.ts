import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createDecisionSchema, updateDecisionSchema } from "@/lib/schemas/decision-schemas";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { decisionService } from "@/server/services/decision-service";

export const decisionRouter = createTRPCRouter({
	create: publicProcedure.input(createDecisionSchema).mutation(async ({ input }) => {
		const result = await decisionService.create(input);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	update: publicProcedure
		.input(z.object({ id: z.string().uuid(), data: updateDecisionSchema }))
		.mutation(async ({ input }) => {
			const result = await decisionService.update(input.id, input.data);
			if (!result.success) {
				const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
				throw new TRPCError({ code, message: result.error.message });
			}
			return result.data;
		}),

	getById: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
		const result = await decisionService.getById(input.id);
		if (!result.success) {
			const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
			throw new TRPCError({ code, message: result.error.message });
		}
		return result.data;
	}),

	list: publicProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				cardId: z.string().uuid().optional(),
				status: z.string().optional(),
			})
		)
		.query(async ({ input }) => {
			const result = await decisionService.list(input.projectId, {
				cardId: input.cardId,
				status: input.status,
			});
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
		const result = await decisionService.delete(input.id);
		if (!result.success) {
			const code = result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
			throw new TRPCError({ code, message: result.error.message });
		}
		return result.data;
	}),
});
