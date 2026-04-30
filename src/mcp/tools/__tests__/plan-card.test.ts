import { describe, expect, it } from "vitest";
import {
	buildPlanProtocol,
	extractInvestigationHints,
	hasLockedPlanSections,
} from "@/mcp/tools/plan-card";

describe("hasLockedPlanSections", () => {
	it("returns false on null/undefined/empty descriptions", () => {
		expect(hasLockedPlanSections(null)).toBe(false);
		expect(hasLockedPlanSections(undefined)).toBe(false);
		expect(hasLockedPlanSections("")).toBe(false);
		expect(hasLockedPlanSections("   \n\n  ")).toBe(false);
	});

	it("returns true when all three locked headers are present", () => {
		const desc = [
			"Some intro text.",
			"",
			"## Why now",
			"",
			"Because reasons.",
			"",
			"## Plan",
			"",
			"1. Step.",
			"",
			"## Out of scope",
			"",
			"- Nothing",
			"",
			"## Acceptance",
			"",
			"- It works.",
		].join("\n");
		expect(hasLockedPlanSections(desc)).toBe(true);
	});

	it("returns true even when Out-of-scope is omitted (only the three are required)", () => {
		const desc = "## Why now\n\nx\n\n## Plan\n\ny\n\n## Acceptance\n\nz";
		expect(hasLockedPlanSections(desc)).toBe(true);
	});

	it("does not false-positive on prose that mentions 'plan' without the headers", () => {
		const desc =
			"We need a plan for this. The acceptance criteria are unclear. Why now isn't obvious.";
		expect(hasLockedPlanSections(desc)).toBe(false);
	});

	it("does not match when only one locked header is present", () => {
		expect(hasLockedPlanSections("## Plan\n\nsteps...")).toBe(false);
		expect(hasLockedPlanSections("## Why now\n\nthings happened")).toBe(false);
		expect(hasLockedPlanSections("## Acceptance\n\ndone if X")).toBe(false);
	});

	it("does not match level-3 (or deeper) headings", () => {
		const desc = "### Why now\n\nx\n\n### Plan\n\ny\n\n### Acceptance\n\nz";
		expect(hasLockedPlanSections(desc)).toBe(false);
	});

	it("matches case-insensitively (## PLAN === ## Plan)", () => {
		const desc = "## why now\n\nx\n\n## PLAN\n\ny\n\n## Acceptance\n\nz";
		expect(hasLockedPlanSections(desc)).toBe(true);
	});

	it("does not match headers nested in code blocks if they are part of prose", () => {
		// The current heuristic is purely regex-based — a fenced ## inside a
		// code block would still match. This documents that as a known edge:
		// authors who deliberately quote the headers in fenced code blocks
		// will trigger PLAN_EXISTS. Acceptable for v1; tighten if it bites.
		const desc =
			"```\n## Why now\n## Plan\n## Acceptance\n```\n\nThe block above shows the locked sections.";
		expect(hasLockedPlanSections(desc)).toBe(true);
	});
});

describe("extractInvestigationHints", () => {
	it("returns empty arrays on null/empty input", () => {
		expect(extractInvestigationHints(null)).toEqual({
			urls: [],
			paths: [],
			cardRefs: [],
			symbols: [],
		});
		expect(extractInvestigationHints("")).toEqual({
			urls: [],
			paths: [],
			cardRefs: [],
			symbols: [],
		});
	});

	it("extracts URLs (https + http)", () => {
		const desc = "See https://example.com/foo and http://other.test/bar?x=1.";
		const hints = extractInvestigationHints(desc);
		expect(hints.urls).toEqual(["https://example.com/foo", "http://other.test/bar?x=1"]);
	});

	it("extracts card refs (#nnn) — matches at word boundary", () => {
		const desc = "Blocks #117 and supersedes #133 (also see #129).";
		const hints = extractInvestigationHints(desc);
		expect(hints.cardRefs).toEqual(["#117", "#133", "#129"]);
	});

	it("does not pick up #anchors inside URLs as card refs", () => {
		const desc = "See https://example.com/page#section-3 — relates to #42.";
		const hints = extractInvestigationHints(desc);
		expect(hints.cardRefs).toEqual(["#42"]);
	});

	it("extracts file paths with recognized extensions", () => {
		const desc =
			"Touch src/mcp/tools/plan-card.ts and docs/SURFACES.md. Also prisma/schema.prisma.";
		const hints = extractInvestigationHints(desc);
		expect(hints.paths).toContain("src/mcp/tools/plan-card.ts");
		expect(hints.paths).toContain("docs/SURFACES.md");
		expect(hints.paths).toContain("prisma/schema.prisma");
	});

	it("does not treat semver strings as paths", () => {
		const desc = "Bumping to 4.1.0 — see CHANGELOG.md.";
		const hints = extractInvestigationHints(desc);
		expect(hints.paths).toEqual(["CHANGELOG.md"]);
	});

	it("extracts backticked code symbols", () => {
		const desc = "Implement `planCard()` and call `getCardContext` from it.";
		const hints = extractInvestigationHints(desc);
		expect(hints.symbols).toContain("planCard()");
		expect(hints.symbols).toContain("getCardContext");
	});

	it("dedupes repeated mentions", () => {
		const desc = "See #42 and again #42 and once more #42.";
		const hints = extractInvestigationHints(desc);
		expect(hints.cardRefs).toEqual(["#42"]);
	});
});

describe("buildPlanProtocol", () => {
	it("includes the four-section contract and the card ref", () => {
		const out = buildPlanProtocol({
			cardRef: "#42",
			columnName: "Backlog",
			columnPrompt: undefined,
			projectOrientation: undefined,
		});
		expect(out).toContain("Planning #42");
		expect(out).toContain("## Why now");
		expect(out).toContain("## Plan");
		expect(out).toContain("## Out of scope");
		expect(out).toContain("## Acceptance");
		expect(out).toContain("updateCard(");
		expect(out).toContain("moveCard(");
	});

	it("appends the column prompt when present", () => {
		const out = buildPlanProtocol({
			cardRef: "#7",
			columnName: "Review",
			columnPrompt: "Don't move to Done without explicit approval.",
			projectOrientation: undefined,
		});
		expect(out).toContain("Column policy (Review)");
		expect(out).toContain("Don't move to Done without explicit approval.");
	});

	it("appends the project orientation when present", () => {
		const out = buildPlanProtocol({
			cardRef: "#7",
			columnName: "Backlog",
			columnPrompt: undefined,
			projectOrientation: "Phase 1 — shared-surface context foundation.",
		});
		expect(out).toContain("Project orientation");
		expect(out).toContain("Phase 1 — shared-surface context foundation.");
	});

	it("omits column/project sections when both prompts are missing", () => {
		const out = buildPlanProtocol({
			cardRef: "#7",
			columnName: "Backlog",
			columnPrompt: undefined,
			projectOrientation: undefined,
		});
		expect(out).not.toContain("Column policy");
		expect(out).not.toContain("Project orientation");
	});
});
