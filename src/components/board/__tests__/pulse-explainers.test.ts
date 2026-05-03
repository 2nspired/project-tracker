/**
 * Pulse explainers contract test (#157, #167 Track-A prerequisite).
 *
 * Locks down that PULSE_EXPLAINERS has an entry for *every* PulseMetricId.
 * The TS compiler already enforces this via `Record<PulseMetricId, …>`,
 * but a runtime assertion catches any future split where the keys diverge
 * (e.g. someone broadens the type to `string` and quietly drops a key).
 *
 * Also verifies the strip ordering invariant — the popover-only handoffAge
 * must NOT appear in PULSE_STRIP_ORDER (otherwise the strip would render
 * 6 cells, breaking the #167 spec).
 */

import { describe, expect, it } from "vitest";

import { PULSE_EXPLAINERS } from "@/components/board/pulse-explainers";
import { PULSE_STRIP_ORDER } from "@/components/board/pulse-metric-id";

const ALL_METRIC_IDS = [
	"throughput",
	"weekCost",
	"bottleneck",
	"blockers",
	"staleInProgress",
	"handoffAge",
] as const;

describe("PULSE_EXPLAINERS", () => {
	it("has an entry for every PulseMetricId", () => {
		for (const id of ALL_METRIC_IDS) {
			expect(PULSE_EXPLAINERS[id], `missing explainer for ${id}`).toBeDefined();
			expect(PULSE_EXPLAINERS[id].label.length).toBeGreaterThan(0);
			expect(PULSE_EXPLAINERS[id].body.length).toBeGreaterThan(0);
		}
	});

	it("has no extra keys (every key maps to a known PulseMetricId)", () => {
		const known = new Set<string>(ALL_METRIC_IDS);
		for (const key of Object.keys(PULSE_EXPLAINERS)) {
			expect(known.has(key), `unknown key '${key}' in PULSE_EXPLAINERS`).toBe(true);
		}
	});

	it("each explainer body mentions a 'good' or 'bad' shape (#167 spec — actionability ≥ 2)", () => {
		// The spec demands each metric carry a behavior-changing range hint —
		// not just a definition. We lock that lightly here so a future copy
		// rewrite that strips out the good/bad framing trips this test.
		for (const id of ALL_METRIC_IDS) {
			const body = PULSE_EXPLAINERS[id].body.toLowerCase();
			const hasShape =
				body.includes("good") ||
				body.includes("bad") ||
				body.includes("healthy") ||
				body.includes("steady") ||
				body.includes("zero") ||
				body.includes("stable") ||
				body.includes("rotates") ||
				body.includes("fresh") ||
				body.includes("days-old") ||
				body.includes("watch");
			expect(hasShape, `explainer for ${id} missing good/bad-range framing`).toBe(true);
		}
	});
});

describe("PULSE_STRIP_ORDER", () => {
	it("contains exactly the 5 strip-rendered metrics in spec order", () => {
		expect([...PULSE_STRIP_ORDER]).toEqual([
			"throughput",
			"weekCost",
			"bottleneck",
			"blockers",
			"staleInProgress",
		]);
	});

	it("excludes the popover-only handoffAge metric", () => {
		// The whole reason `PULSE_STRIP_ORDER` exists is to encode the
		// strip-vs-popover split surfaced by #167's inventory pass. Locking
		// that here means a future contributor adding handoffAge to the
		// strip has to delete this assertion and confront the spec.
		expect((PULSE_STRIP_ORDER as readonly string[]).includes("handoffAge")).toBe(false);
	});
});
