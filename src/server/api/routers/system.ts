import { getSlashCommands } from "@/lib/slash-commands";
import { TOOL_CATALOG } from "@/lib/tool-catalog.generated";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import pkg from "../../../../package.json";

const startedAt = new Date().toISOString();

export const systemRouter = createTRPCRouter({
	info: publicProcedure.query(() => ({
		version: pkg.version,
		mode: process.env.NODE_ENV === "production" ? ("service" as const) : ("dev" as const),
		startedAt,
	})),

	// Returns the full MCP tool catalog plus the curated slash-command
	// inventory. Tool catalog is sourced from a build-time generated file
	// (scripts/sync-tool-catalog.ts); slash commands are derived at query
	// time from src/mcp/workflows.ts (zero-import module — safe to read
	// from the Next.js process). Two surfaces (Cmd-K + header popover)
	// share this one query.
	toolCatalog: publicProcedure.query(() => ({
		...TOOL_CATALOG,
		slashCommands: getSlashCommands(),
	})),
});
