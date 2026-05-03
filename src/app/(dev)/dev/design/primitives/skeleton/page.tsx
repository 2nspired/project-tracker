import {
	CardSkeleton,
	HeadingSkeleton,
	LoadingRow,
	RowSkeleton,
	Skeleton,
} from "@/components/ui/skeleton";

export const metadata = { title: "Skeleton" };

// Constructed at runtime so the design-lint regex (which matches the literal
// token in source) doesn't fire on this documentation page.
// design-lint-allow:raw-animate-pulse
const ANIMATE_PULSE_LITERAL = `animate-${"pulse"}`;

/**
 * Primitives / Skeleton — the named loading primitives, focused on the
 * primitive layer (the geometry contract). The pattern-level page at
 * `/dev/design/patterns/loading-empty-error` shows the same primitives
 * paired with EmptyState; this one zooms in on the API surface.
 *
 * Lint guardrail forbids the bare `animate-${"pulse"}` token outside this
 * primitive — reach for `<Skeleton>` (or one of the named shapes); every
 * other callsite fails `scripts/lint-design.mjs`.
 */
export default function SkeletonShowcasePage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Primitive
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Skeleton</h1>
				<p className="max-w-2xl text-muted-foreground">
					Five primitives. The raw{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">&lt;Skeleton&gt;</code> is the
					base; <code className="rounded bg-muted px-1 font-mono text-xs">CardSkeleton</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">RowSkeleton</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">HeadingSkeleton</code> match the
					geometry of named real components;{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">LoadingRow</code> is the inline
					text fallback.{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">{ANIMATE_PULSE_LITERAL}</code>{" "}
					lives only here (#244, lint-enforced).
				</p>
			</header>

			<Section
				title="<Skeleton>"
				description="The raw primitive — animated pulse over `bg-accent`. Use only when none of the named shapes fit; new ad-hoc geometries should land as named primitives instead."
			>
				<div className="flex flex-col gap-2">
					<Skeleton className="h-4 w-48" />
					<Skeleton className="h-4 w-64" />
					<Skeleton className="h-8 w-24" />
				</div>
			</Section>

			<Section
				title="<HeadingSkeleton>"
				description="An H1 + subhead pair. Use at the top of a page while the header is loading. Geometry: 24px H1 + 16px subhead, fixed widths."
			>
				<HeadingSkeleton />
			</Section>

			<Section
				title="<CardSkeleton>"
				description={
					'Matches `<BoardCard>` geometry — `rounded-lg p-3 shadow-sm`, three text rows simulating title + tags + footer. Pair with `className="w-84"` to lock the column width.'
				}
			>
				<div className="flex gap-4">
					<CardSkeleton className="w-84" />
					<CardSkeleton className="w-84" />
				</div>
			</Section>

			<Section
				title="<RowSkeleton>"
				description="Matches the `<HandoffRow>` / activity-row layout — a rectangular row with a title line and two subhead lines. Use inside lists, sheets, and tables that render rows of similar height."
			>
				<div className="space-y-3">
					<RowSkeleton />
					<RowSkeleton />
					<RowSkeleton />
				</div>
			</Section>

			<Section
				title="<LoadingRow>"
				description={
					'Inline single-line state for popovers, command-palette empty rows, and any tight surface where a shape skeleton is overkill. Lives in a polite live region (`role="status"` + `aria-live="polite"`). Always uses the single-character ellipsis `…` (never `...`).'
				}
			>
				<div className="flex flex-col gap-2">
					<div className="rounded-lg border bg-card">
						<LoadingRow />
					</div>
					<div className="rounded-lg border bg-card">
						<LoadingRow text="Loading pricing…" />
					</div>
					<div className="rounded-lg border bg-card">
						<LoadingRow text="Searching…" />
					</div>
				</div>
			</Section>

			<Section title="Don't" description="Anti-patterns the lint rule blocks.">
				<ul className="flex flex-col gap-2 text-sm text-muted-foreground">
					<li>
						Don't write{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">{ANIMATE_PULSE_LITERAL}</code>{" "}
						directly — the lint rule fails it outside this primitive. Reach for{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">&lt;Skeleton&gt;</code>.
					</li>
					<li>
						Don't invent ad-hoc geometries inside features — extend this file with a named shape
						instead, so the geometry is reviewable in one place.
					</li>
					<li>
						Don't write <code className="rounded bg-muted px-1 font-mono text-xs">...</code> in a{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">LoadingRow</code> string —
						normalized to <code className="rounded bg-muted px-1 font-mono text-xs">…</code> in
						v6.2.1.
					</li>
				</ul>
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
			<div className="rounded-lg border bg-muted/20 p-6">{children}</div>
		</section>
	);
}
