"use client";

/**
 * Card Delivery section (#275 — revived from #236).
 *
 * Headline metric: median cost to ship a card on this project. Companion
 * table: top-N most expensive cards by aggregated cost.
 *
 * Distinct from #211's `<TopSessionsSection>` (which lists individual
 * sessions): this lens aggregates per CARD across all attributed
 * sessions. Different unit, different question.
 *
 * Hidden when no card has any attributed cost. The "Pigeon overhead"
 * section above already surfaces tool-call cost; this one is about
 * model-output spend per card.
 */

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCost } from "@/lib/format-cost";
import type { RouterOutputs } from "@/trpc/react";

type Metrics = RouterOutputs["tokenUsage"]["getCardDeliveryMetrics"];

type CardDeliverySectionProps = {
	metrics: Metrics;
	projectId: string;
	boardId?: string;
};

// Build the `?projectId=…&format=…&boardId=…` query string consumed by
// `/api/export/costs`. Centralized here so the dropdown's two items stay
// in sync — no ad-hoc string concat at each click site.
function exportHref(projectId: string, format: "csv" | "md", boardId?: string): string {
	const params = new URLSearchParams({ projectId, format });
	if (boardId) params.set("boardId", boardId);
	return `/api/export/costs?${params.toString()}`;
}

export function CardDeliverySection({ metrics, projectId, boardId }: CardDeliverySectionProps) {
	if (metrics.topCards.length === 0) return null;

	return (
		<section className="space-y-3">
			<header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<div>
					<h2 className="text-sm font-medium">Card delivery</h2>
					<p className="text-2xs text-muted-foreground">
						Per-card spend across attributed sessions. Direct attribution only (post-#269).
					</p>
				</div>
				<div className="flex items-baseline gap-3">
					{metrics.medianShippedCardCostUsd !== null ? (
						<div className="text-right">
							<div className="font-mono text-2xl tabular-nums">
								{formatCost(metrics.medianShippedCardCostUsd)}
							</div>
							<div className="text-2xs text-muted-foreground">
								median across {metrics.shippedCardCount}{" "}
								{metrics.shippedCardCount === 1 ? "shipped card" : "shipped cards"}
							</div>
						</div>
					) : (
						<div className="text-right text-2xs text-muted-foreground">
							No shipped cards yet — median will populate once a Done-column card has attributed
							cost.
						</div>
					)}
					{/* #136 — download menu. Plain `<a download>` per spec; the
					    Route Handler emits `Content-Disposition: attachment` so
					    the browser handles the save dialog without a client
					    fetch. `boardId` mirrors the Costs page scope (export
					    follows what's on screen). */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="sm">
								Export
								<ChevronDown className="ml-1 h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem asChild>
								<a href={exportHref(projectId, "csv", boardId)} download>
									Download CSV
								</a>
							</DropdownMenuItem>
							<DropdownMenuItem asChild>
								<a href={exportHref(projectId, "md", boardId)} download>
									Download Markdown
								</a>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

			<div className="overflow-hidden rounded-md border">
				<table className="w-full text-sm">
					<thead className="bg-muted/40">
						<tr className="text-2xs uppercase tracking-wide text-muted-foreground">
							<th className="px-3 py-2 text-left font-medium">Card</th>
							<th className="px-3 py-2 text-left font-medium">Status</th>
							<th className="px-3 py-2 text-right font-medium">Sessions</th>
							<th className="px-3 py-2 text-right font-medium">Cost</th>
						</tr>
					</thead>
					<tbody>
						{metrics.topCards.map((c) => (
							<tr key={c.cardId} className="border-t">
								<td className="px-3 py-2 text-xs">
									<a
										href={`/projects/${projectId}/cards/${c.cardId}`}
										className="text-primary underline-offset-2 hover:underline"
										title={c.cardTitle}
									>
										{c.cardRef}
									</a>{" "}
									<span className="text-muted-foreground">{truncate(c.cardTitle, 60)}</span>
								</td>
								<td className="px-3 py-2 text-xs">
									{c.isShipped ? (
										<span className="rounded bg-success/10 px-1.5 py-0.5 text-success">
											Shipped
										</span>
									) : (
										<span className="text-muted-foreground">In flight</span>
									)}
								</td>
								<td className="px-3 py-2 text-right font-mono tabular-nums text-xs text-muted-foreground">
									{c.sessionCount}
								</td>
								<td className="px-3 py-2 text-right font-mono tabular-nums">
									{formatCost(c.totalCostUsd)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
