import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitMilestoneChanged } from "@/lib/events";
import {
	createMilestoneSchema,
	reorderMilestonesSchema,
	updateMilestoneSchema,
} from "@/lib/schemas/milestone-schemas";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { milestoneService } from "@/server/services/milestone-service";

export const milestoneRouter = createTRPCRouter({
	list: publicProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await milestoneService.list(input.projectId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getById: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
		const result = await milestoneService.getById(input.id);
		if (!result.success) {
			throw new TRPCError({ code: "NOT_FOUND", message: result.error.message });
		}
		return result.data;
	}),

	create: publicProcedure.input(createMilestoneSchema).mutation(async ({ input }) => {
		const result = await milestoneService.create(input);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		emitMilestoneChanged(input.projectId, result.data.id);
		return result.data;
	}),

	update: publicProcedure
		.input(z.object({ id: z.string().uuid(), data: updateMilestoneSchema }))
		.mutation(async ({ input }) => {
			const result = await milestoneService.update(input.id, input.data);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			emitMilestoneChanged(result.data.projectId, result.data.id);
			return result.data;
		}),

	reorder: publicProcedure.input(reorderMilestonesSchema).mutation(async ({ input }) => {
		const result = await milestoneService.reorder(input);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		emitMilestoneChanged(input.projectId);
		return result.data;
	}),

	delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
		const result = await milestoneService.delete(input.id);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		emitMilestoneChanged(result.data.projectId, result.data.id);
		return result.data;
	}),
});
