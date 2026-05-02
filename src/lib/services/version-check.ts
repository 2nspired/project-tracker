/**
 * Shared "is there a newer Pigeon?" probe.
 *
 * Both the Next.js web server (`systemRouter.versionCheck`, header pill on
 * every page) and the MCP process (`src/mcp/server.ts`'s briefMe upgrade-info
 * block) call this. The function has no `PrismaClient` surface — its only
 * I/O is a GitHub Releases fetch — so unlike the other `src/lib/services/`
 * modules it doesn't take `db` as a parameter; it just lives here so the
 * MCP process can import it without crossing the `src/server/` ↔ `src/mcp/`
 * layer boundary (v6.2 decision a5a4cde6).
 *
 * In-process cache (success: 6h TTL, failure: 10min TTL) is module-level
 * — each process gets its own cache, which is the right scope: the web
 * UI's polling pattern dominates volume on the Next.js side, and briefMe's
 * once-per-session call dominates on the MCP side. Tests reset via
 * `__resetVersionCheckCacheForTests` so each `it` block starts clean.
 */

import semver from "semver";
import pkg from "../../../package.json";

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
