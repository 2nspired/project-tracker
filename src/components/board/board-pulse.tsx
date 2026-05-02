"use client";

import { Activity, AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";

import { TokenTrackingSetupDialog } from "@/components/board/token-tracking-setup-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkline } from "@/components/ui/sparkline";
import { formatCost } from "@/lib/format-cost";
import { formatRelative } from "@/lib/format-date";
import { STATUS_TEXT } from "@/lib/priority-colors";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

function formatHours(hours: number): string {
	if (hours < 1) return `${Math.round(hours * 60)}m`;
	if (hours < 24) return `${hours}h`;
	const days = Math.round((hours / 24) * 10) / 10;
	return `${days}d`;
}

export function BoardPulse({ boardId, projectId }: { boardId: string; projectId: string }) {
	const { data: metrics } = api.activity.flowMetrics.useQuery({ boardId }, { staleTime: 60_000 });
	// Board-scoped — keeps the inline cost number and the popover totals
	// honest about the surface they live on. Was previously project-wide
	// (#224), which contradicted the board-mode Costs page and produced a
	// misleading $/card ratio (board-scoped completions ÷ project-wide cost).
	const { data: dailyCost } = api.tokenUsage.getDailyCostSeries.useQuery(
		{ projectId, boardId },
		{ staleTime: 60_000 }
	);
	const { data: projectSummary } = api.tokenUsage.getProjectSummary.useQuery(
		{ projectId, boardId },
		{ staleTime: 60_000 }
	);
	// Project-wide totals — used only to (a) gate the "Set up token tracking"
	// CTA so it doesn't fire when events are flowing project-wide but not
	// attributed to this board's cards, and (b) surface that attribution gap
	// in the popover so the user sees both the board number and the project
	// number. Same pattern as the board-mode Costs page (#223).
	const { data: projectWideSummary } = api.tokenUsage.getProjectSummary.useQuery(
		{ projectId },
		{ staleTime: 60_000 }
	);

	if (!metrics) return null;

	const totalCompleted = metrics.throughput.reduce((a, b) => a + b, 0);
	const hasFlowData =
		totalCompleted > 0 ||
		metrics.forwardMoves > 0 ||
		metrics.backwardMoves > 0 ||
		metrics.bottleneck !== null;

	const weekCost = dailyCost?.weekTotalCostUsd ?? 0;
	const lifetimeCost = projectSummary?.totalCostUsd ?? 0;
	const hasWeekCost = weekCost > 0;
	const projectWideCost = projectWideSummary?.totalCostUsd ?? 0;
	const projectWideEventCount = projectWideSummary?.eventCount ?? 0;
	const projectHasAnyCost = projectWideCost > 0 || projectWideEventCount > 0;
	// CTA fires only when the project as a whole has no token data — telling
	// the user to "Set up token tracking" while events are flowing project-
	// wide but not yet card-attributed would mislead.
	const showCostSetupCta = hasFlowData && !projectHasAnyCost;

	if (!hasFlowData && !hasWeekCost) return null;

	const wowDelta = totalCompleted - metrics.previousWeekCompleted;
	const costPerCompleted = totalCompleted > 0 && hasWeekCost ? weekCost / totalCompleted : null;

	return (
		<Popover>
			<div className="flex items-center gap-3 bg-muted/20 px-4 py-2.5 text-xs">
				<PopoverTrigger asChild>
					<button
						type="button"
						className="flex flex-1 items-center gap-5 text-left transition-colors hover:opacity-80"
						aria-label="Open pulse details"
					>
						<span className="flex items-center gap-2 text-muted-foreground">
							<Activity className="h-3 w-3" />
							Pulse
						</span>

						{hasFlowData && (
							<div
								className="flex items-center gap-2"
								title={`${totalCompleted} cards completed this week`}
							>
								<Sparkline data={metrics.throughput} label="Throughput sparkline" />
								<span className="tabular-nums text-muted-foreground">
									<span className="font-medium text-foreground">{totalCompleted}</span> done
								</span>
							</div>
						)}

						{hasWeekCost && dailyCost && (
							<div className="flex items-center gap-2" title={`${formatCost(weekCost)} this week`}>
								<Sparkline
									data={dailyCost.dailyCostUsd}
									strokeClassName="stroke-violet-500"
									fillClassName="fill-violet-500/10"
									dotClassName="fill-violet-500"
									label="Daily cost sparkline"
								/>
								<span className="tabular-nums text-muted-foreground">
									<span className="font-medium text-foreground">{formatCost(weekCost)}</span> spent
								</span>
							</div>
						)}

						{hasFlowData && (
							<div className="flex items-center gap-2 text-muted-foreground">
								<span
									className={`flex items-center gap-1 ${STATUS_TEXT.done}`}
									title={`${metrics.forwardMoves} forward moves`}
								>
									<ArrowRight className="h-3 w-3" />
									<span className="tabular-nums">{metrics.forwardMoves}</span>
								</span>
								{metrics.backwardMoves > 0 && (
									<span
										className={`flex items-center gap-1 ${STATUS_TEXT.warning}`}
										title={`${metrics.backwardMoves} regressions`}
									>
										<ArrowLeft className="h-3 w-3" />
										<span className="tabular-nums">{metrics.backwardMoves}</span>
									</span>
								)}
							</div>
						)}

						{metrics.bottleneck && (
							<div
								className="flex items-center gap-1.5 text-muted-foreground"
								title={`Cards spend an average of ${formatHours(metrics.bottleneck.avgHours)} in ${metrics.bottleneck.column}`}
							>
								<AlertTriangle className={`h-3 w-3 ${STATUS_TEXT.warning}`} />
								<span>
									{metrics.bottleneck.column}{" "}
									<span className={`font-medium ${STATUS_TEXT.warning} tabular-nums`}>
										~{formatHours(metrics.bottleneck.avgHours)}
									</span>{" "}
									avg
								</span>
							</div>
						)}
					</button>
				</PopoverTrigger>

				{showCostSetupCta && (
					<TokenTrackingSetupDialog
						trigger={
							<button
								type="button"
								className="flex shrink-0 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
							>
								Set up token tracking
							</button>
						}
					/>
				)}
			</div>

			<PopoverContent className="w-96 p-0" align="start" sideOffset={2}>
				<PulseDetails
					projectId={projectId}
					metrics={metrics}
					dailyCost={dailyCost ?? null}
					projectSummary={projectSummary ?? null}
					projectWideSummary={projectWideSummary ?? null}
					totalCompleted={totalCompleted}
					weekCost={weekCost}
					lifetimeCost={lifetimeCost}
					wowDelta={wowDelta}
					costPerCompleted={costPerCompleted}
				/>
			</PopoverContent>
		</Popover>
	);
}

type FlowMetrics = RouterOutputs["activity"]["flowMetrics"];
type DailyCostSeries = RouterOutputs["tokenUsage"]["getDailyCostSeries"];
type ProjectSummary = RouterOutputs["tokenUsage"]["getProjectSummary"];

type PulseDetailsProps = {
	projectId: string;
	metrics: FlowMetrics;
	dailyCost: DailyCostSeries | null;
	projectSummary: ProjectSummary | null;
	projectWideSummary: ProjectSummary | null;
	totalCompleted: number;
	weekCost: number;
	lifetimeCost: number;
	wowDelta: number;
	costPerCompleted: number | null;
};

function PulseDetails({
	projectId,
	metrics,
	projectSummary,
	projectWideSummary,
	totalCompleted,
	weekCost,
	lifetimeCost,
	wowDelta,
	costPerCompleted,
}: PulseDetailsProps) {
	const hasBoardCost = weekCost > 0 || lifetimeCost > 0;
	const projectWideCost = projectWideSummary?.totalCostUsd ?? 0;
	const projectWideEventCount = projectWideSummary?.eventCount ?? 0;
	const projectHasCost = projectWideCost > 0 || projectWideEventCount > 0;
	// Attribution gap: project has token data but none of it is tied to cards
	// on this board. Surface it explicitly so the popover doesn't read as a
	// dead "$0" — and link to project totals so the user can verify.
	const showAttributionGap = !hasBoardCost && projectHasCost;
	const trackingSince = projectSummary?.trackingSince ?? null;
	const topModels = projectSummary?.byModel.slice(0, 3) ?? [];

	return (
		<div className="divide-y divide-border">
			<div className="space-y-2 p-4">
				<div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
					Flow · last 7 days
				</div>
				<dl className="space-y-1 text-sm">
					<div className="flex items-baseline justify-between gap-3">
						<dt className="text-muted-foreground">Completed</dt>
						<dd className="tabular-nums">
							<span className="font-medium">{totalCompleted}</span>
							{metrics.previousWeekCompleted > 0 || totalCompleted > 0 ? (
								<span
									className={`ml-2 text-xs ${
										wowDelta > 0
											? "text-emerald-500"
											: wowDelta < 0
												? "text-amber-500"
												: "text-muted-foreground"
									}`}
								>
									{wowDelta > 0 ? "+" : ""}
									{wowDelta} vs last week
								</span>
							) : null}
						</dd>
					</div>
					<div className="flex items-baseline justify-between gap-3">
						<dt className="text-muted-foreground">Forward / regressions</dt>
						<dd className="tabular-nums">
							<span className={STATUS_TEXT.done}>{metrics.forwardMoves}</span>
							<span className="text-muted-foreground"> / </span>
							<span className={metrics.backwardMoves > 0 ? STATUS_TEXT.warning : ""}>
								{metrics.backwardMoves}
							</span>
						</dd>
					</div>
					{metrics.bottleneck && (
						<div className="flex items-baseline justify-between gap-3">
							<dt className="text-muted-foreground">Slowest column</dt>
							<dd className="tabular-nums">
								<span className="font-medium">{metrics.bottleneck.column}</span>
								<span className="ml-1 text-xs text-muted-foreground">
									~{formatHours(metrics.bottleneck.avgHours)} avg
								</span>
							</dd>
						</div>
					)}
				</dl>
			</div>

			{hasBoardCost ? (
				<div className="space-y-2 p-4">
					<div className="flex items-baseline justify-between gap-3">
						<div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
							Token cost
						</div>
						{trackingSince && (
							<div className="text-2xs text-muted-foreground">
								since {formatRelative(trackingSince)}
							</div>
						)}
					</div>
					<dl className="space-y-1 text-sm">
						<div className="flex items-baseline justify-between gap-3">
							<dt className="text-muted-foreground">This week</dt>
							<dd className="tabular-nums font-medium">{formatCost(weekCost)}</dd>
						</div>
						{lifetimeCost > 0 && Math.abs(lifetimeCost - weekCost) > 0.0001 && (
							<div className="flex items-baseline justify-between gap-3">
								<dt className="text-muted-foreground">Lifetime</dt>
								<dd className="tabular-nums">{formatCost(lifetimeCost)}</dd>
							</div>
						)}
						{costPerCompleted !== null && (
							<div className="flex items-baseline justify-between gap-3">
								<dt className="text-muted-foreground">Cost / completed card</dt>
								<dd className="tabular-nums">{formatCost(costPerCompleted)}</dd>
							</div>
						)}
					</dl>
					{topModels.length > 0 && (
						<div className="mt-2 border-t border-border/50 pt-2">
							<div className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">
								Top models
							</div>
							<div className="space-y-0.5">
								{topModels.map((m) => (
									<div key={m.model} className="flex items-baseline justify-between gap-2 text-xs">
										<span className="truncate font-mono text-muted-foreground">{m.model}</span>
										<span className="shrink-0 tabular-nums">{formatCost(m.costUsd)}</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			) : showAttributionGap ? (
				<div className="space-y-2 p-4">
					<div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
						Token cost
					</div>
					<p className="text-xs text-muted-foreground">
						No token cost attributed to this board yet — events are flowing project-wide but haven't
						been tied to cards on this board.
					</p>
					<dl className="space-y-1 text-sm">
						<div className="flex items-baseline justify-between gap-3">
							<dt className="text-muted-foreground">This board</dt>
							<dd className="tabular-nums">{formatCost(0)}</dd>
						</div>
						<div className="flex items-baseline justify-between gap-3">
							<dt className="text-muted-foreground">Project-wide</dt>
							<dd className="tabular-nums">{formatCost(projectWideCost)}</dd>
						</div>
					</dl>
					<a
						href={`/projects/${projectId}/costs`}
						className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					>
						View project totals →
					</a>
				</div>
			) : (
				<div className="p-4">
					<TokenTrackingSetupDialog
						trigger={
							<button
								type="button"
								className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
							>
								Set up token tracking
							</button>
						}
					/>
				</div>
			)}
		</div>
	);
}
