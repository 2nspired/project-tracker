import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { extractSection } from "@/lib/changelog";
import {
	__resetVersionCheckCacheForTests,
	type RunVersionCheckDeps,
	runVersionCheck,
	type VersionCheckResult,
} from "@/lib/services/version-check";
import { getSlashCommands } from "@/lib/slash-commands";
import { TOOL_CATALOG } from "@/lib/tool-catalog.generated";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import pkg from "../../../../package.json";

// Re-exported so existing callers (`src/server/api/routers/__tests__/system.versionCheck.test.ts`,
// any other consumers of the previous direct `system.ts` symbol surface)
// keep working. Canonical home is now `src/lib/services/version-check.ts` —
// see #260 cluster 6, decision a5a4cde6.
export {
	__resetVersionCheckCacheForTests,
	type RunVersionCheckDeps,
	runVersionCheck,
	type VersionCheckResult,
};

const startedAt = new Date().toISOString();

// Per-version cache for parsed CHANGELOG sections. CHANGELOG.md changes
// only at release time and the parse is pure once the file is read, so a
// trivial Map keyed on version is enough — no TTL needed (a stale cache
// entry would only persist until the next process restart, which a
// CHANGELOG-changing deploy already triggers via `service:update`).
const releaseNotesCache = new Map<string, string | null>();

// Exposed for tests so each `it` block starts from a clean slate.
export function __resetReleaseNotesCacheForTests(): void {
	releaseNotesCache.clear();
}

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

	// Lightweight "is there a newer Pigeon?" probe. Cached in-process so the
	// header pill on every page does not hammer GitHub. Failure mode is
	// silent: latest=null / isOutdated=false so the UI renders cleanly
	// offline. See runVersionCheck for the full contract.
	versionCheck: publicProcedure.query(() => runVersionCheck()),

	// "What's new" content for the upgrade panel. Reads the local
	// CHANGELOG.md (the source of truth, governed by the unreleased-entry
	// CI gate) and slices out the matching `## [<version>]` section. No
	// network — works offline and survives a missing file by returning
	// null. The launchd plist sets WorkingDirectory to the repo root, so
	// `path.resolve` lands on the same CHANGELOG.md in dev and service
	// mode.
	releaseNotes: publicProcedure
		.input(z.object({ version: z.string() }))
		.query(async ({ input }) => {
			if (releaseNotesCache.has(input.version)) {
				return { version: input.version, body: releaseNotesCache.get(input.version) ?? null };
			}
			let body: string | null = null;
			try {
				const content = await readFile(path.resolve("CHANGELOG.md"), "utf8");
				body = extractSection(content, input.version);
			} catch {
				// File missing / unreadable — degrade silently to null. The
				// upgrade panel hides itself when body is null, so this is the
				// correct no-surprise behaviour.
				body = null;
			}
			releaseNotesCache.set(input.version, body);
			return { version: input.version, body };
		}),
});
