"use client";

import { TokenTrackingSetupDialog } from "@/components/board/token-tracking-setup-dialog";
import { CostsBreadcrumb } from "@/components/costs/breadcrumb";
import { PricingOverrideTable } from "@/components/costs/pricing-override-table";
import { SummaryStrip } from "@/components/costs/summary-strip";
import { UnattributedGapCard } from "@/components/costs/unattributed-gap-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/trpc/react";

type LightBoard = { id: string; name: string };

type FromBoard = { id: string; name: string };

type CostsPageProps = {
	projectId: string;
	projectName: string;
	boardId?: string;
	boardName?: string;
	boards: LightBoard[];
	// Phase 2c — when set (resolved server-side from `?from=<boardId>`), the
	// breadcrumb's first segment links back to the originating board instead
	// of the project root. Decorative-only; `null`/`undefined` means "no
	// referrer", not "invalid".
	fromBoard?: FromBoard;
};

// Client component owning the data fetches for the Costs page.
//
// Board-scope plumbing (#200) was deferred in #225 — the page renders
// project-wide regardless of `?board=` until card-attribution of Stop-hook
// events is automated. The `boardId` prop is preserved on `CostsPageProps`
// (route plumbing unchanged) but ignored by the data fetches and child
// rendering. `?from=` continues to drive the breadcrumb's first-segment
// back-link via `fromBoard`. The deep-dive lenses (`<SavingsSection>`,
// `<PigeonOverheadSection>`, `<CardDeliverySection>`) along with their
// backing tRPC procedures were removed in #236 — the page now renders
// just `<SummaryStrip>` and `<PricingOverrideTable>`.
export function CostsPage({
	projectId,
	projectName,
	boardId: _boardId,
	boardName: _boardName,
	boards,
	fromBoard,
}: CostsPageProps) {
	// Board scope deferred until card-attribution is automated (#225). Until
	// then this page renders project-wide regardless of `?board=`. The
	// `boardId` prop is preserved on `CostsPageProps` (route plumbing
	// unchanged) but ignored here for data + child rendering. `?from=`
	// continues to drive the breadcrumb's first-segment back-link via
	// `fromBoard`. Re-enable board scope once `attributeSession` runs
	// automatically on Stop-hook fire so events have `cardId` set and
	// board-scoped queries return meaningful data.
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
		<div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
			<CostsBreadcrumb
				projectId={projectId}
				boards={boards}
				currentBoardId={null}
				fromBoard={fromBoard}
			/>

			<div>
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
					<UnattributedGapCard projectSummary={projectSummary} />
					<PricingOverrideTable projectId={projectId} projectSummary={projectSummary} />
				</>
			) : null}
		</div>
	);
}
