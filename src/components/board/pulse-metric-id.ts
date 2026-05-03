/**
 * Pulse v2 metric IDs (#157 / #167 decision cdc3262b).
 *
 * Stable union type that keys both the strip cell renderer and the tooltip
 * explainers map. Without this type, every metric rename would break tooltip
 * lookups silently — the spec card #167 mandated this as a Track A
 * prerequisite. Ordered to match the locked headline-strip ordering from
 * the spec (throughput, weekCost, bottleneck, blockers, staleInProgress) +
 * the popover-only signal (handoffAge).
 */
export type PulseMetricId =
	| "throughput"
	| "weekCost"
	| "bottleneck"
	| "blockers"
	| "staleInProgress"
	| "handoffAge";

/**
 * Strip-rendered metrics in display order. The popover-only `handoffAge`
 * lives in the explainers map but never appears in the strip iteration.
 */
export const PULSE_STRIP_ORDER = [
	"throughput",
	"weekCost",
	"bottleneck",
	"blockers",
	"staleInProgress",
] as const satisfies ReadonlyArray<PulseMetricId>;

export type PulseStripMetricId = (typeof PULSE_STRIP_ORDER)[number];
