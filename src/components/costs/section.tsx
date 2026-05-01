"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared Section frame for the Costs page (#200 Phase 3 — extracted from
// `savings-section.tsx`, `pigeon-overhead-section.tsx`, and
// `card-delivery-section.tsx`, which previously each held a copy).
//
// Behavior is identical to the original (border-top hairline, step-numbered
// label, sm/medium title, optional right-slot for PeriodPills) with one
// addition: the `tone="anchor"` variant adds a violet top accent + faint bg
// tint. The Statement frame in <SavingsStatement> uses it to register as
// the page's anchor signal while keeping the page's editorial rhythm
// (D5/D6 — Statement supplements the step-numbered Section, doesn't
// replace it).
//
// "violet = cost" mirrors the BoardPulse sparkline; the tint is kept very
// subtle (`bg-violet-500/[0.015]`) so it reads as accent, not panel.

export type SectionTone = "default" | "anchor";

export function Section({
	step,
	title,
	right,
	tone = "default",
	children,
}: {
	step: string;
	title: ReactNode;
	right?: ReactNode;
	tone?: SectionTone;
	children: ReactNode;
}) {
	const isAnchor = tone === "anchor";
	return (
		<section
			className={cn(
				"space-y-2.5 pt-4",
				isAnchor
					? "border-t-2 border-violet-500/40 bg-violet-500/[0.015] px-4 pb-4 sm:px-6"
					: "border-t border-border/50"
			)}
		>
			<div className="flex flex-wrap items-baseline gap-2.5">
				<StepLabel n={step} />
				<h3 className="text-sm font-medium tracking-tight">{title}</h3>
				{right && <div className="ml-auto">{right}</div>}
			</div>
			{children}
		</section>
	);
}

export function StepLabel({ n }: { n: string }) {
	return <span className="font-mono text-2xs text-muted-foreground/60 tabular-nums">{n}</span>;
}

// ─── Period pill selector ─────────────────────────────────────────

export type Period = "7d" | "30d" | "lifetime";

export function PeriodPills({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
	return (
		<div className="inline-flex items-center gap-1">
			<PeriodPill active={value === "7d"} onClick={() => onChange("7d")}>
				7d
			</PeriodPill>
			<PeriodPill active={value === "30d"} onClick={() => onChange("30d")}>
				30d
			</PeriodPill>
			<PeriodPill active={value === "lifetime"} onClick={() => onChange("lifetime")}>
				Lifetime
			</PeriodPill>
		</div>
	);
}

function PeriodPill({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-2xs uppercase tracking-wide transition-colors",
				active
					? "border-foreground/20 bg-muted text-foreground"
					: "border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground"
			)}
		>
			{children}
		</button>
	);
}

// ─── Diagnostic row (muted amber strip) ───────────────────────────

export function DiagnosticRow({
	children,
	tone = "amber",
}: {
	children: ReactNode;
	tone?: "amber";
}) {
	const tonal =
		tone === "amber"
			? "border-l-amber-500 bg-amber-500/5 text-amber-700 dark:text-amber-400"
			: "border-l-muted-foreground/40 bg-muted/30 text-muted-foreground";
	return (
		<div className={cn("rounded border-l-2 px-3 py-1.5 font-mono text-2xs", tonal)}>{children}</div>
	);
}
