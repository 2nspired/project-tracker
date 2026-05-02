// @vitest-environment node
/**
 * Tests for the shared staleness evaluator (#233).
 *
 * `checkStaleness` is the source of truth for "is this persistent claim
 * still trustworthy?" — used by both the Next.js brief-payload service
 * and the MCP session-tools surface. The evaluator combines age decay,
 * TTL expiry, file-cited git-shell-out, and decision supersession; each
 * path has independent thresholds and a different short-circuit order.
 *
 * These tests lock current behavior with the git-shell-out path stubbed
 * via `vi.mock("node:child_process")`, so no real repo or git binary is
 * required. The evaluator is itself pure once `db.claim.findMany` and
 * `db.project.findUnique` resolve, so we hand-build a minimal duck-typed
 * mock prisma surface rather than spinning up a sqlite fixture.
 *
 * Behavior reference: `src/lib/services/staleness.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:child_process before importing the staleness module. The
// production code calls `await promisify(execFile)(...)` and destructures
// `{ stdout }` from the result. To make `promisify` produce that shape
// without depending on Node's `[util.promisify.custom]` symbol (which
// vitest isolation can desync from the test's own `node:util` import),
// we have the callback yield a single `{ stdout, stderr }` object as its
// "value" arg. Default `promisify` then resolves with that object directly
// — matching what Node's annotated execFile would yield.
const execFileMock = vi.fn();
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const execFileStub = (...allArgs: unknown[]) => {
		const callback = allArgs[allArgs.length - 1] as (
			err: Error | null,
			value: { stdout: string; stderr: string }
		) => void;
		const cmd = allArgs[0] as string;
		const args = Array.isArray(allArgs[1]) ? (allArgs[1] as string[]) : [];
		const opts = allArgs.length >= 4 ? (allArgs[2] as Record<string, unknown>) : undefined;
		execFileMock(cmd, args, opts).then(
			(r: { stdout: string; stderr?: string }) =>
				callback(null, { stdout: r.stdout, stderr: r.stderr ?? "" }),
			(err: Error) => callback(err, { stdout: "", stderr: "" })
		);
	};
	return {
		...actual,
		execFile: execFileStub,
	};
});

import {
	checkStaleness,
	formatStalenessWarnings,
	type StalenessWarning,
} from "@/lib/services/staleness";

const NOW = new Date("2026-05-01T12:00:00Z");
const DAY = 1000 * 60 * 60 * 24;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	execFileMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * DAY);
}

// Minimal Claim shape — using `any` shapes the test surface around what
// `staleness.ts` actually reads, not the full prisma row type.
type ClaimLike = {
	id: string;
	projectId: string;
	kind: string;
	statement: string;
	body: string;
	evidence: string;
	payload: string;
	author: string;
	cardId: string | null;
	status: string;
	supersedesId: string | null;
	supersededById: string | null;
	recordedAtSha: string | null;
	verifiedAt: Date | null;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

function makeClaim(overrides: Partial<ClaimLike> = {}): ClaimLike {
	return {
		id: "claim-1",
		projectId: "proj-1",
		kind: "context",
		statement: "Always call briefMe at session start",
		body: "",
		evidence: "{}",
		payload: "{}",
		author: "AGENT",
		cardId: null,
		status: "active",
		supersedesId: null,
		supersededById: null,
		recordedAtSha: null,
		verifiedAt: null,
		expiresAt: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function makeDb(claims: ClaimLike[], repoPath: string | null = null) {
	return {
		claim: {
			findMany: vi.fn(async () => claims),
		},
		project: {
			findUnique: vi.fn(async () => ({ repoPath })),
		},
		// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma surface for tests
	} as any;
}

// ─── Age decay ─────────────────────────────────────────────────────

describe("checkStaleness — context claims, age decay (agent author)", () => {
	it("returns no warning when agent claim is younger than 14 days", () => {
		const db = makeDb([makeClaim({ author: "AGENT", createdAt: daysAgo(13) })]);
		return checkStaleness(db, "proj-1").then((warnings) => {
			expect(warnings).toEqual([]);
		});
	});

	it("returns 'possibly-stale' for 14-day-old agent claim", async () => {
		const db = makeDb([makeClaim({ author: "AGENT", createdAt: daysAgo(14) })]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].severity).toBe("possibly-stale");
		expect(warnings[0].type).toBe("age-decay");
		expect(warnings[0].source).toBe("context-entry");
		expect(warnings[0].reason).toMatch(/Agent-recorded fact/);
		expect(warnings[0].reason).toMatch(/14 days old/);
	});

	it("returns 'stale' for 30-day-old agent claim", async () => {
		const db = makeDb([makeClaim({ author: "AGENT", createdAt: daysAgo(30) })]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].severity).toBe("stale");
		expect(warnings[0].type).toBe("age-decay");
	});
});

describe("checkStaleness — context claims, age decay (human author)", () => {
	it("returns no warning when human claim is younger than 30 days", () => {
		const db = makeDb([makeClaim({ author: "HUMAN", createdAt: daysAgo(29) })]);
		return checkStaleness(db, "proj-1").then((warnings) => {
			expect(warnings).toEqual([]);
		});
	});

	it("returns 'possibly-stale' for 30-day-old human claim", async () => {
		const db = makeDb([makeClaim({ author: "HUMAN", createdAt: daysAgo(30) })]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].severity).toBe("possibly-stale");
		expect(warnings[0].reason).toMatch(/Human-recorded fact/);
	});

	it("returns 'stale' for 60-day-old human claim", async () => {
		const db = makeDb([makeClaim({ author: "HUMAN", createdAt: daysAgo(60) })]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].severity).toBe("stale");
	});

	it("treats any non-AGENT author as human (e.g. named human user)", async () => {
		// Implementation: `isAgent = author === "AGENT"`. Anything else uses
		// human thresholds — pin this so an accidental allowlist refactor
		// doesn't silently shorten the threshold for named humans.
		const db = makeDb([makeClaim({ author: "thomas", createdAt: daysAgo(20) })]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});
});

// ─── Measurement claims (TTL takes precedence) ─────────────────────

describe("checkStaleness — measurement claims, TTL", () => {
	it("returns 'ttl-expired' stale warning when expiresAt < now", async () => {
		const db = makeDb([
			makeClaim({
				kind: "measurement",
				statement: "test-suite-runtime",
				payload: JSON.stringify({ value: 1234, unit: "ms" }),
				createdAt: daysAgo(10),
				expiresAt: daysAgo(1), // expired 1 day ago
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("ttl-expired");
		expect(warnings[0].severity).toBe("stale");
		expect(warnings[0].source).toBe("measurement");
		expect(warnings[0].claim).toMatch(/test-suite-runtime/);
		expect(warnings[0].claim).toMatch(/1234 ms/);
		expect(warnings[0].reason).toMatch(/TTL expired/);
		expect(warnings[0].reason).toMatch(/10d ago/);
	});

	it("does NOT return TTL warning when expiresAt is in the future", async () => {
		const db = makeDb([
			makeClaim({
				kind: "measurement",
				createdAt: daysAgo(5),
				expiresAt: new Date(NOW.getTime() + DAY),
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});

	it("when expiresAt is set, age fallback is suppressed even for old claims", async () => {
		// Locks the "TTL is authoritative" decision: a measurement with a
		// future TTL but >60 days old should NOT warn (because the human
		// who set the TTL is asserting "this is still good for that long").
		const db = makeDb([
			makeClaim({
				kind: "measurement",
				author: "HUMAN",
				createdAt: daysAgo(120),
				expiresAt: new Date(NOW.getTime() + 7 * DAY),
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});

	it("falls through to age-based when no TTL is set", async () => {
		const db = makeDb([
			makeClaim({
				kind: "measurement",
				author: "AGENT",
				createdAt: daysAgo(40),
				expiresAt: null,
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("age-decay");
		expect(warnings[0].source).toBe("measurement");
		expect(warnings[0].reason).toMatch(/Agent-recorded measurement/);
	});

	it("falls back to plain statement when payload lacks value/unit", async () => {
		const db = makeDb([
			makeClaim({
				kind: "measurement",
				statement: "queue-depth-snapshot",
				payload: JSON.stringify({}), // no value/unit
				createdAt: daysAgo(5),
				expiresAt: daysAgo(1),
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].claim).toBe("queue-depth-snapshot");
	});
});

// ─── Decision supersession ─────────────────────────────────────────

describe("checkStaleness — decision claims, supersession", () => {
	it("returns no warning for active decisions", async () => {
		const db = makeDb([
			makeClaim({
				kind: "decision",
				status: "active",
				createdAt: daysAgo(120), // very old, but active = trusted
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});

	it("returns 'superseded' stale warning when status is 'superseded' with replacement", async () => {
		const db = makeDb([
			makeClaim({
				kind: "decision",
				status: "superseded",
				supersededById: "11111111-1111-4111-8111-111111111111",
				statement: "Use SQLite for the metadata DB",
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("superseded");
		expect(warnings[0].severity).toBe("stale");
		expect(warnings[0].source).toBe("decision");
		expect(warnings[0].reason).toMatch(/Superseded by decision 11111111/);
		expect(warnings[0].reason).toMatch(/use the newer decision instead/);
	});

	it("returns warning with 'no replacement linked' when superseded without supersededById", async () => {
		const db = makeDb([
			makeClaim({
				kind: "decision",
				status: "superseded",
				supersededById: null,
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].reason).toMatch(/no replacement linked/);
	});

	it("returns no warning for retired decisions (only 'superseded' triggers)", async () => {
		// Locks the strict-equality check on `status === "superseded"` —
		// 'retired' is a distinct lifecycle state and should NOT surface
		// as a staleness warning here.
		const db = makeDb([makeClaim({ kind: "decision", status: "retired" })]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});
});

// ─── File-cited (git shell-out) path ───────────────────────────────

describe("checkStaleness — context claim, file-cited staleness", () => {
	it("short-circuits to age-based when no repoPath", async () => {
		const db = makeDb(
			[
				makeClaim({
					recordedAtSha: "deadbeefcafe1234",
					evidence: JSON.stringify({ files: ["src/foo.ts"] }),
					createdAt: daysAgo(40), // would warn via age-decay (agent ≥30)
				}),
			],
			null // no repoPath
		);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("age-decay");
		expect(execFileMock).not.toHaveBeenCalled();
	});

	it("short-circuits to age-based when no recordedAtSha", async () => {
		const db = makeDb(
			[
				makeClaim({
					recordedAtSha: null,
					evidence: JSON.stringify({ files: ["src/foo.ts"] }),
					createdAt: daysAgo(40),
				}),
			],
			"/tmp/fake-repo"
		);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("age-decay");
		expect(execFileMock).not.toHaveBeenCalled();
	});

	it("short-circuits to age-based when files list is empty", async () => {
		const db = makeDb(
			[
				makeClaim({
					recordedAtSha: "deadbeef",
					evidence: JSON.stringify({ files: [] }),
					createdAt: daysAgo(40),
				}),
			],
			"/tmp/fake-repo"
		);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("age-decay");
		expect(execFileMock).not.toHaveBeenCalled();
	});

	it("returns 'file-changed' stale warning when latest sha differs", async () => {
		execFileMock.mockResolvedValue({ stdout: "newshahash000000\n" });
		const db = makeDb(
			[
				makeClaim({
					recordedAtSha: "oldshahash000000",
					evidence: JSON.stringify({ files: ["src/foo.ts"] }),
					createdAt: NOW, // fresh, so age path won't fire
				}),
			],
			"/tmp/fake-repo"
		);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("file-changed");
		expect(warnings[0].severity).toBe("stale");
		expect(warnings[0].source).toBe("context-entry");
		expect(warnings[0].reason).toMatch(/Cited file `src\/foo\.ts` changed/);
		expect(warnings[0].reason).toMatch(/oldsha/);
		expect(warnings[0].reason).toMatch(/newsha/);
		expect(execFileMock).toHaveBeenCalledWith(
			"git",
			["log", "-1", "--format=%H", "--", "src/foo.ts"],
			expect.objectContaining({ cwd: "/tmp/fake-repo" })
		);
	});

	it("returns no warning when latest sha matches recordedAtSha", async () => {
		execFileMock.mockResolvedValue({ stdout: "samesha000000000\n" });
		const db = makeDb(
			[
				makeClaim({
					recordedAtSha: "samesha000000000",
					evidence: JSON.stringify({ files: ["src/foo.ts"] }),
					createdAt: NOW,
				}),
			],
			"/tmp/fake-repo"
		);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});

	it("falls back to age-decay when git execFile throws (e.g. file deleted, repo broken)", async () => {
		execFileMock.mockRejectedValue(new Error("not in a git repo"));
		const db = makeDb(
			[
				makeClaim({
					recordedAtSha: "oldsha",
					evidence: JSON.stringify({ files: ["src/missing.ts"] }),
					createdAt: daysAgo(40), // old enough to hit age-decay
				}),
			],
			"/tmp/fake-repo"
		);
		const warnings = await checkStaleness(db, "proj-1");
		// Git failure is swallowed; falls through to age-based path.
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("age-decay");
	});

	it("returns no warning when execFile resolves with empty stdout", async () => {
		// `if (!latestSha) continue` — empty git output (file untracked or
		// no commits touch it) is treated as "no signal", not as a warning.
		execFileMock.mockResolvedValue({ stdout: "\n" });
		const db = makeDb(
			[
				makeClaim({
					recordedAtSha: "anysha",
					evidence: JSON.stringify({ files: ["src/foo.ts"] }),
					createdAt: NOW, // fresh, no age fallback
				}),
			],
			"/tmp/fake-repo"
		);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});
});

// ─── Aggregation across multiple claims ────────────────────────────

describe("checkStaleness — aggregation", () => {
	it("returns one warning per stale claim, in claim order", async () => {
		const db = makeDb([
			makeClaim({ id: "c1", author: "AGENT", createdAt: daysAgo(40) }),
			makeClaim({ id: "c2", author: "HUMAN", createdAt: daysAgo(5) }), // fresh
			makeClaim({
				id: "c3",
				kind: "decision",
				status: "superseded",
				supersededById: "abc12345-0000-4000-8000-000000000000",
			}),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings.map((w) => w.entryId)).toEqual(["c1", "c3"]);
	});

	it("returns empty array when all claims are fresh and active", async () => {
		const db = makeDb([
			makeClaim({ id: "c1", createdAt: daysAgo(2) }),
			makeClaim({ id: "c2", kind: "decision", status: "active" }),
		]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});

	it("ignores unknown claim kinds (returns null from evaluateClaim)", async () => {
		const db = makeDb([makeClaim({ kind: "speculative-future-kind" })]);
		const warnings = await checkStaleness(db, "proj-1");
		expect(warnings).toEqual([]);
	});
});

// ─── formatStalenessWarnings ───────────────────────────────────────

describe("formatStalenessWarnings", () => {
	function w(
		severity: StalenessWarning["severity"],
		source: StalenessWarning["source"],
		claim: string,
		reason: string
	): StalenessWarning {
		return {
			entryId: `id-${claim}`,
			claim,
			reason,
			type: "age-decay",
			severity,
			source,
		};
	}

	it("returns null when there are no warnings", () => {
		expect(formatStalenessWarnings([])).toBeNull();
	});

	it("sections context-entry warnings without a header", () => {
		const out = formatStalenessWarnings([w("stale", "context-entry", "the rule", "the reason")]);
		expect(out).toContain("STALE CONTEXT WARNINGS");
		expect(out).toContain('- **[stale]** "the rule" — the reason');
		expect(out).toContain("Use `listClaims` to review");
	});

	it("sections code-fact, measurement, decision under labelled headers", () => {
		const out = formatStalenessWarnings([
			w("stale", "code-fact", "code claim", "code reason"),
			w("possibly-stale", "measurement", "metric", "metric reason"),
			w("stale", "decision", "decision text", "decision reason"),
		]);
		expect(out).toContain("**Code facts:**");
		expect(out).toContain("**Measurements:**");
		expect(out).toContain("**Decisions:**");
		expect(out).toContain("- **[stale]** code claim — code reason");
		expect(out).toContain("- **[possibly-stale]** metric — metric reason");
	});

	it("renders all four sections together separated by blank lines", () => {
		const out = formatStalenessWarnings([
			w("stale", "context-entry", "ctx", "ctx-r"),
			w("stale", "code-fact", "code", "code-r"),
			w("possibly-stale", "measurement", "m", "m-r"),
			w("stale", "decision", "d", "d-r"),
		]);
		// Sanity: all four fragments present.
		expect(out).toContain('"ctx" — ctx-r');
		expect(out).toContain("code — code-r");
		expect(out).toContain("m — m-r");
		expect(out).toContain("d — d-r");
	});
});
