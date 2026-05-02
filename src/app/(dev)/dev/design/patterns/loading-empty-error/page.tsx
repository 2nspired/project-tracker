import { Inbox } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import {
	CardSkeleton,
	HeadingSkeleton,
	LoadingRow,
	RowSkeleton,
	Skeleton,
} from "@/components/ui/skeleton";

export const metadata = { title: "Loading, Empty, Error" };

/**
 * Patterns / Loading, Empty, Error.
 *
 * Showcases the named skeleton primitives Pigeon ships in
 * `src/components/ui/skeleton.tsx` (#244). Each block pairs the named
 * primitive with a one-line "use this when…" guide, paired against the real
 * component shape it stands in for so a reviewer can see at-a-glance whether
 * the geometry matches.
 *
 * Reference: Linear's loading state matches the actual layout shape — content
 * doesn't pop in at a different size when data lands. Skeleton geometry is
 * therefore co-defined with its real component (e.g. `<CardSkeleton>` is
 * `w-84` because `<BoardColumn>` is `w-84`, not the historical `w-72`
 * mismatch).
 */
export default function LoadingEmptyErrorPage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Patterns
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Loading, Empty, Error</h1>
				<p className="max-w-2xl text-muted-foreground">
					The named skeleton primitives plus the inline <code>LoadingRow</code> for surfaces that
					can't show shape skeletons. Each primitive matches the geometry of the real component it
					stands in for so the layout doesn't shift when data lands.
				</p>
			</header>

			<Section
				title="HeadingSkeleton"
				description="An H1 + subhead pair. Use at the top of a page while the page header is loading."
			>
				<HeadingSkeleton />
			</Section>

			<Section
				title="CardSkeleton"
				description="Matches BoardColumn's w-84 column width. Three text rows simulate title + tag chips + footer."
			>
				<div className="flex gap-4">
					<CardSkeleton className="w-84" />
					<CardSkeleton className="w-84" />
				</div>
			</Section>

			<Section
				title="RowSkeleton"
				description="Matches the HandoffRow / activity-row layout. Use inside lists, sheets, and tables."
			>
				<div className="space-y-3">
					<RowSkeleton />
					<RowSkeleton />
					<RowSkeleton />
				</div>
			</Section>

			<Section
				title="LoadingRow"
				description="Inline single-line state for popovers, command-palette empty rows, and any tight surface where a shape skeleton is overkill. Lives in a polite live region for a11y. Always uses the single-character ellipsis ‘…’."
			>
				<div className="rounded-lg border bg-card">
					<LoadingRow />
				</div>
				<div className="rounded-lg border bg-card">
					<LoadingRow text="Loading pricing…" />
				</div>
				<div className="rounded-lg border bg-card">
					<LoadingRow text="Searching…" />
				</div>
			</Section>

			<Section
				title="Skeleton (raw)"
				description="The underlying primitive. Reach for it only when none of the named shapes fit; new ad-hoc geometries should land as named primitives instead."
			>
				<div className="flex flex-col gap-2">
					<Skeleton className="h-4 w-48" />
					<Skeleton className="h-4 w-64" />
					<Skeleton className="h-8 w-24" />
				</div>
			</Section>

			<Section
				title="EmptyState"
				description="Pair shape skeletons with a real EmptyState when the query lands and returns nothing. Same surface, different content."
			>
				<div className="rounded-lg border bg-card">
					<EmptyState
						icon={Inbox}
						title="No handoffs yet."
						description="Handoffs are saved when an agent runs /handoff or calls saveHandoff."
					/>
				</div>
			</Section>
		</div>
	);
}

function Section({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-mono text-sm font-medium">{title}</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
			</div>
			<div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-6">{children}</div>
		</section>
	);
}
