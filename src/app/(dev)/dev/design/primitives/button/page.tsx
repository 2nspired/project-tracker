import { ArrowRight, Plus, Settings2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Button" };

const VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
const SIZES = ["default", "xs", "sm", "lg"] as const;
const ICON_SIZES = ["icon", "icon-xs", "icon-sm", "icon-lg"] as const;

/**
 * Primitives / Button — every variant + size the app uses.
 *
 * Pattern reference: shadcn's button docs lay out variants × sizes as a
 * matrix and document the exact intent of each combination. We mirror
 * that, then surface the "actually used" call out — the app reaches for
 * `ghost` (13 callsites) and `outline` (11) far more than `default` (1).
 * That's the right shape: the canonical surface is action-quiet
 * (toolbars, table-rows, inline edits), so the heavy `default` button
 * is reserved for the page-level primary action.
 */
export default function ButtonShowcasePage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Primitive
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Button</h1>
				<p className="max-w-2xl text-muted-foreground">
					Six variants × five sizes, plus four icon-only sizes. The app reaches for{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">ghost</code> and{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">outline</code> in toolbars and
					table rows; <code className="rounded bg-muted px-1 font-mono text-xs">default</code> is
					reserved for the page-level primary action.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Variants</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					{VARIANTS.map((v) => (
						<Button key={v} variant={v}>
							{v}
						</Button>
					))}
				</div>
				<dl className="grid gap-3 sm:grid-cols-2">
					<Rule
						term="default"
						desc="Page-level primary action. Reserve for the one most-important verb on the surface (Save changes, Create card, Continue)."
					/>
					<Rule
						term="destructive"
						desc="Irreversible action. Always paired with a confirmation step — the button alone isn't a guard."
					/>
					<Rule
						term="outline"
						desc="Secondary action that lives next to a default — Cancel next to Save, dismiss next to confirm. The most common Pigeon button (toolbars, modal footers)."
					/>
					<Rule
						term="secondary"
						desc="Quiet primary inside dense UI — picks up `bg-secondary` so it doesn't compete with the surrounding chrome."
					/>
					<Rule
						term="ghost"
						desc="Toolbar / row-action button. Hover-only chrome. Used by every kanban-card hover affordance and every table-row inline edit."
					/>
					<Rule
						term="link"
						desc="Inline navigation — looks like text, hits like a button. Use sparingly; almost always a real `<Link>` is cleaner."
					/>
				</dl>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Sizes</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					{SIZES.map((s) => (
						<Button key={s} variant="outline" size={s}>
							{s}
						</Button>
					))}
				</div>
				<dl className="grid gap-3 sm:grid-cols-2">
					<Rule
						term="default (h-9)"
						desc="Page-level buttons. Sheet / dialog footers. Anywhere the button is the headline action."
					/>
					<Rule
						term="sm (h-8)"
						desc="The most-common size (22 callsites). Toolbars, table rows, segmented-control siblings."
					/>
					<Rule
						term="xs (h-6)"
						desc="Inline data-row affordances. Pair with `text-2xs` siblings."
					/>
					<Rule
						term="lg (h-10)"
						desc="Hero CTAs only. Marketing surfaces / `/dev/design` landing tiles. Almost never inside the app."
					/>
				</dl>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Icon-only</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					{ICON_SIZES.map((s) => (
						<Button key={s} variant="ghost" size={s} aria-label={s}>
							<Settings2 />
						</Button>
					))}
				</div>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Always pass <code className="rounded bg-muted px-1 font-mono text-xs">aria-label</code> or{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">title</code> on icon-only
					buttons — the icon isn't read by screen readers. The icon size auto-scales with the button
					(xs ⇒ 12px, default ⇒ 16px) via the cva variants.
				</p>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">With icon + label</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					<Button>
						<Plus /> Create card
					</Button>
					<Button variant="outline" size="sm">
						<Settings2 /> Settings
					</Button>
					<Button variant="ghost" size="sm">
						Continue <ArrowRight />
					</Button>
					<Button variant="destructive" size="sm">
						<Trash2 /> Delete
					</Button>
				</div>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Icon-before-label = "this is the affordance"; icon-after-label = "this opens / advances."
					Match the rest of the page rather than mixing inside one toolbar.
				</p>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">States</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					<Button>Default</Button>
					<Button disabled>Disabled</Button>
					<Button variant="outline">Outline</Button>
					<Button variant="outline" disabled>
						Outline disabled
					</Button>
					<Button variant="destructive" aria-invalid>
						Invalid
					</Button>
				</div>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Hover, focus-visible, and disabled states are baked into the cva. Pass{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">aria-invalid</code> to surface a
					form-validation failure on the button itself.
				</p>
			</section>
		</div>
	);
}

function Rule({ term, desc }: { term: string; desc: string }) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<dt>
				<code className="font-mono text-2xs text-muted-foreground">{term}</code>
			</dt>
			<dd className="mt-1 text-sm">{desc}</dd>
		</div>
	);
}
