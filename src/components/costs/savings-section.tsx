"use client";

import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { SavingsMethodologySheet } from "@/components/costs/savings-methodology-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCost } from "@/lib/format-cost";
import { formatRelativeCompact } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

type Period = "7d" | "30d" | "lifetime";
type SavingsSummary = RouterOutputs["tokenUsage"]["getSavingsSummary"];

type Props = {
	projectId: string;
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
export function SavingsSection({ projectId }: Props) {
	const [period, setPeriod] = useState<Period>("30d");
	const [methodologyOpen, setMethodologyOpen] = useState(false);

	const { data, isLoading, error } = api.tokenUsage.getSavingsSummary.useQuery(
		{ projectId, period },
		{ staleTime: 60_000, retry: false }
	);

	return (
		<>
			<Section
				step="01b"
				title="Pigeon paid for itself"
				right={<PeriodPills value={period} onChange={setPeriod} />}
			>
				{error ? (
					<DiagnosticRow tone="amber">Could not load savings data — {error.message}</DiagnosticRow>
				) : isLoading || !data ? (
					<LoadingState />
				) : data.state === "no-baseline" ? (
					<NoBaselineState projectId={projectId} />
				) : (
					<ReadyState summary={data} onOpenMethodology={() => setMethodologyOpen(true)} />
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
	onOpenMethodology,
}: {
	summary: Extract<SavingsSummary, { state: "ready" }>;
	onOpenMethodology: () => void;
}) {
	const negative = summary.netSavingsUsd < 0;

	return (
		<div className="space-y-4">
			<Headline summary={summary} negative={negative} />

			<button
				type="button"
				onClick={onOpenMethodology}
				className="font-mono text-2xs text-muted-foreground transition-colors hover:text-foreground"
			>
				How we calculate this →
			</button>

			<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-2xs">
				<MetricRow label="gross savings" value={formatCost(summary.grossSavingsUsd)} />
				<MetricRow label="Pigeon overhead" value={formatCost(summary.pigeonOverheadUsd)} />
				<MetricRow
					label="net savings"
					value={formatCost(summary.netSavingsUsd)}
					tone={negative ? "amber" : "emerald"}
				/>
			</dl>

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
	if (negative) {
		const cost = Math.abs(summary.netSavingsUsd);
		return (
			<p className="font-mono text-3xl tabular-nums text-amber-600 dark:text-amber-400">
				Pigeon cost {formatCost(cost)} more than it saved this period.
			</p>
		);
	}
	return (
		<p className="font-mono text-3xl tabular-nums text-foreground">
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

// ─── Section frame (mirrors PigeonOverheadSection) ─────────────────

function StepLabel({ n }: { n: string }) {
	return <span className="font-mono text-2xs text-muted-foreground/60 tabular-nums">{n}</span>;
}

function Section({
	step,
	title,
	right,
	children,
}: {
	step: string;
	title: string;
	right?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="space-y-2.5 border-t border-border/50 pt-4">
			<div className="flex items-baseline gap-2.5">
				<StepLabel n={step} />
				<h3 className="text-sm font-medium tracking-tight">{title}</h3>
				{right && <div className="ml-auto">{right}</div>}
			</div>
			{children}
		</section>
	);
}

// ─── Period pill selector (mirrors PigeonOverheadSection) ──────────

function PeriodPills({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
	return (
		<div className="inline-flex items-center gap-1">
			<PeriodPill active={value === "7d"} onClick={() => onChange("7d")}>
				7d
			</PeriodPill>
			<PeriodPill active={value === "30d"} onClick={() => onChange("30d")}>
				30d
			</PeriodPill>
			<PeriodPill active={value === "lifetime"} onClick={() => onChange("lifetime")}>
				Lifetime
			</PeriodPill>
		</div>
	);
}

function PeriodPill({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-2xs uppercase tracking-wide transition-colors",
				active
					? "border-foreground/20 bg-muted text-foreground"
					: "border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground"
			)}
		>
			{children}
		</button>
	);
}

// ─── Diagnostic + metric rows ──────────────────────────────────────

function DiagnosticRow({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" }) {
	const tonal =
		tone === "amber"
			? "border-l-amber-500 bg-amber-500/5 text-amber-700 dark:text-amber-400"
			: "border-l-muted-foreground/40 bg-muted/30 text-muted-foreground";
	return (
		<div className={cn("rounded border-l-2 px-3 py-1.5 font-mono text-2xs", tonal)}>{children}</div>
	);
}

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
