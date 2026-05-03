"use client";

import { BookOpen } from "lucide-react";

import { TokenTrackingSetupDialog } from "@/components/board/token-tracking-setup-dialog";
import { CostsBreadcrumb } from "@/components/costs/breadcrumb";
import { CardDeliverySection } from "@/components/costs/card-delivery-section";
import { PigeonOverheadSection } from "@/components/costs/pigeon-overhead-section";
import { PricingOverrideTable } from "@/components/costs/pricing-override-table";
import { SavingsSection } from "@/components/costs/savings-section";
import { SummaryStrip } from "@/components/costs/summary-strip";
import { TopSessionsSection } from "@/components/costs/top-sessions-section";
import { UnattributedGapCard } from "@/components/costs/unattributed-gap-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { costsExplainerUrl } from "@/lib/doc-url";
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
// Board scope (#200) was deferred in #225 pending automatic card
// attribution. With #268/#269 shipping the Attribution Engine, that
// gating reason is satisfied — board scope is re-enabled in #212.
// `?board=<id>` narrows queries to that board (session-expansion rule
// applies, so `boardA + boardB > project` is *expected* — see
// `resolveBoardScopeWhere`'s doc). `?from=<boardId>` continues to drive
// only the breadcrumb back-link.
export function CostsPage({
	projectId,
	projectName,
	boardId,
	boardName: _boardName,
	boards,
	fromBoard,
}: CostsPageProps) {
	const { data: projectSummary, isLoading: summaryLoading } =
		api.tokenUsage.getProjectSummary.useQuery({ projectId, boardId }, { staleTime: 60_000 });
	const { data: dailyCost, isLoading: dailyLoading } = api.tokenUsage.getDailyCostSeries.useQuery(
		{ projectId, boardId },
		{ staleTime: 60_000 }
	);
	// Project-wide summary is needed in board mode for the share denominator
	// (#212). When `boardId` is undefined we skip the second query — `enabled`
	// gates the fetch and `projectSummary` itself becomes the project-wide
	// number that `<SummaryStrip>` reads.
	const { data: projectWideSummary } = api.tokenUsage.getProjectSummary.useQuery(
		{ projectId },
		{ staleTime: 60_000, enabled: !!boardId }
	);
	// 7-day share sparkline (#212) — only fetched in board mode. Drives the
	// inline sparkline next to the Board's-share percentage cell.
	const { data: dailyShare } = api.tokenUsage.getDailyCostShareSeries.useQuery(
		// biome-ignore lint/style/noNonNullAssertion: gated by `enabled`
		{ projectId, boardId: boardId! },
		{ staleTime: 60_000, enabled: !!boardId }
	);
	// Top-N expensive sessions lens (#211).
	const { data: topSessions } = api.tokenUsage.getTopSessions.useQuery(
		{ projectId, limit: 10 },
		{ staleTime: 60_000 }
	);
	// Project-wide Pigeon overhead (#274 — revived from #236).
	const { data: pigeonOverhead } = api.tokenUsage.getProjectPigeonOverhead.useQuery(
		{ projectId, boardId },
		{ staleTime: 60_000 }
	);
	// Pigeon savings — briefMe vs naive bootstrap (#273 — revived from #236).
	// Read from `Project.metadata.tokenBaseline`; recomputed on demand by
	// the section's own "Recalibrate" button.
	const { data: savingsSummary } = api.tokenUsage.getSavingsSummary.useQuery(
		{ projectId },
		{ staleTime: 60_000 }
	);
	// Card Delivery metrics (#275 — revived from #236) — top-N expensive
	// cards + median cost-per-shipped-card.
	const { data: cardDelivery } = api.tokenUsage.getCardDeliveryMetrics.useQuery(
		{ projectId, boardId, limit: 5 },
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
				currentBoardId={boardId ?? null}
				fromBoard={fromBoard}
			/>

			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Costs</h1>
					<p className="text-sm text-muted-foreground">
						Token usage and spend for {projectName}
						{boardId ? ` · scoped to ${boards.find((b) => b.id === boardId)?.name ?? "board"}` : ""}
						.
					</p>
				</div>
				{/* #276 — Resources link. Deep-links to the cost-tracking
				    explainer in docs-site. Each section below also carries a
				    `?` icon that targets the matching anchor on the same page
				    (see `<SectionHelpLink>`). External link by design — the
				    docs-site is a separate Astro build. */}
				<Button asChild variant="ghost" size="sm" className="text-muted-foreground">
					<a
						href={costsExplainerUrl()}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="How is this calculated? Open the cost-tracking explainer in docs."
					>
						<BookOpen className="size-3.5" aria-hidden />
						How is this calculated?
					</a>
				</Button>
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
					<SummaryStrip
						projectSummary={projectSummary}
						dailyCost={dailyCost}
						boardId={boardId}
						projectWideSummary={projectWideSummary}
						dailyShare={dailyShare?.dailyShare}
					/>
					<UnattributedGapCard projectSummary={projectSummary} />
					{savingsSummary !== undefined ? (
						<SavingsSection projectId={projectId} summary={savingsSummary} />
					) : null}
					{pigeonOverhead ? <PigeonOverheadSection overhead={pigeonOverhead} /> : null}
					{cardDelivery ? (
						<CardDeliverySection metrics={cardDelivery} projectId={projectId} boardId={boardId} />
					) : null}
					{topSessions ? (
						<TopSessionsSection topSessions={topSessions} projectId={projectId} />
					) : null}
					<PricingOverrideTable projectId={projectId} projectSummary={projectSummary} />
				</>
			) : null}
		</div>
	);
}
