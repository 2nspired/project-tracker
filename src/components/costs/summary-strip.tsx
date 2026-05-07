"use client";

import { SectionHelpLink } from "@/components/costs/section-help-link";
import { Sparkline } from "@/components/ui/sparkline";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative } from "@/lib/format-date";
import { formatCo2, formatEnergy } from "@/lib/format-energy";
import { formatUsd } from "@/lib/format-usd";
import { ENERGY_METHODOLOGY_DOCS_URL } from "@/lib/token-tracking-docs";
import type { RouterOutputs } from "@/trpc/react";

type ProjectSummary = RouterOutputs["tokenUsage"]["getProjectSummary"];
type DailyCostSeries = RouterOutputs["tokenUsage"]["getDailyCostSeries"];

type SummaryStripProps = {
	projectSummary: ProjectSummary;
	dailyCost: DailyCostSeries;
	/**
	 * When set, the strip is in board mode. The fourth cell flips from
	 * "Tracking since" to "Board's share" — the percentage of the project's
	 * lifetime cost attributable to this board.
	 */
	boardId?: string;
	/**
	 * Project-wide summary (totals across all boards). Required in board
	 * mode; the share calculation needs the project denominator. Pass
	 * `undefined` in project mode — the existing "Tracking since" cell
	 * stays.
	 */
	projectWideSummary?: ProjectSummary;
	/**
	 * Optional 7-element share series (board cost / project cost per UTC
	 * day) — drives the inline sparkline next to the Board's-share
	 * percentage in board mode (#212). Indices align with `dailyCost`'s
	 * `dailyCostUsd`. Pass `undefined` to render the cell without a
	 * sparkline (loading state or pre-#212 callsites).
	 */
	dailyShare?: number[];
};

// Top-of-page summary for the Costs view. Four cells (lifetime cost,
// 7-day cost + sparkline, session count, tracking-since OR board's-share)
// laid out as a `<dl>` so each label/value pair is semantically a
// description term. Mobile collapses to a 2-col grid — no horizontal
// scroll, no table.
//
// The sparkline mirrors the violet accent the BoardPulse strip uses for
// cost data so the visual association ("violet = cost") carries across
// surfaces.
//
// Phase 3 — board mode flips the fourth cell to "Board's share" (C3 with
// the `>0` denominator guard). The "Tracking since" timestamp moves out
// of the strip in board mode because it's a project-level fact, not a
// board-level one — and the share % is the question users actually have
// when they switch scope.
export function SummaryStrip({
	projectSummary,
	dailyCost,
	boardId,
	projectWideSummary,
	dailyShare,
}: SummaryStripProps) {
	const lifetimeCost = projectSummary.totalCostUsd;
	const weekCost = dailyCost.weekTotalCostUsd;
	const sessionCount = projectSummary.sessionCount;
	const trackingSince = projectSummary.trackingSince;
	const totalEnergyWh = projectSummary.totalEnergyWh;
	const totalCo2g = projectSummary.totalCo2g;
	const inBoardMode = !!boardId && !!projectWideSummary;

	return (
		<section className="space-y-2">
			<header className="flex items-center gap-1.5">
				<h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
					Summary
				</h2>
				<SectionHelpLink anchor="summary-strip" label="How is the summary strip calculated?" />
			</header>
			<dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
				<Cell label="Lifetime cost">
					<span className="font-mono text-2xl tabular-nums">{formatUsd(lifetimeCost)}</span>
				</Cell>

				<Cell label="Last 7 days">
					<div className="flex items-baseline gap-2">
						<span className="font-mono text-2xl tabular-nums">{formatUsd(weekCost)}</span>
						<Sparkline data={dailyCost.dailyCostUsd} tone="cost" label="Daily cost sparkline" />
					</div>
				</Cell>

				<Cell label="Sessions">
					<span className="font-mono text-2xl tabular-nums">{sessionCount}</span>
				</Cell>

				<EnergyCell totalEnergyWh={totalEnergyWh} totalCo2g={totalCo2g} />

				{inBoardMode ? (
					<Cell label="Board's share">
						<div className="flex items-baseline gap-2">
							<span className="font-mono text-2xl tabular-nums">
								{formatBoardShare(projectSummary.totalCostUsd, projectWideSummary.totalCostUsd)}
							</span>
							{dailyShare && dailyShare.length === 7 ? (
								<Sparkline data={dailyShare} tone="cost" label="Daily share sparkline" />
							) : null}
						</div>
					</Cell>
				) : (
					<Cell label="Tracking since">
						<span className="text-sm text-muted-foreground">
							{trackingSince ? formatRelative(trackingSince) : "—"}
						</span>
					</Cell>
				)}
			</dl>
		</section>
	);
}

// C3 — guard against a zero denominator. Mirrors the existing
// `formatRelative` `"—"` convention so the cell stays a single character
// when there's no project-wide cost yet. Exported for unit tests.
export function formatBoardShare(boardTotal: number, projectTotal: number): string {
	if (projectTotal <= 0) return "—";
	const pct = (boardTotal / projectTotal) * 100;
	return `${pct.toFixed(1)}%`;
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

// Energy cell (#180) — primary value is kWh; the tooltip surfaces grams CO₂
// and a link to the methodology doc so the assumptions behind the estimate
// are one click away. CO₂ is hidden by default to keep the strip readable.
function EnergyCell({ totalEnergyWh, totalCo2g }: { totalEnergyWh: number; totalCo2g: number }) {
	return (
		<Cell label="Energy">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className="cursor-help text-left font-mono text-2xl tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						{formatEnergy(totalEnergyWh)}
					</button>
				</TooltipTrigger>
				<TooltipContent
					side="bottom"
					sideOffset={6}
					className="max-w-xs space-y-1 px-2.5 py-1.5 text-xs leading-snug normal-case tracking-normal"
				>
					<div className="font-mono tabular-nums">{formatCo2(totalCo2g)}</div>
					<div className="text-muted-foreground">
						Estimated from per-token coefficients × world-average grid intensity.{" "}
						<a
							href={ENERGY_METHODOLOGY_DOCS_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2 hover:text-foreground"
						>
							Methodology →
						</a>
					</div>
				</TooltipContent>
			</Tooltip>
		</Cell>
	);
}
