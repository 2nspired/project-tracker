"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { MilestoneCard } from "./milestone-card";
import type { Horizon, MilestoneGroup } from "./roadmap-view";

type DensityMode = "expanded" | "compact" | "focus";

const HORIZON_CONFIG: Record<
	Horizon,
	{
		label: string;
		description: string;
		borderColor: string;
		bgClass: string;
		textClass: string;
	}
> = {
	now: {
		label: "Now",
		description: "Active & in review",
		borderColor: "border-l-info",
		bgClass: "bg-card",
		textClass: "text-info",
	},
	later: {
		label: "Later",
		description: "Backlog & ideas",
		borderColor: "border-l-muted",
		bgClass: "bg-muted/30",
		textClass: "text-muted-foreground",
	},
	done: {
		label: "Done",
		description: "Completed",
		borderColor: "border-l-success",
		bgClass: "bg-success/5",
		textClass: "text-success",
	},
};

export function HorizonBand({
	horizon,
	milestones,
	density,
	onCardClick,
}: {
	horizon: Horizon;
	milestones: MilestoneGroup[];
	density: DensityMode;
	onCardClick: (cardId: string) => void;
}) {
	const config = HORIZON_CONFIG[horizon];
	const totalCards = milestones.reduce((sum, m) => sum + m.total, 0);
	const totalDone = milestones.reduce((sum, m) => sum + m.done, 0);

	const { setNodeRef, isOver } = useDroppable({
		id: `horizon-${horizon}`,
		data: { type: "horizon", horizon },
	});

	const milestoneIds = milestones.map((m) => m.id ?? "__ungrouped__");

	// Done band is collapsible — show as a single line when compact
	if (horizon === "done" && milestones.length === 0) return null;

	return (
		<div
			ref={setNodeRef}
			className={`rounded-lg border-l-4 ${config.borderColor} ${config.bgClass} transition-colors ${
				isOver ? "ring-2 ring-primary/20" : ""
			}`}
		>
			{/* Band header */}
			<div className="flex items-center gap-3 px-4 py-3">
				<h2 className={`text-sm font-bold uppercase tracking-wider ${config.textClass}`}>
					{config.label}
				</h2>
				<span className="text-2xs text-muted-foreground">{config.description}</span>
				<div className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
					<span>
						{milestones.length} milestone{milestones.length !== 1 ? "s" : ""}
					</span>
					<span className="text-muted-foreground/40">·</span>
					<span>
						{totalDone}/{totalCards} cards done
					</span>
				</div>
			</div>

			{/* Milestone cards */}
			{milestones.length > 0 && (
				<SortableContext items={milestoneIds} strategy={verticalListSortingStrategy}>
					<div className="space-y-2 px-4 pb-4">
						{milestones.map((milestone) => (
							<MilestoneCard
								key={milestone.id ?? "__ungrouped__"}
								milestone={milestone}
								horizon={horizon}
								density={density}
								onCardClick={onCardClick}
							/>
						))}
					</div>
				</SortableContext>
			)}

			{/* Empty state */}
			{milestones.length === 0 && (
				<div className="px-4 pb-4">
					<div className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
						No milestones in {config.label.toLowerCase()}
					</div>
				</div>
			)}
		</div>
	);
}
