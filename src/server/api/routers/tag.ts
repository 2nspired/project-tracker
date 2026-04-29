import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitTagChanged } from "@/lib/events";
import { createTagSchema, mergeTagsSchema, renameTagSchema } from "@/lib/schemas/tag-schemas";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { tagService } from "@/server/services/tag-service";

export const tagRouter = createTRPCRouter({
	list: publicProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await tagService.listByProject(input.projectId);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	getById: publicProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ input }) => {
			const result = await tagService.getById(input.id);
			if (!result.success) {
				throw new TRPCError({ code: "NOT_FOUND", message: result.error.message });
			}
			return result.data;
		}),

	create: publicProcedure.input(createTagSchema).mutation(async ({ input }) => {
		const result = await tagService.create(input);
		if (!result.success) {
			throw new TRPCError({ code: "BAD_REQUEST", message: result.error.message });
		}
		emitTagChanged(input.projectId, result.data.id);
		return result.data;
	}),

	rename: publicProcedure.input(renameTagSchema).mutation(async ({ input }) => {
		const result = await tagService.rename(input);
		if (!result.success) {
			throw new TRPCError({ code: "BAD_REQUEST", message: result.error.message });
		}
		emitTagChanged(result.data.projectId, result.data.id);
		return result.data;
	}),

	merge: publicProcedure.input(mergeTagsSchema).mutation(async ({ input }) => {
		// Look up projectId before merge — `from` is deleted by the merge
		// transaction, so we capture it first for the SSE emit.
		const fromTag = await tagService.getById(input.fromTagId);
		if (!fromTag.success) {
			throw new TRPCError({ code: "NOT_FOUND", message: fromTag.error.message });
		}
		const result = await tagService.merge(input);
		if (!result.success) {
			throw new TRPCError({ code: "BAD_REQUEST", message: result.error.message });
		}
		emitTagChanged(fromTag.data.projectId, input.intoTagId);
		return result.data;
	}),
});
