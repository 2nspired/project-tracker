"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PRIORITY_DOT, STATUS_DOT } from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import type { MilestoneGroup, RoadmapCard } from "./roadmap-view";

function DotNode({ card, isDone }: { card: RoadmapCard; isDone: boolean }) {
	const color = card.isBlocked && !isDone
		? STATUS_DOT.blocked
		: isDone
			? STATUS_DOT.done
			: (PRIORITY_DOT[card.priority as Priority] ?? PRIORITY_DOT.NONE);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className={`h-2.5 w-2.5 shrink-0 rounded-full ${color} ${card.isBlocked && !isDone ? "ring-2 ring-red-500/30" : "ring-2 ring-background"} transition-transform hover:scale-150`}
				/>
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-48">
				<p className="text-xs font-medium">
					<span className="font-mono text-muted-foreground">#{card.number}</span>{" "}
					{card.title}
				</p>
				<p className="text-2xs text-muted-foreground">
					{card.isBlocked && !isDone ? "Blocked · " : ""}{card.columnName} {card.priority !== "NONE" ? `/ ${card.priority}` : ""}
				</p>
			</TooltipContent>
		</Tooltip>
	);
}

type RiverFlowProps = {
	milestones: MilestoneGroup[];
	columnOrder: string[];
	allCards: RoadmapCard[];
};

export function RiverFlow({ milestones, columnOrder, allCards }: RiverFlowProps) {
	if (allCards.length === 0) return null;

	return (
		<TooltipProvider delayDuration={200}>
		<div className="rounded-lg border bg-card p-4">
			<h2 className="mb-4 text-sm font-semibold text-muted-foreground">
				Flow
			</h2>

			{/* Column headers */}
			<div className="mb-1 flex items-center">
				<div className="w-28 shrink-0" />
				<div className="flex flex-1 items-center">
					{columnOrder.map((col, i) => (
						<div key={col} className="flex-1 text-center">
							<span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70">
								{col}
							</span>
						</div>
					))}
				</div>
				<div className="w-16 shrink-0" />
			</div>

			{/* Milestone rivers */}
			<div className="space-y-3">
				{milestones.map((milestone) => (
					<MilestoneRiver
						key={milestone.id ?? "__ungrouped__"}
						milestone={milestone}
						columnOrder={columnOrder}
					/>
				))}
			</div>
		</div>
		</TooltipProvider>
	);
}

function MilestoneRiver({
	milestone,
	columnOrder,
}: {
	milestone: MilestoneGroup;
	columnOrder: string[];
}) {
	// Group cards by column
	const cardsByColumn = new Map<string, RoadmapCard[]>();
	for (const col of columnOrder) {
		cardsByColumn.set(col, []);
	}
	// Cards in parking lot or unknown columns go to the first column bucket
	for (const card of milestone.cards) {
		const bucket = cardsByColumn.get(card.columnName);
		if (bucket) {
			bucket.push(card);
		} else {
			// Parking lot / unknown → treat as "later" visually, put in first column
			const first = columnOrder[0];
			if (first) cardsByColumn.get(first)?.push(card);
		}
	}

	const pct = milestone.total > 0 ? Math.round((milestone.done / milestone.total) * 100) : 0;

	return (
		<div className="flex items-center">
			{/* Milestone label */}
			<div className="w-28 shrink-0 pr-3">
				<p className="truncate text-xs font-medium">{milestone.name}</p>
				<p className="text-2xs text-muted-foreground">
					{milestone.done}/{milestone.total}
				</p>
			</div>

			{/* River track */}
			<div className="relative flex flex-1 items-center">
				{/* Background track line */}
				<div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />

				{/* Column segments with dots */}
				{columnOrder.map((col) => {
					const cards = cardsByColumn.get(col) ?? [];
					const isDone = col.toLowerCase() === "done";

					return (
						<div
							key={col}
							className="relative z-10 flex flex-1 items-center justify-center gap-1 py-1.5"
						>
							{cards.map((card) => (
								<DotNode
									key={card.id}
									card={card}
									isDone={isDone}
								/>
							))}
						</div>
					);
				})}
			</div>

			{/* Progress */}
			<div className="flex w-16 shrink-0 items-center justify-end gap-1.5 pl-3">
				<div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-emerald-500 transition-all duration-500"
						style={{ width: `${pct}%` }}
					/>
				</div>
				<span className="text-2xs tabular-nums text-muted-foreground">
					{pct}%
				</span>
			</div>
		</div>
	);
}
