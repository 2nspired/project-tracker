"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatCost } from "@/lib/format-cost";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

type Period = "7d" | "30d" | "lifetime";
type Overhead = RouterOutputs["tokenUsage"]["getPigeonOverhead"];

type Props = {
	projectId: string;
};

// "Pigeon overhead" section on the Costs page. Sums `responseTokens` from
// `ToolCallLog`, multiplies by the per-session `outputPerMTok`, groups by
// `toolName`. Period selector (7d / 30d / Lifetime) controls the cutoff
// against `TokenUsageEvent.recordedAt` — sessions whose first event lands
// in-window are included.
//
// Visual contract mirrors `<Section>` from token-tracking-setup-dialog
// (step "02", border-top frame, 2xs uppercase step label) so the Costs
// page reads as a single editorial procedure.
export function PigeonOverheadSection({ projectId }: Props) {
	const [period, setPeriod] = useState<Period>("7d");
	const [showBreakdown, setShowBreakdown] = useState(false);

	const { data, isLoading, error } = api.tokenUsage.getPigeonOverhead.useQuery(
		{ projectId, period },
		{ staleTime: 60_000, retry: false }
	);

	return (
		<Section
			step="02"
			title="Pigeon overhead"
			right={<PeriodPills value={period} onChange={setPeriod} />}
		>
			{error ? (
				<DiagnosticRow tone="amber">Couldn't load Pigeon overhead — {error.message}</DiagnosticRow>
			) : isLoading ? (
				<p className="text-xs text-muted-foreground">Loading…</p>
			) : !data || data.byTool.length === 0 ? (
				<p className="text-xs text-muted-foreground">No Pigeon tool calls recorded yet</p>
			) : (
				<div className="space-y-2">
					<SummaryRow data={data} />
					<HighCallCountInsight data={data} />
					<button
						type="button"
						onClick={() => setShowBreakdown((s) => !s)}
						className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{showBreakdown ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)}
						{showBreakdown ? "Hide" : "Show"} breakdown
					</button>
					{showBreakdown && <Breakdown data={data} />}
				</div>
			)}
		</Section>
	);
}

// ─── Section frame (mirrors token-tracking-setup-dialog) ──────────

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

// ─── Period pill selector ─────────────────────────────────────────

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

// ─── Summary row ──────────────────────────────────────────────────

function SummaryRow({ data }: { data: Overhead }) {
	const totalCalls = data.byTool.reduce((sum, t) => sum + t.callCount, 0);
	return (
		<p className="font-mono text-sm tabular-nums text-foreground/90">
			{data.sessionCount} {data.sessionCount === 1 ? "session" : "sessions"} · {totalCalls} total
			tool {totalCalls === 1 ? "call" : "calls"} · {formatCost(data.totalCostUsd)} overhead
		</p>
	);
}

// ─── Tool-efficiency insight (>10× call count) ────────────────────

function HighCallCountInsight({ data }: { data: Overhead }) {
	const noisy = data.byTool.find((t) => t.callCount > 10);
	if (!noisy) return null;
	return (
		<DiagnosticRow tone="amber">
			{noisy.toolName} called {noisy.callCount}× — consider batching context fetches
		</DiagnosticRow>
	);
}

// ─── Breakdown grid ───────────────────────────────────────────────

function Breakdown({ data }: { data: Overhead }) {
	return (
		<dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-[1fr_auto_auto_auto]">
			<HeaderCell>Tool</HeaderCell>
			<HeaderCell className="text-right">Calls</HeaderCell>
			<HeaderCell className="hidden text-right sm:block">Avg tokens</HeaderCell>
			<HeaderCell className="text-right">Cost</HeaderCell>
			{data.byTool.map((t) => (
				<RowCells key={t.toolName} t={t} />
			))}
		</dl>
	);
}

function HeaderCell({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<dt className={cn("text-2xs uppercase tracking-wide text-muted-foreground/70", className)}>
			{children}
		</dt>
	);
}

function RowCells({
	t,
}: {
	t: { toolName: string; callCount: number; avgResponseTokens: number; totalCostUsd: number };
}) {
	return (
		<>
			<dd className="truncate text-foreground/90">{t.toolName}</dd>
			<dd className="text-right tabular-nums text-foreground/80">{t.callCount}</dd>
			<dd className="hidden text-right tabular-nums text-muted-foreground sm:block">
				{t.avgResponseTokens}
			</dd>
			<dd className="text-right tabular-nums text-foreground/80">{formatCost(t.totalCostUsd)}</dd>
		</>
	);
}

// ─── Diagnostic row (muted amber strip) ───────────────────────────

function DiagnosticRow({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" }) {
	const tonal =
		tone === "amber"
			? "border-l-amber-500 bg-amber-500/5 text-amber-700 dark:text-amber-400"
			: "border-l-muted-foreground/40 bg-muted/30 text-muted-foreground";
	return (
		<div className={cn("rounded border-l-2 px-3 py-1.5 font-mono text-2xs", tonal)}>{children}</div>
	);
}
