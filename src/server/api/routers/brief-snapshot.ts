import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { briefSnapshotService } from "@/server/services/brief-snapshot-service";

export const briefSnapshotRouter = createTRPCRouter({
	list: publicProcedure
		.input(
			z.object({
				boardId: z.string().uuid(),
				limit: z.number().int().min(1).max(50).optional(),
			})
		)
		.query(async ({ input }) => {
			const result = await briefSnapshotService.list(input.boardId, input.limit);
			if (!result.success) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
			}
			return result.data;
		}),
});
