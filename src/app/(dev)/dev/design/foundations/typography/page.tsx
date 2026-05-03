export const metadata = { title: "Typography" };

interface RampRow {
	/** Tailwind utility (the canonical reference). */
	cls: string;
	/** Resolved size (rem / px). */
	size: string;
	/** Resolved line-height. */
	leading: string;
	/** When this size is the right call. */
	intent: string;
	/** Where in the app it shows up today. */
	usedFor: string;
}

/**
 * Six steps. The bottom (`text-2xs`) is the Pigeon extension registered in
 * `globals.css` at `0.6875rem / 0.875rem`; the rest are stock Tailwind. The
 * page header itself uses `text-3xl` — left out of the table because hero
 * type is composed by hand, not picked from the ramp.
 */
const RAMP: RampRow[] = [
	{
		cls: "text-2xs",
		size: "0.6875rem (11px)",
		leading: "0.875rem (14px)",
		intent: "Data ornaments — card numbers, monospace counters, sparkline labels.",
		usedFor: "Card #N badges, age indicators, tag chips, sparkline tick labels.",
	},
	{
		cls: "text-xs",
		size: "0.75rem (12px)",
		leading: "1rem (16px)",
		intent: "Secondary metadata that still has to read at a glance.",
		usedFor: "Card byline, eyebrow labels (Foundations / Primitive), `<EmptyState>` description.",
	},
	{
		cls: "text-sm",
		size: "0.875rem (14px)",
		leading: "1.25rem (20px)",
		intent: "Default body. Section titles, list rows, form copy.",
		usedFor: "BoardCard title, dialog body, table cells, button text.",
	},
	{
		cls: "text-base",
		size: "1rem (16px)",
		leading: "1.5rem (24px)",
		intent: "Long-form prose paragraphs. Reach for it when tightness hurts the read.",
		usedFor: "Documentation pages, card description on the detail sheet.",
	},
	{
		cls: "text-lg",
		size: "1.125rem (18px)",
		leading: "1.75rem (28px)",
		intent: "Section H2 — break up a page without competing with the H1.",
		usedFor: "`/dev/design/*` section headings, settings panel headings.",
	},
	{
		cls: "text-2xl",
		size: "1.5rem (24px)",
		leading: "2rem (32px)",
		intent: "Page H1 inside a card / sheet (where the surrounding chrome already frames it).",
		usedFor: "`<CardTitle>` on the design landing, dialog titles.",
	},
];

/**
 * Foundations / Typography — the live type ramp.
 *
 * Pattern reference: GitHub Primer's `primer.style/foundations/typography`
 * publishes the ramp as a table (utility → resolved size → leading → intent),
 * which is the cleanest way to hand a designer the rule without forcing them
 * to reverse-engineer it from rendered samples. We mirror that, then pair
 * every row with a live render of the same string at the same size so a
 * reviewer can see the rhythm play out.
 *
 * Pigeon's only extension to stock Tailwind is `text-2xs` (registered in
 * `globals.css` under `@theme inline`). Everything else is Tailwind v4 stock,
 * documented here so the rest of the app has a single place to look up "what
 * does `text-sm` actually render at."
 */
export default function TypographyPage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Foundations
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Typography</h1>
				<p className="max-w-2xl text-muted-foreground">
					Six steps from{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">text-2xs</code> to{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">text-2xl</code>. Every
					utility resolves through Tailwind tokens — only{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">text-2xs</code> is a
					Pigeon extension (registered in{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">globals.css</code>). Pick
					a row by the <em>intent</em>, not the pixel value.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">The ramp</h2>
				<div className="overflow-hidden rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead className="bg-muted/40">
							<tr className="text-left">
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Utility
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Size
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Leading
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Sample
								</th>
							</tr>
						</thead>
						<tbody>
							{RAMP.map((row) => (
								<tr key={row.cls} className="border-t border-border/60 align-top">
									<td className="px-3 py-3 font-mono text-2xs text-muted-foreground">{row.cls}</td>
									<td className="px-3 py-3 font-mono text-2xs text-muted-foreground tabular-nums">
										{row.size}
									</td>
									<td className="px-3 py-3 font-mono text-2xs text-muted-foreground tabular-nums">
										{row.leading}
									</td>
									<td className={`${row.cls} px-3 py-3`}>The quick brown fox jumps over.</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Intent + canonical use</h2>
				<div className="flex flex-col gap-4">
					{RAMP.map((row) => (
						<div key={row.cls} className="rounded-lg border bg-card p-4">
							<div className="flex flex-wrap items-baseline justify-between gap-3">
								<code className="font-mono text-2xs text-muted-foreground">{row.cls}</code>
								<code className="font-mono text-2xs text-muted-foreground tabular-nums">
									{row.size} / {row.leading}
								</code>
							</div>
							<p className={`${row.cls} mt-2`}>{row.intent}</p>
							<p className="mt-2 text-xs text-muted-foreground">
								<span className="font-medium text-foreground/80">Used for:</span> {row.usedFor}
							</p>
						</div>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Hero type</h2>
				<div className="rounded-lg border bg-card p-6">
					<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Eyebrow / text-xs uppercase
					</p>
					<h1 className="text-4xl font-semibold tracking-tight">
						The destination for every UI fix.
					</h1>
					<p className="mt-2 max-w-xl text-muted-foreground">
						Page-hero pairs (eyebrow / H1 / lead) are composed by hand — not picked from the ramp.{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">text-3xl</code> and{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">text-4xl</code> exist
						for this; they're not part of the body ramp.
					</p>
				</div>
			</section>
		</div>
	);
}
