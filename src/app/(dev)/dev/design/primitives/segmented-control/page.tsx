"use client";

import { Columns3, LayoutGrid, List, Maximize2, Minimize2, Target } from "lucide-react";
import { useState } from "react";

import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";

export default function SegmentedControlShowcasePage() {
	const [view, setView] = useState<"kanban" | "list">("kanban");
	const [notesView, setNotesView] = useState<"card" | "list">("card");
	const [period, setPeriod] = useState<"7d" | "30d" | "lifetime">("30d");
	const [density, setDensity] = useState<"expanded" | "focus" | "compact">("focus");
	const [actor, setActor] = useState<"all" | "agent" | "human">("all");

	return (
		<div className="flex flex-col gap-10">
			<div className="flex flex-col gap-3">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Primitive
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Segmented Control</h1>
				<p className="max-w-2xl text-muted-foreground">
					Single-density (h-8) toggle group for &quot;pick one of N equivalent options&quot;. Wraps
					Radix <code className="rounded bg-muted px-1 text-xs">ToggleGroup</code> for built-in
					keyboard nav and ARIA. Replaces six ad-hoc implementations audited under design C3 + C14
					(#242).
				</p>
			</div>

			<Variant
				title="Icon view toggle"
				description="Two icon-only modes — board view kanban / list. Shape: rounded-md (single-select among equals)."
				code={`<SegmentedControl type="single" size="icon" value={view} onValueChange={...}>
  <SegmentedControlItem value="kanban"><Columns3 /></SegmentedControlItem>
  <SegmentedControlItem value="list"><List /></SegmentedControlItem>
</SegmentedControl>`}
			>
				<SegmentedControl
					type="single"
					size="icon"
					value={view}
					onValueChange={(v) => v && setView(v as "kanban" | "list")}
					aria-label="Board layout"
				>
					<SegmentedControlItem value="kanban" aria-label="Board view">
						<Columns3 />
					</SegmentedControlItem>
					<SegmentedControlItem value="list" aria-label="List view">
						<List />
					</SegmentedControlItem>
				</SegmentedControl>
			</Variant>

			<Variant
				title="Period selector (text)"
				description="Three exclusive periods. Default size + shape, picks up the surrounding type via className override."
				code={`<SegmentedControl type="single" value={period} onValueChange={...}>
  <SegmentedControlItem value="7d">7d</SegmentedControlItem>
  <SegmentedControlItem value="30d">30d</SegmentedControlItem>
  <SegmentedControlItem value="lifetime">Lifetime</SegmentedControlItem>
</SegmentedControl>`}
			>
				<SegmentedControl
					type="single"
					value={period}
					onValueChange={(v) => v && setPeriod(v as "7d" | "30d" | "lifetime")}
					aria-label="Period"
					className="font-mono text-2xs uppercase tracking-wide"
				>
					<SegmentedControlItem value="7d">7d</SegmentedControlItem>
					<SegmentedControlItem value="30d">30d</SegmentedControlItem>
					<SegmentedControlItem value="lifetime">Lifetime</SegmentedControlItem>
				</SegmentedControl>
			</Variant>

			<Variant
				title="Density toggle (icons, three options)"
				description="Same connected pill, three icons. Used by the roadmap header."
				code={`<SegmentedControl type="single" size="icon" value={density} onValueChange={...}>
  <SegmentedControlItem value="expanded"><Maximize2 /></SegmentedControlItem>
  <SegmentedControlItem value="focus"><Target /></SegmentedControlItem>
  <SegmentedControlItem value="compact"><Minimize2 /></SegmentedControlItem>
</SegmentedControl>`}
			>
				<SegmentedControl
					type="single"
					size="icon"
					value={density}
					onValueChange={(v) => v && setDensity(v as "expanded" | "focus" | "compact")}
					aria-label="Density"
				>
					<SegmentedControlItem value="expanded" title="Expanded">
						<Maximize2 />
					</SegmentedControlItem>
					<SegmentedControlItem value="focus" title="Focus">
						<Target />
					</SegmentedControlItem>
					<SegmentedControlItem value="compact" title="Compact">
						<Minimize2 />
					</SegmentedControlItem>
				</SegmentedControl>
			</Variant>

			<Variant
				title="Filter chip"
				description={
					"Shape: rounded-full. No outer border, each item is its own capsule — use when the surrounding data tags are round (e.g. activity / handoff filters)."
				}
				code={`<SegmentedControl type="single" shape="full" value={actor} onValueChange={...}>
  <SegmentedControlItem value="all">All</SegmentedControlItem>
  <SegmentedControlItem value="agent">Agents</SegmentedControlItem>
  <SegmentedControlItem value="human">You</SegmentedControlItem>
</SegmentedControl>`}
			>
				<SegmentedControl
					type="single"
					shape="full"
					value={actor}
					onValueChange={(v) => v && setActor(v as "all" | "agent" | "human")}
					aria-label="Filter activity by actor"
				>
					<SegmentedControlItem value="all">All</SegmentedControlItem>
					<SegmentedControlItem value="agent">Agents</SegmentedControlItem>
					<SegmentedControlItem value="human">You</SegmentedControlItem>
				</SegmentedControl>
			</Variant>

			<Variant
				title="Notes view toggle (icon, alt set)"
				description="Same icon-size shape with a different icon pair — confirms density/shape consistency across product surfaces."
				code={`<SegmentedControl type="single" size="icon" value={notesView} onValueChange={...}>
  <SegmentedControlItem value="card"><LayoutGrid /></SegmentedControlItem>
  <SegmentedControlItem value="list"><List /></SegmentedControlItem>
</SegmentedControl>`}
			>
				<SegmentedControl
					type="single"
					size="icon"
					value={notesView}
					onValueChange={(v) => v && setNotesView(v as "card" | "list")}
					aria-label="Notes layout"
				>
					<SegmentedControlItem value="card" aria-label="Card view">
						<LayoutGrid />
					</SegmentedControlItem>
					<SegmentedControlItem value="list" aria-label="List view">
						<List />
					</SegmentedControlItem>
				</SegmentedControl>
			</Variant>
		</div>
	);
}

function Variant({
	title,
	description,
	code,
	children,
}: {
	title: string;
	description: string;
	code: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-3">
			<header className="space-y-1">
				<h2 className="text-sm font-medium tracking-tight">{title}</h2>
				<p className="max-w-2xl text-xs text-muted-foreground">{description}</p>
			</header>
			<div className="rounded-lg border bg-card px-6 py-8">{children}</div>
			<pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-2xs leading-relaxed text-muted-foreground">
				<code>{code}</code>
			</pre>
		</section>
	);
}
