"use client";

import { Sparkline } from "@/components/ui/sparkline";
import { formatCost } from "@/lib/format-cost";
import { formatRelative } from "@/lib/format-date";
import type { RouterOutputs } from "@/trpc/react";

type ProjectSummary = RouterOutputs["tokenUsage"]["getProjectSummary"];
type DailyCostSeries = RouterOutputs["tokenUsage"]["getDailyCostSeries"];

type SummaryStripProps = {
	projectSummary: ProjectSummary;
	dailyCost: DailyCostSeries;
};

// Top-of-page summary for the Costs view. Four cells (lifetime cost,
// 7-day cost + sparkline, session count, tracking-since) laid out as a
// `<dl>` so each label/value pair is semantically a description term.
// Mobile collapses to a 2-col grid — no horizontal scroll, no table.
//
// The sparkline mirrors the violet accent the BoardPulse strip uses for
// cost data so the visual association ("violet = cost") carries across
// surfaces.
export function SummaryStrip({ projectSummary, dailyCost }: SummaryStripProps) {
	const lifetimeCost = projectSummary.totalCostUsd;
	const weekCost = dailyCost.weekTotalCostUsd;
	const sessionCount = projectSummary.sessionCount;
	const trackingSince = projectSummary.trackingSince;

	return (
		<dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
			<Cell label="Lifetime cost">
				<span className="font-mono text-2xl tabular-nums">{formatCost(lifetimeCost)}</span>
			</Cell>

			<Cell label="Last 7 days">
				<div className="flex items-baseline gap-2">
					<span className="font-mono text-2xl tabular-nums">{formatCost(weekCost)}</span>
					<Sparkline
						data={dailyCost.dailyCostUsd}
						strokeClassName="stroke-violet-500"
						fillClassName="fill-violet-500/10"
						dotClassName="fill-violet-500"
						label="Daily cost sparkline"
					/>
				</div>
			</Cell>

			<Cell label="Sessions">
				<span className="font-mono text-2xl tabular-nums">{sessionCount}</span>
			</Cell>

			<Cell label="Tracking since">
				<span className="text-sm text-muted-foreground">
					{trackingSince ? formatRelative(trackingSince) : "—"}
				</span>
			</Cell>
		</dl>
	);
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1">
			<dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd>{children}</dd>
		</div>
	);
}
