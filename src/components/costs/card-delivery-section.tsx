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

import { formatCost } from "@/lib/format-cost";
import type { RouterOutputs } from "@/trpc/react";

type Metrics = RouterOutputs["tokenUsage"]["getCardDeliveryMetrics"];

type CardDeliverySectionProps = {
	metrics: Metrics;
	projectId: string;
};

export function CardDeliverySection({ metrics, projectId }: CardDeliverySectionProps) {
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
						No shipped cards yet — median will populate once a Done-column card has attributed cost.
					</div>
				)}
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
