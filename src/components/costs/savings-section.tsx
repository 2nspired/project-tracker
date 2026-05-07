"use client";

/**
 * Savings section (#273 — revived from #236).
 *
 * Surfaces the briefMe-vs-naive-bootstrap comparison persisted on
 * `Project.metadata.tokenBaseline`. Render path is intentionally cheap
 * (one tRPC read, no recomputation) — the actual measurement runs via
 * `recalibrateBaseline` on demand, and this section reads the cached
 * snapshot.
 *
 * When the baseline has never been measured (`summary === null`), the
 * section renders a "Recalibrate" prompt that triggers the mutation.
 * After a successful recalibration, the read query refetches and the
 * numbers swap in.
 */

import { useState } from "react";
import { SectionHelpLink } from "@/components/costs/section-help-link";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/ui/sparkline";
import { formatRelative } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type SavingsSummary = RouterOutputs["tokenUsage"]["getSavingsSummary"];
type BaselineHistory = RouterOutputs["tokenUsage"]["getBaselineHistory"];

type SavingsSectionProps = {
	projectId: string;
	summary: SavingsSummary;
};

export function SavingsSection({ projectId, summary }: SavingsSectionProps) {
	const utils = api.useUtils();
	const [isRecalibrating, setIsRecalibrating] = useState(false);
	// Trend data drives the sparkline below the stat row. Skipped while the
	// project has never recalibrated (the empty-state branch returns above
	// rendering the section body).
	const { data: history } = api.tokenUsage.getBaselineHistory.useQuery(
		{ projectId },
		{ enabled: summary !== null }
	);
	const recalibrate = api.tokenUsage.recalibrateBaseline.useMutation({
		onMutate: () => setIsRecalibrating(true),
		onSettled: async () => {
			await Promise.all([
				utils.tokenUsage.getSavingsSummary.invalidate({ projectId }),
				utils.tokenUsage.getBaselineHistory.invalidate({ projectId }),
			]);
			setIsRecalibrating(false);
		},
	});

	if (!summary) {
		return (
			<section className="rounded-md border bg-muted/20 px-5 py-4">
				<header className="flex items-baseline justify-between gap-4">
					<div>
						<div className="flex items-center gap-1.5">
							<h2 className="text-sm font-medium">Pigeon savings</h2>
							<SectionHelpLink
								anchor="pigeon-savings"
								label="How is the savings number calculated?"
							/>
						</div>
						<p className="mt-0.5 text-2xs text-muted-foreground">
							Compares this project's `briefMe` payload against a naive `getBoard` bootstrap. Run
							once to populate.
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						disabled={isRecalibrating}
						onClick={() => recalibrate.mutate({ projectId })}
					>
						{isRecalibrating ? "Measuring…" : "Measure now"}
					</Button>
				</header>
			</section>
		);
	}

	return (
		<section className="rounded-md border bg-muted/20 px-5 py-4">
			<header className="flex items-baseline justify-between gap-4">
				<div>
					<h2 className="text-sm font-medium">Pigeon savings</h2>
					<p className="mt-0.5 text-2xs text-muted-foreground">
						Each `briefMe` call ships{" "}
						<span className="font-mono tabular-nums">{summary.briefMeTokens.toLocaleString()}</span>{" "}
						tokens vs.{" "}
						<span className="font-mono tabular-nums">
							{summary.naiveBootstrapTokens.toLocaleString()}
						</span>{" "}
						for the naive `getBoard` bootstrap. Measured {formatRelative(summary.measuredAt)}.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					disabled={isRecalibrating}
					onClick={() => recalibrate.mutate({ projectId })}
				>
					{isRecalibrating ? "Recalibrating…" : "Recalibrate"}
				</Button>
			</header>

			<dl
				className={cn(
					"mt-4 grid grid-cols-2 gap-4",
					summary.latestHandoffTokens != null ? "sm:grid-cols-4" : "sm:grid-cols-3"
				)}
			>
				<Stat
					label="Saved per call"
					primary={`${summary.savings.toLocaleString()} tok`}
					secondary={`${(summary.savingsPct * 100).toFixed(1)}%`}
				/>
				<Stat label="briefMe payload" primary={`${summary.briefMeTokens.toLocaleString()} tok`} />
				<Stat
					label="Naive bootstrap"
					primary={`${summary.naiveBootstrapTokens.toLocaleString()} tok`}
				/>
				{summary.latestHandoffTokens != null ? (
					<Stat
						label="Latest handoff"
						primary={`${summary.latestHandoffTokens.toLocaleString()} tok`}
					/>
				) : null}
			</dl>

			<BriefMeTrend history={history ?? null} />
		</section>
	);
}

// briefMe-payload trend (#293). Hides until the project has ≥2
// snapshots — a single point isn't a trend, and rendering it as a flat
// dot is more confusing than a one-line "go again" prompt. `tone="cost"`
// (violet) matches the existing visual language for cost surfaces
// across summary-strip / BoardPulse.
function BriefMeTrend({ history }: { history: BaselineHistory | null }) {
	if (!history) return null;
	if (history.length < 2) {
		return (
			<p className="mt-3 text-2xs text-muted-foreground/60">
				Recalibrate again to start the trend line.
			</p>
		);
	}
	const values = history.map((row) => row.briefMeTokens);
	const firstAt = new Date(history[0].measuredAt);
	return (
		<div className="mt-4 flex items-baseline gap-3">
			<dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
				briefMe over time
			</dt>
			<Sparkline data={values} tone="cost" w={160} h={32} label="briefMe payload trend" />
			<span className="text-2xs text-muted-foreground/60">since {formatRelative(firstAt)}</span>
		</div>
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
