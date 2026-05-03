export const metadata = { title: "Spacing" };

interface Step {
	cls: string;
	rem: string;
	px: number;
	intent: string;
}

/**
 * Four steps cover ~95% of the app's whitespace decisions. Larger gaps
 * (`gap-6`, `gap-8`, `gap-10`) exist on hero pages and section stacks but
 * aren't part of the data-density rhythm — they're composed per page.
 */
const STEPS: Step[] = [
	{ cls: "1", rem: "0.25rem", px: 4, intent: "Inline gap between an icon and its label." },
	{
		cls: "2",
		rem: "0.5rem",
		px: 8,
		intent: "Tag chips, inter-row gaps, button↔icon spacing inside a small button.",
	},
	{
		cls: "3",
		rem: "0.75rem",
		px: 12,
		intent: "Default table-cell horizontal padding (px-3) and the canonical card body inset.",
	},
	{
		cls: "4",
		rem: "1rem",
		px: 16,
		intent: "Section-to-section gap inside a card, sheet inset, and container-level padding.",
	},
];

/**
 * Foundations / Spacing — the scale and the table-cell density rule.
 *
 * Pattern reference: shadcn's tables and Linear's data lists both pin to
 * `px-3 py-2` (12px / 8px) for the canonical cell inset. Tighter than that
 * (`py-1`) becomes a "data ornament" surface — sparkline ticks, count
 * badges, age indicators. Looser (`py-3`) belongs to prose tables (cost
 * rules, doc tables) where the row is meant to read as a paragraph.
 *
 * The "stack / inline / inset" trichotomy is Stripe Atlas's framing — when
 * picking a gap, name what you're spacing, then pick the step.
 */
export default function SpacingPage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Foundations
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Spacing</h1>
				<p className="max-w-2xl text-muted-foreground">
					Four base steps drive ~95% of the spacing decisions in the app. Decide{" "}
					<em>stack vs inline vs inset</em> first, then pick the step. Larger gaps (
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">gap-6</code> /{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">gap-10</code>) exist for
					hero pages and live outside the body ramp.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">The scale</h2>
				<div className="flex flex-col gap-3">
					{STEPS.map((s) => (
						<div
							key={s.cls}
							className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
						>
							<code className="w-12 shrink-0 font-mono text-2xs text-muted-foreground">
								{s.cls}
							</code>
							<code className="w-32 shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
								{s.rem} ({s.px}px)
							</code>
							<div
								aria-hidden
								className="h-3 shrink-0 rounded-sm bg-accent-violet/40"
								style={{ width: `${s.px * 4}px` }}
							/>
							<span className="text-sm text-muted-foreground">{s.intent}</span>
						</div>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Stack — vertical rhythm</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Use <code className="rounded bg-muted px-1 font-mono text-xs">gap-2</code> for tight
					lists, <code className="rounded bg-muted px-1 font-mono text-xs">gap-3</code> for
					card-internal sections,{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">gap-4</code> for the
					section-to-section rhythm.
				</p>
				<div className="grid gap-4 sm:grid-cols-3">
					<div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
						<code className="font-mono text-2xs text-muted-foreground">flex-col gap-2</code>
						<div className="h-3 rounded-sm bg-muted" />
						<div className="h-3 rounded-sm bg-muted" />
						<div className="h-3 rounded-sm bg-muted" />
					</div>
					<div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
						<code className="font-mono text-2xs text-muted-foreground">flex-col gap-3</code>
						<div className="h-3 rounded-sm bg-muted" />
						<div className="h-3 rounded-sm bg-muted" />
						<div className="h-3 rounded-sm bg-muted" />
					</div>
					<div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
						<code className="font-mono text-2xs text-muted-foreground">flex-col gap-4</code>
						<div className="h-3 rounded-sm bg-muted" />
						<div className="h-3 rounded-sm bg-muted" />
						<div className="h-3 rounded-sm bg-muted" />
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Inline — horizontal rhythm</h2>
				<div className="grid gap-4 sm:grid-cols-3">
					<div className="flex items-center gap-1 rounded-lg border bg-card p-4">
						<code className="font-mono text-2xs text-muted-foreground">gap-1</code>
						<div className="ml-2 h-3 w-3 rounded-sm bg-muted" />
						<div className="h-3 w-3 rounded-sm bg-muted" />
						<div className="h-3 w-3 rounded-sm bg-muted" />
					</div>
					<div className="flex items-center gap-2 rounded-lg border bg-card p-4">
						<code className="font-mono text-2xs text-muted-foreground">gap-2</code>
						<div className="ml-2 h-3 w-3 rounded-sm bg-muted" />
						<div className="h-3 w-3 rounded-sm bg-muted" />
						<div className="h-3 w-3 rounded-sm bg-muted" />
					</div>
					<div className="flex items-center gap-3 rounded-lg border bg-card p-4">
						<code className="font-mono text-2xs text-muted-foreground">gap-3</code>
						<div className="ml-2 h-3 w-3 rounded-sm bg-muted" />
						<div className="h-3 w-3 rounded-sm bg-muted" />
						<div className="h-3 w-3 rounded-sm bg-muted" />
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Inset — table-cell density</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					The canonical Pigeon data row uses{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">px-3 py-2</code>. Tighter than
					that becomes "data ornament" (chips, sparkline labels). Looser belongs to prose tables
					where each row is meant to read as a paragraph.
				</p>
				<div className="overflow-hidden rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead className="bg-muted/40">
							<tr className="text-left">
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Card
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Status
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Cost
								</th>
							</tr>
						</thead>
						<tbody>
							{[
								{ card: "#268 Attribution Engine", status: "Done", cost: "$1.42" },
								{ card: "#278 Motion tokens", status: "Done", cost: "$0.38" },
								{ card: "#279 Design showcase", status: "In Progress", cost: "$0.51" },
							].map((row) => (
								<tr key={row.card} className="border-t border-border/60">
									<td className="px-3 py-2">{row.card}</td>
									<td className="px-3 py-2 text-muted-foreground">{row.status}</td>
									<td className="px-3 py-2 font-mono text-2xs tabular-nums text-muted-foreground">
										{row.cost}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
