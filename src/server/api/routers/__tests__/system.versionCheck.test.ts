// Verifies the version-check probe across the four shapes called out in
// card #182: cache hit, env-var opt-out, offline fallback, and the semver
// comparison. Each test resets module-level state via the exported reset
// helper so cases can't leak into each other.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetVersionCheckCacheForTests, runVersionCheck } from "../system";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function mockReleaseResponse(tag: string): Response {
	return new Response(JSON.stringify({ tag_name: tag }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("runVersionCheck", () => {
	beforeEach(() => {
		__resetVersionCheckCacheForTests();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("flags an outdated install when the GitHub tag is newer", async () => {
		const fetchImpl = vi.fn(async () => mockReleaseResponse("v6.1.0"));
		const result = await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => 0,
		});
		expect(result).toEqual({
			current: "6.0.0",
			latest: "6.1.0",
			isOutdated: true,
			checkedAt: new Date(0).toISOString(),
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("treats a bare semver tag (no v prefix) the same as a v-prefixed one", async () => {
		const fetchImpl = vi.fn(async () => mockReleaseResponse("6.1.0"));
		const result = await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.1.0",
			env: {},
			now: () => 0,
		});
		expect(result.latest).toBe("6.1.0");
		expect(result.isOutdated).toBe(false);
	});

	it("memoizes the success result for 6 hours and skips the network on subsequent calls", async () => {
		const fetchImpl = vi.fn(async () => mockReleaseResponse("v6.1.0"));
		let now = 1_000;
		await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => now,
		});
		// 5h59m later — still inside the cache window.
		now += 1000 * 60 * 60 * 5 + 1000 * 60 * 59;
		const second = await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => now,
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(second.latest).toBe("6.1.0");

		// 6h1m past the original — cache expired, fetch again.
		now += 1000 * 60 * 2;
		await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => now,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("respects PIGEON_VERSION_CHECK=off and never calls fetch", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("fetch should not be called when opted out");
		});
		const result = await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: { PIGEON_VERSION_CHECK: "off" },
			now: () => 0,
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result).toEqual({
			current: "6.0.0",
			latest: null,
			isOutdated: false,
			checkedAt: new Date(0).toISOString(),
		});
	});

	it("returns a silent fallback when GitHub is unreachable", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("ENETUNREACH");
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => 0,
		});
		expect(result).toEqual({
			current: "6.0.0",
			latest: null,
			isOutdated: false,
			checkedAt: new Date(0).toISOString(),
		});
		expect(warn).toHaveBeenCalled();
	});

	it("returns a silent fallback when GitHub answers non-2xx", async () => {
		const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 403 }) as Response);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => 0,
		});
		expect(result.latest).toBeNull();
		expect(result.isOutdated).toBe(false);
	});

	it("caches a failure for only ~10 minutes so a real release is not hidden", async () => {
		const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchInit): Promise<Response> => {
			throw new Error("ENETUNREACH");
		});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let now = 0;
		await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => now,
		});
		// 9 minutes later — still inside the failure window.
		now += 1000 * 60 * 9;
		await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => now,
		});
		expect(fetchImpl).toHaveBeenCalledOnce();

		// 11 minutes past the original — cache expired.
		now += 1000 * 60 * 2;
		await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => now,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("does not flag a current install as outdated", async () => {
		const fetchImpl = vi.fn(async () => mockReleaseResponse("v6.0.0"));
		const result = await runVersionCheck({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			currentVersion: "6.0.0",
			env: {},
			now: () => 0,
		});
		expect(result.isOutdated).toBe(false);
		expect(result.latest).toBe("6.0.0");
	});
});
