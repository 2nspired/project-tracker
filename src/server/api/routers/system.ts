import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import pkg from "../../../../package.json";

const startedAt = new Date().toISOString();

export const systemRouter = createTRPCRouter({
	info: publicProcedure.query(() => ({
		version: pkg.version,
		mode: process.env.NODE_ENV === "production" ? ("service" as const) : ("dev" as const),
		startedAt,
	})),
});
