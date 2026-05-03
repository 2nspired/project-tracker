/**
 * boardHealth tRPC router (#173) — backs the dashboard hygiene panel.
 *
 * One query per signal so React Query can parallel-fetch them; a slow
 * signal can't block the panel render. All procedures accept an optional
 * `projectId`; omit for a cross-project rollup (the dashboard's default).
 *
 * The signals (5):
 *   - `missingTags`         — cards with zero CardTag rows (excludes Done/Parking)
 *   - `noPriorityInBacklog` — Backlog-role cards with priority=NONE
 *   - `overdueMilestones`   — active milestones with targetDate < now
 *   - `taxonomyDrift`       — single-use tags + Levenshtein-≤2 near-miss pairs
 *   - `staleDecisions`      — projects with 30d activity but no decision in 60d
 *
 * Each procedure delegates to `boardAuditService` and maps ServiceResult
 * → TRPCError on failure. Read-only — no mutations live on this router.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { boardAuditService } from "@/server/services/board-audit-service";

const optionalProjectScope = z
	.object({ projectId: z.string().uuid().optional() })
	.optional()
	.default({});

export const boardHealthRouter = createTRPCRouter({
	missingTags: publicProcedure.input(optionalProjectScope).query(async ({ input }) => {
		const result = await boardAuditService.findMissingTags({ projectId: input.projectId });
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	noPriorityInBacklog: publicProcedure.input(optionalProjectScope).query(async ({ input }) => {
		const result = await boardAuditService.findNoPriorityBacklog({
			projectId: input.projectId,
		});
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	overdueMilestones: publicProcedure.input(optionalProjectScope).query(async ({ input }) => {
		const result = await boardAuditService.findOverdueMilestones({
			projectId: input.projectId,
		});
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	taxonomyDrift: publicProcedure.input(optionalProjectScope).query(async ({ input }) => {
		const result = await boardAuditService.findTaxonomyDrift({ projectId: input.projectId });
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),

	staleDecisions: publicProcedure.input(optionalProjectScope).query(async ({ input }) => {
		const result = await boardAuditService.findStaleDecisions({ projectId: input.projectId });
		if (!result.success) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
		}
		return result.data;
	}),
});
