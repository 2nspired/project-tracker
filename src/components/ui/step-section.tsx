"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared step-numbered Section primitive used across the app — Costs page,
// Token-tracking setup dialog, and any other surface that wants the
// "01 — Section title" editorial rhythm.
//
// Promoted to a UI primitive in #238 from `src/components/costs/section.tsx`,
// which itself was extracted from three then-living Costs sub-components in
// #200 Phase 3. Three independent copies had grown by the time #238 ran
// (Costs page, Token-tracking dialog, pricing-override-table); this is the
// unified one. Behavior is identical to the previous canonical Costs version
// plus two opt-in modifiers:
//
// - `flush` collapses the top border + padding when the section is the first
//   child of its container (matches the dialog's "first section sits flush
//   with the header divider" behavior). Implemented via `first:` so it's
//   safe to apply uniformly to every section in a stack — only the first
//   one actually loses its border.
// - `tone="anchor"` adds a violet top accent + faint bg tint, originally
//   used by `<SavingsStatement>` to register as the page's anchor signal.
//   The savings lens was removed in #236; the tone option is preserved
//   against future revival and costs nothing to keep.

export type StepSectionTone = "default" | "anchor";

export function StepSection({
	step,
	title,
	right,
	tone = "default",
	flush = false,
	children,
}: {
	/** Optional step number (e.g. "01"). Omit when the section stands alone —
	 * a lone "01" reads as orphaned editorial when there are no siblings to
	 * count against. The Costs page's `<PricingOverrideTable>` is the
	 * canonical solo case (#238 dropped its `step="01"` for this reason). */
	step?: string;
	title: ReactNode;
	right?: ReactNode;
	tone?: StepSectionTone;
	/** When true, the section's top border + padding collapse on `:first-child`
	 * via `first:` Tailwind variants — matches the dialog/sheet pattern where
	 * the first section sits flush with a header divider. Safe to set on every
	 * section in a stack; the styling only fires on the first child. */
	flush?: boolean;
	children: ReactNode;
}) {
	const isAnchor = tone === "anchor";
	return (
		<section
			className={cn(
				"space-y-2.5 pt-4",
				isAnchor
					? "border-t-2 border-violet-500/40 bg-violet-500/[0.015] px-4 pb-4 sm:px-6"
					: "border-t border-border/50",
				flush && !isAnchor && "first:border-t-0 first:pt-0"
			)}
		>
			<div className="flex flex-wrap items-baseline gap-2.5">
				{step && <StepLabel n={step} />}
				<h3 className="text-sm font-medium tracking-tight">{title}</h3>
				{right && <div className="ml-auto">{right}</div>}
			</div>
			{children}
		</section>
	);
}

// Tiny step label used to anchor each section. `01 / 02 / 03` reads as a
// numbered procedure without competing with the section title for weight.
// Exported separately for the rare surface that wants the label rhythm
// without the full Section frame.
export function StepLabel({ n }: { n: string }) {
	return <span className="font-mono text-2xs text-muted-foreground/60 tabular-nums">{n}</span>;
}
