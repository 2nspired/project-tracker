import { readFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { z } from "zod";
import { extractSection } from "@/lib/changelog";
import { getSlashCommands } from "@/lib/slash-commands";
import { TOOL_CATALOG } from "@/lib/tool-catalog.generated";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import pkg from "../../../../package.json";

const startedAt = new Date().toISOString();

// GitHub Releases is the source of truth — `scripts/release.ts` always tags
// a release on publish. We keep the result in module scope so every browser
// query in this Node process shares one cached value.
const RELEASES_URL = "https://api.github.com/repos/2nspired/pigeon/releases/latest";
const SUCCESS_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours when we got an answer
const FAILURE_TTL_MS = 1000 * 60 * 10; // 10 min when we did not, so a real release isn't hidden
const FETCH_TIMEOUT_MS = 4000;

export type VersionCheckResult = {
	current: string;
	latest: string | null;
	isOutdated: boolean;
	checkedAt: string;
};

type CacheEntry = { value: VersionCheckResult; expiresAt: number };

let cache: CacheEntry | null = null;

// Exposed for tests so each `it` block starts from a clean slate.
export function __resetVersionCheckCacheForTests(): void {
	cache = null;
}

function stripVPrefix(tag: string): string {
	return tag.startsWith("v") ? tag.slice(1) : tag;
}

async function fetchLatestTag(fetchImpl: typeof fetch): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetchImpl(RELEASES_URL, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "pigeon-version-check",
			},
			signal: controller.signal,
		});
		if (!res.ok) {
			console.warn(`[versionCheck] GitHub responded ${res.status}`);
			return null;
		}
		const body = (await res.json()) as { tag_name?: unknown };
		if (typeof body.tag_name !== "string" || body.tag_name.length === 0) {
			console.warn("[versionCheck] release payload missing tag_name");
			return null;
		}
		return stripVPrefix(body.tag_name);
	} catch (err) {
		console.warn("[versionCheck] fetch failed:", err instanceof Error ? err.message : err);
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

export type RunVersionCheckDeps = {
	fetchImpl?: typeof fetch;
	now?: () => number;
	currentVersion?: string;
	env?: Record<string, string | undefined>;
};

export async function runVersionCheck(deps: RunVersionCheckDeps = {}): Promise<VersionCheckResult> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const now = deps.now ?? Date.now;
	const currentVersion = deps.currentVersion ?? pkg.version;
	const env = deps.env ?? process.env;
	const nowMs = now();

	if (cache && cache.expiresAt > nowMs) {
		return cache.value;
	}

	const checkedAtIso = new Date(nowMs).toISOString();

	// Opt-out: skip the network entirely.
	if (env.PIGEON_VERSION_CHECK === "off") {
		const value: VersionCheckResult = {
			current: currentVersion,
			latest: null,
			isOutdated: false,
			checkedAt: checkedAtIso,
		};
		// Cache as a "success" — nothing to retry while opt-out is set.
		cache = { value, expiresAt: nowMs + SUCCESS_TTL_MS };
		return value;
	}

	const latestRaw = await fetchLatestTag(fetchImpl);
	if (latestRaw === null) {
		const value: VersionCheckResult = {
			current: currentVersion,
			latest: null,
			isOutdated: false,
			checkedAt: checkedAtIso,
		};
		cache = { value, expiresAt: nowMs + FAILURE_TTL_MS };
		return value;
	}

	const cleanLatest = semver.valid(semver.coerce(latestRaw));
	const cleanCurrent = semver.valid(semver.coerce(currentVersion));
	const isOutdated =
		cleanLatest !== null && cleanCurrent !== null && semver.gt(cleanLatest, cleanCurrent);

	const value: VersionCheckResult = {
		current: currentVersion,
		latest: cleanLatest ?? latestRaw,
		isOutdated,
		checkedAt: checkedAtIso,
	};
	cache = { value, expiresAt: nowMs + SUCCESS_TTL_MS };
	return value;
}

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
