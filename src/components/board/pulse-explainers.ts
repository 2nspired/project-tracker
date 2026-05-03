/**
 * Pulse v2 metric explainers (#157, drafts from #167).
 *
 * Keyed off the stable `PulseMetricId` union so any metric rename surfaces
 * as a TS error here rather than a silently-broken tooltip lookup. The
 * `label` is the short header inside the tooltip; `body` is the plain-English
 * explainer with good/bad ranges.
 *
 * Source text: card #167's description, locked 2026-05-02 with decision
 * cdc3262b-581e-4b68-8676-8f3d9506e0d8. Edits should re-cite that card —
 * the wording was deliberately scoped to "what does it mean and what's the
 * good/bad shape", not implementation details.
 */

import type { PulseMetricId } from "./pulse-metric-id";

export type PulseExplainer = {
	/** Short tooltip header (~30 chars). Mirrors the strip cell label. */
	label: string;
	/** Plain-English body explaining what the metric measures + good/bad range. */
	body: string;
};

export const PULSE_EXPLAINERS: Record<PulseMetricId, PulseExplainer> = {
	throughput: {
		label: "Cards finished this week",
		body: "Counts arrivals into a Done-role column over the last 7 days. Steady-or-up is healthy; a flat zero week is the signal to investigate.",
	},
	weekCost: {
		label: "Token spend this week",
		body: "Sum of token costs across all sessions in the last 7 days, project-wide. Watch for sudden spikes — usually a model swap or a runaway loop. Cost rising while throughput is flat is the bad shape.",
	},
	bottleneck: {
		label: "Slowest column right now",
		body: "The non-Done column where cards spend the most hours on average. Healthy when it rotates; the same column stuck for >2 weeks means that stage needs unsticking.",
	},
	blockers: {
		label: "Cards waiting on something",
		body: "Cards with at least one active `blocks` relation pointing at them, plus the age of the oldest blocker. Zero is healthy; oldest >7 days means it's been forgotten and the blocked work is dead-parked.",
	},
	staleInProgress: {
		label: "Cards stuck In Progress",
		body: "Cards in an active-role column with no recent activity past the staleness threshold. Should be zero — non-zero means ghost work; drag those cards back to Backlog or close them.",
	},
	handoffAge: {
		label: "Time since last saved handoff",
		body: "How long ago `saveHandoff` last ran on this board. Healthy when fresh during active work; days-old age while you're still moving cards means session context isn't being captured for the next session.",
	},
};
