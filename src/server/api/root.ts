import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import { activityRouter } from "@/server/api/routers/activity";
import { boardRouter } from "@/server/api/routers/board";
import { boardHealthRouter } from "@/server/api/routers/board-health";
import { cardRouter } from "@/server/api/routers/card";
import { checklistRouter } from "@/server/api/routers/checklist";
import { columnRouter } from "@/server/api/routers/column";
import { commentRouter } from "@/server/api/routers/comment";
import { decisionRouter } from "@/server/api/routers/decision";
import { handoffRouter } from "@/server/api/routers/handoff";
import { milestoneRouter } from "@/server/api/routers/milestone";
import { noteRouter } from "@/server/api/routers/note";
import { projectRouter } from "@/server/api/routers/project";
import { relationRouter } from "@/server/api/routers/relation";
import { systemRouter } from "@/server/api/routers/system";
import { tagRouter } from "@/server/api/routers/tag";
import { tokenUsageRouter } from "@/server/api/routers/token-usage";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

export const appRouter = createTRPCRouter({
	project: projectRouter,
	board: boardRouter,
	boardHealth: boardHealthRouter,
	card: cardRouter,
	column: columnRouter,
	comment: commentRouter,
	checklist: checklistRouter,
	activity: activityRouter,
	note: noteRouter,
	milestone: milestoneRouter,
	tag: tagRouter,
	relation: relationRouter,
	handoff: handoffRouter,
	decision: decisionRouter,
	system: systemRouter,
	tokenUsage: tokenUsageRouter,
});

export type AppRouter = typeof appRouter;
export type TRPCInputs = inferRouterInputs<AppRouter>;
export type TRPCOutputs = inferRouterOutputs<AppRouter>;

export const createCaller = createCallerFactory(appRouter);
