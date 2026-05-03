import { StepLabel, StepSection } from "@/components/ui/step-section";

export const metadata = { title: "Step Section" };

/**
 * Patterns / Step Section — the "01 — title" rhythm used by the Costs
 * page, the token-tracking setup dialog, and the pricing-override table.
 *
 * Pattern reference: editorial numbered procedures (Stripe Atlas / GH
 * Primer "step list"). Three independent copies had grown by the time
 * #238 unified them — one in Costs, one in the Token-tracking dialog,
 * one in pricing-override-table. The unified primitive lives in
 * `src/components/ui/step-section.tsx` plus the matching `<StepLabel>`
 * for the rare surface that wants the label rhythm without the full
 * Section frame.
 *
 * Two opt-in modifiers:
 *
 * - `flush` collapses the top border + padding when the section is the
 *   first child of its container — matches the dialog/sheet pattern
 *   where the first section sits flush with a header divider.
 * - `tone="anchor"` adds a violet top accent + faint bg tint, originally
 *   used by the savings statement on the Costs page (now removed; tone
 *   preserved against future revival per #238).
 */
export default function StepSectionPage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Pattern
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Step Section</h1>
				<p className="max-w-2xl text-muted-foreground">
					Numbered editorial section header — `01 — Title` rhythm. Used by the Costs page, the
					token-tracking setup dialog, and the pricing-override table. Unified into one primitive in
					#238.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Default — page rhythm</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					The Costs-page pattern: a stack of numbered sections, each separated by a top border.
					Mirrors a numbered procedure — `01` / `02` / `03` reads as a sequence even when the
					sections are independent.
				</p>
				<div className="rounded-lg border bg-card px-6 py-2">
					<StepSection step="01" title="Pulse">
						<p className="text-sm text-muted-foreground">
							Today's run-rate, week trend, and unattributed gap.
						</p>
					</StepSection>
					<StepSection step="02" title="Card delivery">
						<p className="text-sm text-muted-foreground">
							Median cost per shipped card and the top 5 most expensive cards.
						</p>
					</StepSection>
					<StepSection step="03" title="Top sessions">
						<p className="text-sm text-muted-foreground">
							The 10 highest-cost sessions with their attributed card and primary model.
						</p>
					</StepSection>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Solo — no step number</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Drop the <code className="rounded bg-muted px-1 font-mono text-xs">step</code> when the
					section stands alone. A lone{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">01</code> reads as orphaned
					editorial when there are no siblings to count against — the pricing-override-table is the
					canonical solo case (#238 dropped its{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">step="01"</code> for this
					reason).
				</p>
				<div className="rounded-lg border bg-card px-6 py-2">
					<StepSection title="Pricing overrides">
						<p className="text-sm text-muted-foreground">
							Per-model rule overrides — applies to all sessions in this project.
						</p>
					</StepSection>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">
					<code className="font-mono text-base">flush</code> — first child collapses
				</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Pass <code className="rounded bg-muted px-1 font-mono text-xs">flush</code> when the first
					section sits directly under a header divider (dialog / sheet pattern). The{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">first:</code> Tailwind variants
					only fire on the first child — safe to set on every section in a stack.
				</p>
				<div className="rounded-lg border bg-card">
					<div className="border-b px-6 py-3">
						<div className="text-sm font-medium">Setup token tracking</div>
						<div className="text-xs text-muted-foreground">2-step install</div>
					</div>
					<div className="px-6 py-2">
						<StepSection step="01" title="The hook" flush>
							<p className="text-sm text-muted-foreground">
								Drop a Stop hook into your Claude Code settings.
							</p>
						</StepSection>
						<StepSection step="02" title="Where it goes" flush>
							<p className="text-sm text-muted-foreground">
								Pass the project's tracker URL as the hook's only argument.
							</p>
						</StepSection>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">
					<code className="font-mono text-base">tone="anchor"</code>
				</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Adds a violet top accent + faint bg tint — used to register a section as the page's anchor
					signal. Lifts to the{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">--accent-violet</code> token
					(#280) so dark mode flips for free. Reach for it sparingly; the default tone is almost
					always right.
				</p>
				<div className="rounded-lg border bg-card px-6 py-2">
					<StepSection step="01" title="Savings vs naive bootstrap" tone="anchor">
						<p className="text-sm text-muted-foreground">
							briefMe vs `getBoard` cost ratio, persisted on the project's token baseline.
						</p>
					</StepSection>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">
					<code className="font-mono text-base">right</code> — title-row action
				</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Pass a node to <code className="rounded bg-muted px-1 font-mono text-xs">right</code> to
					slot a button / filter / link into the title row, baseline-aligned with the heading.
				</p>
				<div className="rounded-lg border bg-card px-6 py-2">
					<StepSection
						step="01"
						title="Top sessions"
						right={
							<button
								type="button"
								className="text-2xs text-muted-foreground underline-offset-2 hover:underline"
							>
								Recalibrate
							</button>
						}
					>
						<p className="text-sm text-muted-foreground">
							The 10 highest-cost sessions with their attributed card.
						</p>
					</StepSection>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">
					<code className="font-mono text-base">&lt;StepLabel&gt;</code> alone
				</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					For the rare surface that wants the label rhythm without the full Section frame — inline
					`01 / 02 / 03` markers in a list, for instance.
				</p>
				<div className="rounded-lg border bg-card p-6">
					<ol className="flex flex-col gap-3 text-sm">
						<li className="flex items-baseline gap-3">
							<StepLabel n="01" />
							<span>Open the kanban board.</span>
						</li>
						<li className="flex items-baseline gap-3">
							<StepLabel n="02" />
							<span>Drop the card you want to plan in In Progress.</span>
						</li>
						<li className="flex items-baseline gap-3">
							<StepLabel n="03" />
							<span>Run `/plan-card` and confirm the four-section plan.</span>
						</li>
					</ol>
				</div>
			</section>
		</div>
	);
}
