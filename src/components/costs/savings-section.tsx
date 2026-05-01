"use client";

import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SavingsMethodologySheet } from "@/components/costs/savings-methodology-sheet";
import { DiagnosticRow, type Period, PeriodPills, Section } from "@/components/costs/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCost } from "@/lib/format-cost";
import { formatRelativeCompact } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

type SavingsSummary = RouterOutputs["tokenUsage"]["getSavingsSummary"];
type ProjectSummary = RouterOutputs["tokenUsage"]["getProjectSummary"];

type Props = {
	projectId: string;
	/**
	 * Set when the route is in board mode (Phase 3 D2/N2). Savings itself
	 * is project-only (Phase 1b territory) so the figures don't change —
	 * but the section gains a clarifying subtitle and an empty-state branch
	 * when this board has no attributed sessions yet.
	 */
	boardId?: string;
	/**
	 * Board-scoped project summary (totals constrained to the active
	 * board). Used only to detect "this board has zero attributed cost"
	 * for the N2 empty-state branch.
	 */
	boardSummary?: ProjectSummary;
	/**
	 * Project-wide summary (totals across all boards). Used to confirm
	 * the project has *some* data before flipping into the empty-state
	 * branch — keeps us from claiming "no board data" when the project
	 * itself is brand new and has nothing recorded anywhere yet.
	 */
	projectWideSummary?: ProjectSummary;
};

// "Pigeon paid for itself" — headline differentiator for the Token
// Tracking milestone. Methodology lives in a Sheet (not a tooltip), the
// figure is conservative, and negative net savings render honestly in
// amber instead of being hidden.
//
// Visual order on the Costs page is:
//   SummaryStrip → SavingsSection → PigeonOverheadSection → CardDeliverySection
//
// State machine:
//   - no-baseline: empty headline + Recalibrate CTA
//   - loading: skeleton headline
//   - ready+positive: dollar headline + 3-row diagnostic + per-session log
//   - ready+negative: amber headline + same body + sub-note
//   - error: amber DiagnosticRow, no crash
//
// Section / StepLabel / PeriodPills / DiagnosticRow live in `./section.tsx`
// (#200 Phase 3 refactor). The `tone="anchor"` Section variant + inline
// formula caption + headline scale (D3/D4/D5/D6) are applied here so this
// section anchors the Costs page visually while keeping the same step-
// numbered rhythm as the lenses below it.
export function SavingsSection({ projectId, boardId, boardSummary, projectWideSummary }: Props) {
	const [period, setPeriod] = useState<Period>("30d");
	const [methodologyOpen, setMethodologyOpen] = useState(false);

	const { data, isLoading, error } = api.tokenUsage.getSavingsSummary.useQuery(
		{ projectId, period },
		{ staleTime: 60_000, retry: false }
	);

	// N2 — Statement empty-state for board mode. Trigger only when:
	//   • we're scoped to a board,
	//   • that board has zero attributed cost,
	//   • the project itself does have some data (otherwise the user is
	//     just before-first-event, the regular `<EmptyState>` higher up
	//     covers that).
	const showBoardEmptyState =
		!!boardId &&
		!!boardSummary &&
		boardSummary.totalCostUsd === 0 &&
		!!projectWideSummary &&
		projectWideSummary.totalCostUsd > 0;

	return (
		<>
			<Section
				step="01b"
				title="Pigeon paid for itself"
				tone="anchor"
				right={<PeriodPills value={period} onChange={setPeriod} />}
			>
				{showBoardEmptyState ? (
					<BoardEmptyState />
				) : error ? (
					<DiagnosticRow tone="amber">Could not load savings data — {error.message}</DiagnosticRow>
				) : isLoading || !data ? (
					<LoadingState />
				) : data.state === "no-baseline" ? (
					<NoBaselineState projectId={projectId} />
				) : (
					<ReadyState
						summary={data}
						boardId={boardId}
						onOpenMethodology={() => setMethodologyOpen(true)}
					/>
				)}
			</Section>
			{data && (
				<SavingsMethodologySheet
					projectId={projectId}
					open={methodologyOpen}
					onOpenChange={setMethodologyOpen}
					summary={data}
				/>
			)}
		</>
	);
}

// ─── Board empty-state (N2) ────────────────────────────────────────

function BoardEmptyState() {
	const router = useRouter();
	const pathname = usePathname();
	return (
		<div className="space-y-3">
			<p className="font-mono text-sm text-muted-foreground">
				No board-attributed sessions yet — savings shown at project level.
			</p>
			<button
				type="button"
				onClick={() =>
					router.replace(pathname as Parameters<typeof router.replace>[0], { scroll: false })
				}
				className="font-mono text-2xs text-muted-foreground transition-colors hover:text-foreground"
			>
				View project totals →
			</button>
		</div>
	);
}

// ─── States ────────────────────────────────────────────────────────

function LoadingState() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-9 w-3/4" />
			<div className="space-y-1.5">
				<Skeleton className="h-4 w-1/2" />
				<Skeleton className="h-4 w-1/2" />
				<Skeleton className="h-4 w-1/2" />
			</div>
		</div>
	);
}

function NoBaselineState({ projectId }: { projectId: string }) {
	const utils = api.useUtils();
	const mutation = api.tokenUsage.recalibrateBaseline.useMutation({
		onSuccess: async () => {
			toast.success("Baseline measured");
			await utils.tokenUsage.getSavingsSummary.invalidate({ projectId });
		},
		onError: (e) => {
			toast.error(`Could not recalibrate — ${e.message}`);
		},
	});

	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				Baseline not measured yet. Recalibrate to compare briefMe against a naive bootstrap and
				start tracking savings.
			</p>
			<Button
				variant="outline"
				size="sm"
				onClick={() => mutation.mutate({ projectId })}
				disabled={mutation.isPending}
				className="font-mono text-2xs"
			>
				<RefreshCw className={cn("h-3 w-3", mutation.isPending && "animate-spin")} />
				{mutation.isPending ? "Measuring…" : "Recalibrate baseline"}
			</Button>
		</div>
	);
}

function ReadyState({
	summary,
	boardId,
	onOpenMethodology,
}: {
	summary: Extract<SavingsSummary, { state: "ready" }>;
	boardId?: string;
	onOpenMethodology: () => void;
}) {
	const negative = summary.netSavingsUsd < 0;
	const netToneClass = negative
		? "text-amber-700 dark:text-amber-400"
		: "text-emerald-700 dark:text-emerald-400";

	return (
		<div className="space-y-4">
			<Headline summary={summary} negative={negative} />

			{boardId ? (
				<p className="text-xs text-muted-foreground">Calculated from the project-level baseline.</p>
			) : null}

			{/* D3 — inline formula caption, sits above the existing dl. */}
			<p className="font-mono text-2xs text-muted-foreground/70">
				{formatCost(summary.grossSavingsUsd)} gross − {formatCost(summary.pigeonOverheadUsd)}{" "}
				overhead ={" "}
				<span className={cn("tabular-nums", netToneClass)}>
					{formatCost(summary.netSavingsUsd)} net
				</span>
			</p>

			<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-2xs">
				<MetricRow label="gross savings" value={formatCost(summary.grossSavingsUsd)} />
				<MetricRow label="Pigeon overhead" value={formatCost(summary.pigeonOverheadUsd)} />
				<MetricRow
					label="net savings"
					value={formatCost(summary.netSavingsUsd)}
					tone={negative ? "amber" : "emerald"}
				/>
			</dl>

			<button
				type="button"
				onClick={onOpenMethodology}
				className="font-mono text-2xs text-muted-foreground transition-colors hover:text-foreground"
			>
				How we calculate this →
			</button>

			{negative && (
				<p className="text-xs text-muted-foreground">
					This can happen when briefMe is called infrequently relative to tool overhead.
				</p>
			)}

			<PerSessionLog entries={summary.perSessionLog} />
		</div>
	);
}

function Headline({
	summary,
	negative,
}: {
	summary: Extract<SavingsSummary, { state: "ready" }>;
	negative: boolean;
}) {
	// D4 — `text-2xl sm:text-3xl md:text-4xl`. At 375px `text-3xl` orphans the
	// dollar amount. Dollar value stays neutral (no violet ink — D5) so the
	// only color cue is the amber/foreground split for negative vs positive.
	if (negative) {
		const cost = Math.abs(summary.netSavingsUsd);
		return (
			<p className="font-mono text-2xl tabular-nums text-amber-600 sm:text-3xl md:text-4xl dark:text-amber-400">
				Pigeon cost {formatCost(cost)} more than it saved this period.
			</p>
		);
	}
	return (
		<p className="font-mono text-2xl tabular-nums text-foreground sm:text-3xl md:text-4xl">
			Pigeon saved you {formatCost(summary.netSavingsUsd)} this period.
		</p>
	);
}

// ─── Per-session log ───────────────────────────────────────────────

function PerSessionLog({
	entries,
}: {
	entries: Extract<SavingsSummary, { state: "ready" }>["perSessionLog"];
}) {
	const [open, setOpen] = useState(false);
	if (entries.length === 0) return null;

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((s) => !s)}
				className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground transition-colors hover:text-foreground"
			>
				{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				{open ? "Hide" : "Show"} per-session log ({entries.length})
			</button>
			{open && (
				<ul className="mt-2 space-y-1 font-mono text-2xs">
					{entries.map((entry) => (
						<li
							key={entry.sessionId}
							className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-3"
						>
							<span className="text-muted-foreground">{entry.sessionId.slice(0, 8)}</span>
							<span className="text-muted-foreground/60">
								−{formatCost(entry.pigeonCostUsd)} overhead
							</span>
							<span className="text-muted-foreground/60 tabular-nums">
								{formatRelativeCompact(entry.recordedAt)}
							</span>
							<span className="tabular-nums text-foreground/90">
								{formatCost(entry.savingsUsd)}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

// ─── Metric rows ───────────────────────────────────────────────────

function MetricRow({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "emerald" | "amber";
}) {
	const valueClass =
		tone === "emerald"
			? "text-emerald-700 dark:text-emerald-400"
			: tone === "amber"
				? "text-amber-700 dark:text-amber-400"
				: "text-foreground";
	return (
		<>
			<dt className="text-muted-foreground/70">
				<span className="text-muted-foreground/40">›</span> {label}
			</dt>
			<dd className={cn("tabular-nums", valueClass)}>{value}</dd>
		</>
	);
}
