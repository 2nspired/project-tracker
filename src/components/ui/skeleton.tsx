import { cn } from "@/lib/utils";

/**
 * Loading-state primitives for Pigeon.
 *
 * Two patterns, lifted from Linear's docs and Stripe Atlas:
 *
 * 1. **Shape skeletons** — `<CardSkeleton>`, `<RowSkeleton>`, `<HeadingSkeleton>`
 *    match the geometry of the real content they stand in for, so the layout
 *    doesn't shift when data lands. Widths/heights are pinned to the rendered
 *    component (e.g. `<CardSkeleton>` matches `<BoardCard>`'s `w-84` column
 *    width — not the historical `w-72` mismatch). Use these whenever the
 *    surface owns its own layout box.
 *
 * 2. **`<LoadingRow>`** — a single text row with the live-region semantics for
 *    surfaces that legitimately can't show a shape skeleton (popovers, search
 *    results, transient inline states). Replaces the ad-hoc `Loading…` /
 *    `Searching...` strings that were scattered across the codebase before
 *    #244.
 *
 * Underneath, every primitive uses the same `<Skeleton>` div — that's the only
 * place the `animate-pulse` token is allowed to live (enforced by
 * `scripts/lint-design.mjs`). Per-call-site invented geometries (#244 audit)
 * are now rejected by review: pick a named primitive or extend this file.
 */

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn("bg-accent animate-pulse rounded-md", className)}
			{...props}
		/>
	);
}

/**
 * Board-card skeleton — matches `<BoardCard>` geometry (`w-84` column width,
 * `rounded-lg`, padded). Three text rows simulate title + tags + footer.
 *
 * Use inside `<BoardColumn>` placeholders or any list of cards.
 */
function CardSkeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-skeleton"
			className={cn("rounded-lg border bg-card p-3 shadow-sm", className)}
			{...props}
		>
			<div className="space-y-2">
				<div className="flex items-start justify-between gap-2">
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-3 w-8" />
				</div>
				<div className="flex gap-1">
					<Skeleton className="h-3 w-12 rounded-full" />
					<Skeleton className="h-3 w-10 rounded-full" />
				</div>
				<Skeleton className="h-3 w-1/2" />
			</div>
		</div>
	);
}

/**
 * List-row skeleton — matches the `<HandoffRow>` / activity-row /
 * pricing-row layout (rectangular row with a title line and a subhead line).
 *
 * Use inside lists, sheets, and tables that render rows of similar height.
 */
function RowSkeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="row-skeleton"
			className={cn("rounded-lg border bg-muted/20 p-3", className)}
			{...props}
		>
			<Skeleton className="h-3 w-32" />
			<Skeleton className="mt-2 h-3 w-full" />
			<Skeleton className="mt-1 h-3 w-3/4" />
		</div>
	);
}

/**
 * Heading skeleton — matches an H1 + subhead pair, the standard page-header
 * shape used at the top of `/projects/[id]`, dashboard, and the design-system
 * pages.
 */
function HeadingSkeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="heading-skeleton" className={cn("space-y-2", className)} {...props}>
			<Skeleton className="h-6 w-48" />
			<Skeleton className="h-4 w-64" />
		</div>
	);
}

/**
 * Inline loading row — single text line with the polite live-region semantics
 * (`role="status"` + `aria-live="polite"`) so screen readers announce the
 * transition. Renders as muted-foreground text, sized at `text-xs` to slot
 * into popover content, command-palette empty rows, and other tight surfaces
 * where a shape skeleton would be overkill.
 *
 * Always uses a single ellipsis `…` — never `...`.
 */
function LoadingRow({
	text = "Loading…",
	className,
	...props
}: { text?: string } & React.ComponentProps<"div">) {
	return (
		<div
			data-slot="loading-row"
			role="status"
			aria-live="polite"
			className={cn("px-4 py-6 text-center text-xs text-muted-foreground", className)}
			{...props}
		>
			{text}
		</div>
	);
}

export { CardSkeleton, HeadingSkeleton, LoadingRow, RowSkeleton, Skeleton };
