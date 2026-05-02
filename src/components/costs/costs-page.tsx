"use client";

import { TokenTrackingSetupDialog } from "@/components/board/token-tracking-setup-dialog";
import { CostsBreadcrumb } from "@/components/costs/breadcrumb";
import { CardDeliverySection } from "@/components/costs/card-delivery-section";
import { PigeonOverheadSection } from "@/components/costs/pigeon-overhead-section";
import { PricingOverrideTable } from "@/components/costs/pricing-override-table";
import { SavingsSection } from "@/components/costs/savings-section";
import { SummaryStrip } from "@/components/costs/summary-strip";
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
// Board-scope plumbing (#200 Phase 2a + 3): when `boardId` is set, the two
// scope-aware queries (`getProjectSummary`, `getDailyCostSeries`) pass it
// through so the summary strip + sparkline reflect that board only. The
// other sections (`<SavingsSection>`, `<PigeonOverheadSection>`,
// `<CardDeliverySection>`, `<PricingOverrideTable>`) deliberately keep
// project-only signatures — they're not yet board-aware (Phase 1b
// territory). To stay honest with the user we render a `(project-wide)`
// Badge in their headers via the `scope` prop (Phase 3 D7).
//
// In board mode we also fetch the project-wide summary IN ADDITION to the
// board-scoped one. We need both for the SummaryStrip's Board's-share cell
// (Phase 3, C3 — `(boardTotal / projectTotal) * 100` with a >0 guard) and
// also for the empty-state branch in <SavingsSection>'s Statement (Phase 3
// N2 — "no board-attributed sessions yet" link out to project totals).
//
// Cache key safety (A3): React Query passes the input object straight to
// `JSON.stringify` for hashing. `JSON.stringify({ projectId, boardId:
// undefined })` strips the `undefined`, so the project-only call key
// equals `JSON.stringify({ projectId })`. The ternary on the input object
// is therefore not required for correctness — but we keep it explicit so
// the call sites read as "we ask different questions in different modes."
export function CostsPage({
	projectId,
	projectName,
	boardId,
	boardName: _boardName,
	boards,
	fromBoard,
}: CostsPageProps) {
	const { data: projectSummary, isLoading: summaryLoading } =
		api.tokenUsage.getProjectSummary.useQuery(boardId ? { projectId, boardId } : { projectId }, {
			staleTime: 60_000,
		});
	const { data: dailyCost, isLoading: dailyLoading } = api.tokenUsage.getDailyCostSeries.useQuery(
		boardId ? { projectId, boardId } : { projectId },
		{ staleTime: 60_000 }
	);
	// In board mode, also fetch the project-wide totals — the Board's-share
	// cell + the Statement's empty-state branch both need `projectTotal`.
	// `enabled: !!boardId` keeps project mode from double-fetching.
	const { data: projectWideSummary } = api.tokenUsage.getProjectSummary.useQuery(
		{ projectId },
		{ staleTime: 60_000, enabled: !!boardId }
	);

	// In board mode wait for projectWideSummary too — otherwise hasNoData
	// briefly evaluates against board-scoped zeros before the project-wide
	// query lands, flickering the "Set up tracking" CTA on top of pages that
	// actually have data.
	const isLoading = summaryLoading || dailyLoading || (!!boardId && !projectWideSummary);

	// The page-level "no data" empty state advertises hook setup, so it only
	// fires when the *project as a whole* has no token data. In board mode
	// with a populated project but zero board-attributed events, render the
	// regular sections — each has its own board-mode empty-state branch
	// ("no board-attributed sessions yet") that links out to project totals.
	// Telling the user to "Set up token tracking" when events are already
	// flowing is misleading and contradicts the dialog's own status pill.
	const projectHasAnyData = boardId
		? !!projectWideSummary &&
			(projectWideSummary.eventCount > 0 || projectWideSummary.totalCostUsd > 0)
		: !!projectSummary && (projectSummary.eventCount > 0 || projectSummary.totalCostUsd > 0);

	const hasNoData = !!projectSummary && !!dailyCost && !projectHasAnyData;

	return (
		<div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
			<CostsBreadcrumb
				projectId={projectId}
				boards={boards}
				currentBoardId={boardId ?? null}
				fromBoard={fromBoard}
			/>

			<div>
				{/* H1 stays "Costs" (D2). Pigeon has no left nav so the resource
				    label is load-bearing — promoting the scope into the H1 would
				    bury it. Scope reads from the breadcrumb above instead. */}
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
					<SummaryStrip
						projectSummary={projectSummary}
						dailyCost={dailyCost}
						boardId={boardId}
						projectWideSummary={boardId ? projectWideSummary : undefined}
					/>
					{boardId ? (
						<p className="font-mono text-2xs italic text-muted-foreground/60">
							A session that touched cards on multiple boards counts toward each board's total.
						</p>
					) : null}
					<SavingsSection
						projectId={projectId}
						boardId={boardId}
						boardSummary={boardId ? projectSummary : undefined}
						projectWideSummary={boardId ? projectWideSummary : undefined}
					/>
					<PigeonOverheadSection projectId={projectId} scope={boardId ? "board" : "project"} />
					<CardDeliverySection projectId={projectId} scope={boardId ? "board" : "project"} />
					{/* Pricing override table is a project-level configuration
					    surface — hide in board mode (D-spec step 7). It comes back
					    when the user clears the scope to "All boards". */}
					{!boardId ? (
						<PricingOverrideTable projectId={projectId} projectSummary={projectSummary} />
					) : null}
				</>
			) : null}
		</div>
	);
}
