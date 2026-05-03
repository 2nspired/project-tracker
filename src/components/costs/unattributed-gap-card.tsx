"use client";

/**
 * Unattributed Gap card (#213).
 *
 * Renders the per-bucket attribution breakdown beneath the Costs page
 * SummaryStrip. Hidden when there is no gap of either kind. Three buckets
 * map to the three architecturally distinct cases the Attribution Engine
 * (#269) produces:
 *
 *   - `unattributed` — engine ran, decided null. Multi-In-Progress
 *     orchestrator session or no signal. Action: review workflow.
 *   - `preEngine` — pre-#269 rows where signal was never recorded.
 *     Action: wait for #270 backfill (deferred) or accept the drag.
 *
 * Single opaque numbers conflate these. The breakdown is the feedback
 * loop the Attribution Engine needs to make the #270 / #272 deferral
 * re-evaluation meaningful.
 */

import { TokenTrackingSetupDialog } from "@/components/board/token-tracking-setup-dialog";
import { SectionHelpLink } from "@/components/costs/section-help-link";
import { Button } from "@/components/ui/button";
import { formatCost } from "@/lib/format-cost";
import type { RouterOutputs } from "@/trpc/react";

type ProjectSummary = RouterOutputs["tokenUsage"]["getProjectSummary"];

type UnattributedGapCardProps = {
	projectSummary: ProjectSummary;
};

export function UnattributedGapCard({ projectSummary }: UnattributedGapCardProps) {
	const { unattributed, preEngine } = projectSummary.attributionBreakdown;
	const totalGapSessions = unattributed.sessionCount + preEngine.sessionCount;

	// Hide entirely when nothing's unattributed — no point taking up space.
	if (totalGapSessions === 0) return null;

	const totalGapCost = unattributed.costUsd + preEngine.costUsd;

	return (
		<section className="rounded-lg border border-dashed bg-muted/30 px-5 py-4">
			<div className="flex items-baseline justify-between gap-4">
				<div>
					<div className="flex items-center gap-1.5">
						<h2 className="text-sm font-medium">Attribution gap</h2>
						<SectionHelpLink
							anchor="the-3-bucket-gap"
							label="How is the attribution gap calculated?"
						/>
					</div>
					<p className="mt-0.5 text-2xs text-muted-foreground">
						{totalGapSessions} {totalGapSessions === 1 ? "session" : "sessions"} (
						{formatCost(totalGapCost)}) not attributed to any card.
					</p>
				</div>
				{unattributed.sessionCount > 0 ? (
					<TokenTrackingSetupDialog
						trigger={
							<Button variant="outline" size="sm">
								Set up attribution
							</Button>
						}
					/>
				) : null}
			</div>

			<dl className="mt-3 grid gap-3 sm:grid-cols-2">
				{unattributed.sessionCount > 0 ? (
					<GapRow
						label="Unattributed by engine"
						sessionCount={unattributed.sessionCount}
						costUsd={unattributed.costUsd}
						caption="Multi-card orchestrator sessions or no-signal cases. Review workflow."
					/>
				) : null}

				{preEngine.sessionCount > 0 ? (
					<GapRow
						label="Pre-engine drag"
						sessionCount={preEngine.sessionCount}
						costUsd={preEngine.costUsd}
						caption="Recorded before the Attribution Engine landed. Backfill is deferred."
					/>
				) : null}
			</dl>
		</section>
	);
}

function GapRow({
	label,
	sessionCount,
	costUsd,
	caption,
}: {
	label: string;
	sessionCount: number;
	costUsd: number;
	caption: string;
}) {
	return (
		<div className="space-y-0.5">
			<dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="flex items-baseline gap-2">
				<span className="font-mono text-base tabular-nums">{sessionCount}</span>
				<span className="font-mono text-sm tabular-nums text-muted-foreground">
					{formatCost(costUsd)}
				</span>
			</dd>
			<p className="text-2xs text-muted-foreground">{caption}</p>
		</div>
	);
}
