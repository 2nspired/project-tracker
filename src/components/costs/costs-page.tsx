"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { TokenTrackingSetupDialog } from "@/components/board/token-tracking-setup-dialog";
import { CardDeliverySection } from "@/components/costs/card-delivery-section";
import { PigeonOverheadSection } from "@/components/costs/pigeon-overhead-section";
import { PricingOverrideTable } from "@/components/costs/pricing-override-table";
import { SavingsSection } from "@/components/costs/savings-section";
import { SummaryStrip } from "@/components/costs/summary-strip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/trpc/react";

type CostsPageProps = {
	projectId: string;
	projectName: string;
};

// Client component owning the data fetches for the Costs page. Splits the
// shell out of the server component so the queries can stream in (and
// later — when the pricing override table lands in Step 5 — co-locate
// with mutations on the same page). 60s `staleTime` matches the BoardPulse
// strip; this data is rolled-up cost/session counters that don't need to
// repaint on every focus.
export function CostsPage({ projectId, projectName }: CostsPageProps) {
	const { data: projectSummary, isLoading: summaryLoading } =
		api.tokenUsage.getProjectSummary.useQuery({ projectId }, { staleTime: 60_000 });
	const { data: dailyCost, isLoading: dailyLoading } = api.tokenUsage.getDailyCostSeries.useQuery(
		{ projectId },
		{ staleTime: 60_000 }
	);

	const isLoading = summaryLoading || dailyLoading;
	const hasNoData =
		projectSummary &&
		dailyCost &&
		projectSummary.totalCostUsd === 0 &&
		projectSummary.eventCount === 0;

	return (
		<div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
			<div>
				<Link href={`/projects/${projectId}`}>
					<Button variant="ghost" size="sm" className="mb-2">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to project
					</Button>
				</Link>
				<h1 className="text-2xl font-bold tracking-tight">Costs</h1>
				<p className="text-sm text-muted-foreground">Token usage and spend for {projectName}.</p>
			</div>

			{isLoading ? (
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<div key={i} className="space-y-2">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-8 w-24" />
						</div>
					))}
				</div>
			) : hasNoData ? (
				<EmptyState
					title="No token events recorded yet"
					description="Wire up the Claude Code Stop hook to start recording token usage for this project."
					className="py-16"
				>
					<TokenTrackingSetupDialog
						trigger={
							<Button variant="outline" size="sm">
								Set up token tracking
							</Button>
						}
					/>
				</EmptyState>
			) : projectSummary && dailyCost ? (
				<>
					<SummaryStrip projectSummary={projectSummary} dailyCost={dailyCost} />
					<SavingsSection projectId={projectId} />
					<PigeonOverheadSection projectId={projectId} />
					<CardDeliverySection projectId={projectId} />
					{/* Pricing override table mounts after the analytics lenses —
					    pricing is configuration, not a metric. U3's
					    `<SavingsSection>` is concurrently being inserted; the
					    integration pass resolves the order. */}
					<PricingOverrideTable projectId={projectId} projectSummary={projectSummary} />
				</>
			) : null}
		</div>
	);
}
