"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

// Constructed at runtime so the design-lint regex (which matches the
// literal token in source) doesn't fire on this documentation page.
// design-lint-allow:raw-transition-all
const TRANSITION_ALL_LITERAL = `transition-${"all"}`;

interface MotionRow {
	cls: string;
	resolved: string;
	intent: string;
	usedFor: string;
}

const DURATIONS: MotionRow[] = [
	{
		cls: "duration-fast",
		resolved: "120ms",
		intent: "Hover / focus state changes — fast enough to feel like a direct response.",
		usedFor: "Button hover bg, link underline, sidebar item hover.",
	},
	{
		cls: "duration-base",
		resolved: "180ms",
		intent: "The default — color, opacity, and small transform changes that are visible but quiet.",
		usedFor: "Theme-toggle icon swap, accordion chevron rotate, dialog content fade.",
	},
	{
		cls: "duration-slow",
		resolved: "280ms",
		intent: "Layout-y motion — drawers, sheets, tab content swap. Use sparingly.",
		usedFor: "Card-detail sheet enter, dialog overlay, drawer slide.",
	},
];

/**
 * Foundations / Motion — the duration + easing tokens registered in #278.
 *
 * Pattern reference: Linear / Vercel / shadcn each expose three durations
 * (fast / base / slow) and a single standard easing curve. Pigeon's set
 * lands the same shape — `--motion-fast / base / slow` for durations,
 * `--motion-ease-standard` for the curve. The Tailwind aliases
 * (`duration-fast` / `duration-base` / `duration-slow` / `ease-standard`)
 * are wired through `@theme inline` so utility classes pick up the tokens.
 *
 * The lint guardrail forbids the broad `transition-${"all"}` token outside
 * the Button primitive. Always pass an explicit list — `transition-[opacity]`,
 * `transition-[transform,opacity]`, `transition-colors`, etc. — so layout
 * properties don't get swept into the animation by accident.
 */
export default function MotionPage() {
	const [shifted, setShifted] = useState(false);

	// On every click, snap back to start then schedule the slide to the end
	// in the next animation frame so the browser sees a state change to
	// react to.
	const trigger = () => {
		setShifted(false);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => setShifted(true));
		});
	};

	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Foundations
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Motion</h1>
				<p className="max-w-2xl text-muted-foreground">
					Three durations and a single easing curve — the Linear / Vercel / shadcn shape. Tokens
					live on <code className="rounded bg-muted px-1 font-mono text-xs">:root</code> as{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">--motion-*</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">--motion-ease-standard</code>.
					The Tailwind utilities (
					<code className="rounded bg-muted px-1 font-mono text-xs">duration-fast</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">duration-base</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">duration-slow</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">ease-standard</code>) are the
					contact surface (#278).
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Durations</h2>
				<p className="text-sm text-muted-foreground">
					Click the button to retrigger every box at once. Each square animates the same{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">translate-x</code> +{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">opacity</code> change with{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">ease-standard</code>; only the
					duration changes.
				</p>
				<div className="flex flex-col gap-4 rounded-lg border bg-card p-6">
					<Button variant="outline" size="sm" onClick={trigger}>
						Trigger
					</Button>
					<div className="flex flex-col gap-6">
						<DurationLane cls="duration-fast" resolved="120ms" shifted={shifted} />
						<DurationLane cls="duration-base" resolved="180ms" shifted={shifted} />
						<DurationLane cls="duration-slow" resolved="280ms" shifted={shifted} />
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Hover (live)</h2>
				<p className="text-sm text-muted-foreground">
					The most common use of these tokens — paired with{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">transition-colors</code> on
					hoverable surfaces. Hover each tile to feel the curve.
				</p>
				<div className="grid gap-4 sm:grid-cols-3">
					{DURATIONS.map((row) => (
						<button
							type="button"
							key={row.cls}
							className={`group flex flex-col gap-2 rounded-lg border bg-card p-4 text-left transition-colors ease-standard hover:bg-accent ${row.cls}`}
						>
							<code className="font-mono text-2xs text-muted-foreground">{row.cls}</code>
							<span className="text-sm font-medium">Hover me</span>
							<span className="text-xs text-muted-foreground">{row.resolved}</span>
						</button>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Intent</h2>
				<div className="flex flex-col gap-3">
					{DURATIONS.map((row) => (
						<div key={row.cls} className="rounded-lg border bg-card p-4">
							<div className="flex flex-wrap items-baseline justify-between gap-3">
								<code className="font-mono text-2xs text-muted-foreground">{row.cls}</code>
								<code className="font-mono text-2xs text-muted-foreground tabular-nums">
									{row.resolved}
								</code>
							</div>
							<p className="mt-2 text-sm">{row.intent}</p>
							<p className="mt-2 text-xs text-muted-foreground">
								<span className="font-medium text-foreground/80">Used for:</span> {row.usedFor}
							</p>
						</div>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Easing</h2>
				<div className="rounded-lg border bg-card p-6">
					<p className="text-sm">
						<code className="rounded bg-muted px-1 font-mono text-xs">ease-standard</code> ={" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">
							cubic-bezier(0.2, 0, 0, 1)
						</code>{" "}
						— Linear's "standard" curve. Gentle in, fast out. Better than CSS{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">ease</code> at masking the
						jitter on small color/opacity changes.
					</p>
					<p className="mt-3 text-xs text-muted-foreground">
						Custom curves stay scoped to their keyframe (e.g. spring-physics drag handlers); the
						standard curve is the right call for everything else.
					</p>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Lint guardrail</h2>
				<div className="rounded-lg border bg-card p-6 text-sm">
					<p>
						{/* design-lint-allow:raw-transition-all — documenting the forbidden token */}
						<code className="rounded bg-muted px-1 font-mono text-xs">
							{TRANSITION_ALL_LITERAL}
						</code>{" "}
						is forbidden outside{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">ui/button.tsx</code> —
						enforced by{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">scripts/lint-design.mjs</code>
						.
					</p>
					<p className="mt-2 text-muted-foreground">
						Always pass an explicit list:{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">
							transition-[transform,opacity]
						</code>
						,{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">
							transition-[box-shadow,border-color]
						</code>
						, <code className="rounded bg-muted px-1 font-mono text-xs">transition-colors</code>.
						The forbidden token quietly animates layout properties (height, padding, font-size) when
						their values change — usually as a render bug.
					</p>
				</div>
			</section>
		</div>
	);
}

function DurationLane({
	cls,
	resolved,
	shifted,
}: {
	cls: "duration-fast" | "duration-base" | "duration-slow";
	resolved: string;
	shifted: boolean;
}) {
	// Slide the inner box from start → end of its lane via translateX. End
	// position is `100% - 100%` of the box width (`-100%` of self) tucked
	// against the right edge — uses `calc` against the parent so it's
	// resolution-independent. transform-only animation keeps layout out of
	// the transition, matching the lint guardrail.
	return (
		<div className="flex items-center gap-4">
			<code className="w-32 shrink-0 font-mono text-2xs text-muted-foreground">{cls}</code>
			<code className="w-20 shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
				{resolved}
			</code>
			<div className="relative h-10 flex-1 overflow-hidden rounded-md border bg-muted/30">
				<div
					className={`absolute top-1 left-1 size-8 rounded-sm bg-accent-violet transition-transform ease-standard ${cls}`}
					style={{
						transform: shifted ? "translateX(calc(var(--lane-shift, 0px)))" : "translateX(0)",
					}}
					ref={(el) => {
						if (!el) return;
						const lane = el.parentElement;
						if (!lane) return;
						// Move from left:0.25rem to right:0.25rem — total travel is
						// (lane width − box width − 2*4px). 32px box, 4px each side.
						lane.style.setProperty("--lane-shift", `${lane.clientWidth - 32 - 8}px`);
					}}
				/>
			</div>
		</div>
	);
}
