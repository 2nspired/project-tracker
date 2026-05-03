import { ArrowRight, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Card" };

/**
 * Primitives / Card — the shadcn `<Card>` family with header / content /
 * footer / action slots.
 *
 * Pattern reference: shadcn ships `<CardAction>` for the
 * "title-row right-side button" slot — a grid row that puts the action
 * across two rows so it visually anchors against the title baseline. The
 * Pigeon design landing tile is the canonical use; the dialog header is
 * another.
 *
 * Three card silhouettes ship at once and intentionally so. See the
 * Radius foundation page for the rationale; this page only documents
 * the shadcn `<Card>` (`rounded-xl`) — the kanban card and Costs section
 * are different primitives entirely.
 */
export default function CardShowcasePage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Primitive
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Card</h1>
				<p className="max-w-2xl text-muted-foreground">
					The shadcn <code className="rounded bg-muted px-1 font-mono text-xs">&lt;Card&gt;</code>{" "}
					family — <code className="rounded bg-muted px-1 font-mono text-xs">rounded-xl</code> tile
					with header / content / footer slots. This is the design-system tile silhouette; the
					kanban card and Costs section are separate primitives.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Anatomy</h2>
				<div className="grid gap-4 lg:grid-cols-2">
					<Card className="max-w-md">
						<CardHeader>
							<CardTitle>Card title</CardTitle>
							<CardDescription>
								The two-line description slot — `text-sm text-muted-foreground`, fixed.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-sm">
								Content lives here. Default body padding is{" "}
								<code className="rounded bg-muted px-1 font-mono text-xs">px-6</code>; the outer
								card brings <code className="rounded bg-muted px-1 font-mono text-xs">py-6</code>{" "}
								and <code className="rounded bg-muted px-1 font-mono text-xs">gap-6</code> between
								slots.
							</p>
						</CardContent>
						<CardFooter>
							<Button>Primary action</Button>
							<Button variant="ghost" className="ml-auto">
								Cancel
							</Button>
						</CardFooter>
					</Card>
					<div className="rounded-lg border bg-muted/20 p-4 text-sm">
						<div className="font-medium">Slots</div>
						<dl className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
							<div>
								<code className="font-mono">&lt;Card&gt;</code> — outer{" "}
								<code className="font-mono">rounded-xl border bg-card</code>, drives{" "}
								<code className="font-mono">gap-6</code> between slots.
							</div>
							<div>
								<code className="font-mono">&lt;CardHeader&gt;</code> — title + description grid;
								auto-fits a `&lt;CardAction&gt;` on the right.
							</div>
							<div>
								<code className="font-mono">&lt;CardTitle&gt;</code> —{" "}
								<code className="font-mono">leading-none font-semibold</code>. No fixed size; the
								consumer picks `text-2xl` for hero or leaves at default for inline.
							</div>
							<div>
								<code className="font-mono">&lt;CardDescription&gt;</code> —{" "}
								<code className="font-mono">text-sm text-muted-foreground</code>.
							</div>
							<div>
								<code className="font-mono">&lt;CardContent&gt;</code> — body{" "}
								<code className="font-mono">px-6</code>. No vertical padding; the outer card handles
								it.
							</div>
							<div>
								<code className="font-mono">&lt;CardFooter&gt;</code> —{" "}
								<code className="font-mono">flex items-center px-6</code>. Pair with{" "}
								<code className="font-mono">.border-t</code> on the card to get a divider above.
							</div>
							<div>
								<code className="font-mono">&lt;CardAction&gt;</code> — auto-anchors to the
								title-row top-right via grid placement.
							</div>
						</dl>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">With action</h2>
				<Card className="max-w-md">
					<CardHeader>
						<CardTitle>Tokens</CardTitle>
						<CardDescription>
							Edit how rich the brief feels by trimming the column count.
						</CardDescription>
						<CardAction>
							<Button variant="ghost" size="icon-sm" aria-label="Settings">
								<Settings2 />
							</Button>
						</CardAction>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">
							The action sits flush with the top-right of the title row. `&lt;CardAction&gt;` is
							positional — drop it inside `&lt;CardHeader&gt;` and the grid template handles it.
						</p>
					</CardContent>
				</Card>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">As clickable tile</h2>
				<a href="#card" className="group block max-w-md focus-visible:outline-none">
					<Card className="transition-colors group-hover:border-foreground/20 group-focus-visible:border-foreground/20 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50">
						<CardHeader>
							<div className="flex items-center justify-between">
								<CardTitle>Foundations</CardTitle>
								<ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
							</div>
							<CardDescription>5 of 6 pages live</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">
								The design landing tile — outer{" "}
								<code className="rounded bg-muted px-1 font-mono text-xs">&lt;a&gt;</code> wraps the
								card, hover/focus state binds to the wrapper.
							</p>
						</CardContent>
					</Card>
				</a>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Don't</h2>
				<ul className="flex flex-col gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
					<li>
						Don't reach for{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">&lt;Card&gt;</code> for kanban
						cards — those use their own{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">rounded-lg</code> BoardCard
						component (different radius, tighter padding, drag affordances).
					</li>
					<li>
						Don't reach for it for Costs sections — those use{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">
							rounded-md border bg-muted/20
						</code>{" "}
						(see Radius foundation).
					</li>
					<li>
						Don't pad{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">&lt;CardContent&gt;</code>{" "}
						vertically — the outer card already sets{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">py-6</code> and{" "}
						<code className="rounded bg-muted px-1 font-mono text-xs">gap-6</code>.
					</li>
				</ul>
			</section>
		</div>
	);
}
