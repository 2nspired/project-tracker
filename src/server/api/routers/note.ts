import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createNoteSchema,
	listNoteFilterSchema,
	updateNoteSchema,
} from "@/lib/schemas/note-schemas";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { noteService } from "@/server/services/note-service";

export const noteRouter = createTRPCRouter({
	list: publicProcedure
		.input(
			z
				.object({ projectId: z.string().uuid().nullable().optional() })
				.merge(listNoteFilterSchema)
				.optional()
		)
		.query(async ({ input }) => {
			const { projectId, ...filter } = input ?? {};
			const result = await noteService.list(projectId, filter);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	create: publicProcedure.input(createNoteSchema).mutation(async ({ input }) => {
		const result = await noteService.create(input);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	update: publicProcedure
		.input(z.object({ id: z.string().uuid(), data: updateNoteSchema }))
		.mutation(async ({ input }) => {
			const result = await noteService.update(input.id, input.data);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),

	delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
		const result = await noteService.delete(input.id);
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),
});
