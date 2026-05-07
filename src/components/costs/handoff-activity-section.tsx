"use client";

/**
 * Handoff activity section (#292).
 *
 * Project-wide rollup of per-handoff cost: how many handoffs have been
 * written, what they cost in aggregate, and what the average cost-per-
 * handoff is. Slotted on the Costs page next to `<SavingsSection>` so the
 * "round-trip economics" story (write a handoff for X, load it next
 * session via briefMe for Y) stays adjacent.
 *
 * Renders unconditionally for any project with ≥1 handoff — does NOT gate
 * on a populated baseline, unlike `<SavingsSection>`. That distinction
 * matters for un-baselined projects (e.g. plug) where this is the only
 * surface that shows handoff economics.
 */

import { SectionHelpLink } from "@/components/costs/section-help-link";
import { formatCo2, formatEnergy } from "@/lib/format-energy";
import { formatUsd } from "@/lib/format-usd";
import type { RouterOutputs } from "@/trpc/react";

type Activity = RouterOutputs["tokenUsage"]["getHandoffActivity"];

type HandoffActivitySectionProps = {
	activity: Activity;
};

export function HandoffActivitySection({ activity }: HandoffActivitySectionProps) {
	if (activity.totalCount === 0) return null;

	return (
		<section className="rounded-md border bg-muted/20 px-5 py-4">
			<header className="flex items-baseline justify-between gap-4">
				<div>
					<div className="flex items-center gap-1.5">
						<h2 className="text-sm font-medium">Handoff activity</h2>
						<SectionHelpLink anchor="handoff-activity" label="How is handoff cost attributed?" />
					</div>
					<p className="mt-0.5 text-2xs text-muted-foreground">
						Per-handoff cost rolled up across the (prevHandoff, thisHandoff] window. Single-card
						sessions narrow by `cardId`; multi-card windows fall back to project + agent scope.
					</p>
				</div>
			</header>

			<dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
				<Stat label="Handoffs" primary={activity.totalCount.toLocaleString()} />
				<Stat label="Total cost" primary={formatUsd(activity.totalCostUsd)} />
				<Stat label="Avg per handoff" primary={formatUsd(activity.avgCostUsd)} />
				<Stat
					label="Energy"
					primary={formatEnergy(activity.totalEnergyWh)}
					secondary={formatCo2(activity.totalCo2g)}
				/>
			</dl>
		</section>
	);
}

function Stat({
	label,
	primary,
	secondary,
}: {
	label: string;
	primary: string;
	secondary?: string;
}) {
	return (
		<div className="space-y-0.5">
			<dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="flex items-baseline gap-2">
				<span className="font-mono text-base tabular-nums">{primary}</span>
				{secondary ? (
					<span className="font-mono text-xs tabular-nums text-muted-foreground">{secondary}</span>
				) : null}
			</dd>
		</div>
	);
}
