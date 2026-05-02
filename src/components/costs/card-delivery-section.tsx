"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCost } from "@/lib/format-cost";
import { formatRelativeCompact } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

// Cost-per-shipped-card lens (#196 U4 — surface (d) of the Token Tracking
// milestone). "Shipped" = `Card.completedAt IS NOT NULL`, set when a card
// enters a Done-role column. Definition is rendered as a permanent caption
// rather than a tooltip — transparency is part of the surface, not an
// affordance the user has to discover.
//
// Period selector switches the headline + delta + top-5; Lifetime hides
// the previous-period delta arrow (no meaningful "previous lifetime"
// window). Cards with $0 attributed cost are excluded from the avg/total
// math but still counted in `shippedCount`, so the header can render the
// honest "N shipped · No AI cost recorded" partial state when the project
// has shipped work that lacks `attributeSession`-level wiring.

type Period = "7d" | "30d" | "lifetime";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
	{ value: "7d", label: "7d" },
	{ value: "30d", label: "30d" },
	{ value: "lifetime", label: "Lifetime" },
];

type CardDeliverySectionProps = {
	projectId: string;
	/**
	 * Cosmetic. Renders a `(project-wide)` Badge in the section header when
	 * `scope === "board"` to honestly signal that this lens does not yet
	 * board-scope its query (Phase 1b territory). Not a data input — the
	 * underlying tRPC call still passes only `projectId`.
	 */
	scope?: "project" | "board";
};

export function CardDeliverySection({ projectId, scope = "project" }: CardDeliverySectionProps) {
	const [period, setPeriod] = useState<Period>("30d");
	const { data, isLoading, error } = api.tokenUsage.getCardDeliveryMetrics.useQuery(
		{ projectId, period },
		{ staleTime: 60_000 }
	);

	return (
		<section className="space-y-3">
			<header className="flex items-baseline justify-between gap-3">
				<h2 className="inline-flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
					Cost per shipped card
					{scope === "board" ? (
						<Badge
							variant="outline"
							className="font-mono text-2xs font-normal normal-case tracking-normal"
						>
							project-wide
						</Badge>
					) : null}
				</h2>
				<PeriodPills value={period} onChange={setPeriod} />
			</header>

			{error ? (
				<ErrorRow message={error.message} />
			) : isLoading || !data ? (
				<LoadingState />
			) : (
				<DeliveryContent data={data} />
			)}

			<p className="text-2xs text-muted-foreground">
				Shipped = card moved to Done. Cards with no attributed token events are excluded.
			</p>
		</section>
	);
}

// ─── Subcomponents ─────────────────────────────────────────────────

function PeriodPills({ value, onChange }: { value: Period; onChange: (next: Period) => void }) {
	return (
		<div className="flex flex-wrap gap-1">
			{PERIOD_OPTIONS.map((opt) => {
				const active = opt.value === value;
				return (
					<button
						key={opt.value}
						type="button"
						onClick={() => onChange(opt.value)}
						aria-pressed={active}
						className={cn(
							"rounded-md border px-2 py-0.5 text-2xs font-medium tabular-nums transition-colors",
							active
								? "border-foreground/20 bg-foreground/10 text-foreground"
								: "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
						)}
					>
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}

function DeliveryContent({
	data,
}: {
	data: {
		shippedCount: number;
		avgCostUsd: number;
		totalCostUsd: number;
		top5: {
			cardId: string;
			cardNumber: number;
			cardTitle: string;
			completedAt: Date | string;
			totalCostUsd: number;
		}[];
		periodLabel: Period;
		previousPeriodAvgCostUsd: number | null;
	};
}) {
	const { shippedCount, avgCostUsd, totalCostUsd, top5, previousPeriodAvgCostUsd, periodLabel } =
		data;

	if (shippedCount === 0) {
		// Empty silence — spec calls this out as the no-shipped state.
		return <p className="text-sm text-muted-foreground">No cards shipped this period.</p>;
	}

	// All shipped, but none have attributed AI cost. Honest partial state
	// rather than a misleading "$0 avg".
	if (totalCostUsd === 0) {
		return (
			<div className="space-y-1">
				<p className="text-sm">
					<span className="font-mono tabular-nums">{shippedCount}</span>{" "}
					{shippedCount === 1 ? "card" : "cards"} shipped ·{" "}
					<span className="text-muted-foreground">No AI cost recorded.</span>
				</p>
				<p className="text-2xs text-muted-foreground">
					Token events are attributed via attributeSession or Stop hook with cardId.
				</p>
			</div>
		);
	}

	// Delta arrow only when a previous-period comparison is available AND the
	// averages actually moved — the service returns null for Lifetime (no prior
	// window) or for windows where the prior period had no priced cards. A flat
	// delta hides the arrow rather than rendering an amber "from $X" that reads
	// as a false alarm.
	const showDelta =
		periodLabel !== "lifetime" &&
		previousPeriodAvgCostUsd !== null &&
		avgCostUsd !== previousPeriodAvgCostUsd;
	const isLower = showDelta && avgCostUsd < (previousPeriodAvgCostUsd ?? 0);

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
				<span>
					<span className="font-mono text-2xl tabular-nums">{shippedCount}</span>{" "}
					<span className="text-muted-foreground">
						{shippedCount === 1 ? "card shipped" : "cards shipped"}
					</span>
				</span>
				<span className="text-muted-foreground">·</span>
				<span>
					<span className="font-mono text-2xl tabular-nums">{formatCost(avgCostUsd)}</span>{" "}
					<span className="text-muted-foreground">avg</span>
				</span>
				{showDelta ? (
					<span
						className={cn(
							"inline-flex items-center gap-1 text-xs",
							isLower ? "text-success" : "text-warning"
						)}
					>
						{isLower ? (
							<TrendingDown className="h-3.5 w-3.5" aria-hidden />
						) : (
							<TrendingUp className="h-3.5 w-3.5" aria-hidden />
						)}
						<span>from {formatCost(previousPeriodAvgCostUsd ?? 0)} last period</span>
					</span>
				) : null}
			</div>

			{top5.length > 0 ? (
				<ul className="space-y-2">
					{top5.map((entry) => (
						<li
							key={entry.cardId}
							className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-3 text-sm"
						>
							<span className="font-mono text-2xs text-muted-foreground">#{entry.cardNumber}</span>
							<span className="truncate" title={entry.cardTitle}>
								{entry.cardTitle}
							</span>
							<span className="text-2xs text-muted-foreground tabular-nums">
								{formatRelativeCompact(entry.completedAt)}
							</span>
							<span className="font-mono tabular-nums">{formatCost(entry.totalCostUsd)}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function LoadingState() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-7 w-64" />
			<div className="space-y-2">
				{Array.from({ length: 3 }).map((_, i) => (
					<Skeleton key={i} className="h-5 w-full" />
				))}
			</div>
		</div>
	);
}

// Amber error tile — same visual language as the DiagnosticRow `tone="amber"`
// pattern used in the token-tracking setup dialog. Local to this surface so
// we don't pull setup-dialog internals into the costs page.
function ErrorRow({ message }: { message: string }) {
	return (
		<div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2">
			<p className="text-2xs font-medium text-warning">
				Couldn't load delivery metrics — {message}
			</p>
		</div>
	);
}
