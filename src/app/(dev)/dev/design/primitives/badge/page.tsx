import { Bot, Check, Sparkles, Tag } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Badge" };

const VARIANTS = ["default", "secondary", "destructive", "outline", "ghost", "link"] as const;

/**
 * Primitives / Badge — every variant the app uses.
 *
 * Pattern reference: shadcn's badge ships six variants. The Pigeon
 * codebase reaches for `outline` (8 callsites) and `secondary` (7) — the
 * heavy `default` and `destructive` variants are reserved for status
 * pills that need to assert themselves visually (the rare "Stale" or
 * "Blocked" cases).
 *
 * Badges are pill-shaped (`rounded-full`) by default. The `rounded-md`
 * variant (used in the count chip) is a one-off in `priority-colors.ts`.
 */
export default function BadgeShowcasePage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Primitive
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Badge</h1>
				<p className="max-w-2xl text-muted-foreground">
					Pill-shaped chip for status, tags, and counts. Six variants — the app reaches for{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">outline</code> and{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">secondary</code> on data rows;
					assertive variants (
					<code className="rounded bg-muted px-1 font-mono text-xs">default</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">destructive</code>) are reserved
					for status that needs to fight for attention.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Variants</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					{VARIANTS.map((v) => (
						<Badge key={v} variant={v}>
							{v}
						</Badge>
					))}
				</div>
				<dl className="grid gap-3 sm:grid-cols-2">
					<Rule
						term="default"
						desc="Inverse-on-bg pill — the most assertive. Reserve for status that has to dominate (e.g. 'Live', 'Now')."
					/>
					<Rule
						term="secondary"
						desc="Quiet count chip — picks up `bg-secondary`. Used for tag chips on the board."
					/>
					<Rule
						term="destructive"
						desc="Failure / blocked / regression. Pair with copy that explains the failure on hover."
					/>
					<Rule
						term="outline"
						desc="The data-row default. `border-border text-foreground` — sits inside dense tables without competing."
					/>
					<Rule
						term="ghost"
						desc="Hoverable label — used when the badge is itself an `<a>` (asChild). Pure surface affordance."
					/>
					<Rule
						term="link"
						desc="Inline pill that looks like a link. Hardly used; almost always a real `<Link>` is cleaner."
					/>
				</dl>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">With icon</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					<Badge variant="outline">
						<Tag /> design-system
					</Badge>
					<Badge variant="secondary">
						<Sparkles /> AI score 4.2
					</Badge>
					<Badge>
						<Check /> Done
					</Badge>
					<Badge variant="outline">
						<Bot /> Agent
					</Badge>
				</div>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Icons inside a badge auto-size to{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">size-3</code> (12px) via the cva
					— don't pass an explicit size class.
				</p>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Real surfaces</h2>
				<div className="flex flex-col gap-4">
					<div className="rounded-lg border bg-card p-6">
						<div className="text-xs text-muted-foreground">Tag chips on a kanban card</div>
						<div className="mt-3 flex flex-wrap gap-1">
							<span className="rounded-full border border-border px-1.5 text-2xs leading-4 text-muted-foreground">
								design-system
							</span>
							<span className="rounded-full border border-border px-1.5 text-2xs leading-4 text-muted-foreground">
								v6.3
							</span>
							<span className="rounded-full border border-border px-1.5 text-2xs leading-4 text-muted-foreground">
								docs
							</span>
						</div>
						<p className="mt-3 text-xs text-muted-foreground">
							Note: the kanban tag-chip is a hand-rolled span (`text-2xs leading-4`) — tighter than
							`&lt;Badge&gt;` so it fits the dense card density. Documented here so it doesn't drift
							back into the primitive.
						</p>
					</div>
					<div className="rounded-lg border bg-card p-6">
						<div className="text-xs text-muted-foreground">Status pill in a row</div>
						<div className="mt-3 flex items-center gap-3 text-sm">
							<span>#268 Attribution Engine</span>
							<Badge variant="outline">Done</Badge>
						</div>
					</div>
					<div className="rounded-lg border bg-card p-6">
						<div className="text-xs text-muted-foreground">Count chip</div>
						<div className="mt-3 flex items-center gap-2 text-sm">
							<span>In Progress</span>
							<Badge variant="secondary">3</Badge>
						</div>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">As link</h2>
				<div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6">
					<Badge asChild variant="outline">
						<a href="#badge">#design-system</a>
					</Badge>
					<Badge asChild variant="ghost">
						<a href="#badge">Hoverable label</a>
					</Badge>
				</div>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Pass <code className="rounded bg-muted px-1 font-mono text-xs">asChild</code> to wrap an{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">&lt;a&gt;</code> /{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">&lt;Link&gt;</code>. The cva
					adds the right{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">[a&amp;]:hover</code> classes
					automatically.
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
