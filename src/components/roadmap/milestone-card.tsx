"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Calendar, ChevronDown, GripVertical, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

import { formatDate } from "@/lib/format-date";
import { CardChip } from "./card-chip";
import { ProgressRing } from "./progress-ring";
import type { Horizon, MilestoneGroup, RoadmapCard } from "./roadmap-view";

type DensityMode = "expanded" | "compact" | "focus";

export function MilestoneCard({
	milestone,
	horizon,
	density,
	boardId,
	onCardClick,
}: {
	milestone: MilestoneGroup;
	horizon: Horizon;
	density: DensityMode;
	boardId: string;
	onCardClick: (cardId: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);

	// Sync expanded state when density mode changes
	useEffect(() => {
		setExpanded(density === "expanded" || (density === "focus" && horizon === "now"));
	}, [density, horizon]);

	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: milestone.id ?? "__ungrouped__",
		data: { type: "milestone", milestone, horizon },
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	const pct = milestone.total > 0 ? milestone.done / milestone.total : 0;
	const blockedCount = milestone.cards.filter((c) => c.isBlocked && c.horizon !== "done").length;

	// Target date risk: warn if < 7 days away and < 80% done
	const targetDate = milestone.targetDate ? new Date(milestone.targetDate) : null;
	const daysUntilTarget = targetDate
		? Math.ceil((targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
		: null;
	const isAtRisk = daysUntilTarget !== null && daysUntilTarget <= 7 && pct < 0.8;
	const isOverdue = daysUntilTarget !== null && daysUntilTarget < 0 && pct < 1;

	// Sort cards: now → later → done
	const horizonOrder: Record<string, number> = {
		now: 0,
		later: 1,
		done: 2,
	};
	const sortedCards = [...milestone.cards].sort(
		(a, b) => horizonOrder[a.horizon] - horizonOrder[b.horizon]
	);

	// Compact mode — just a chip
	if (density === "compact" || (density === "focus" && horizon === "later")) {
		return (
			<div
				ref={setNodeRef}
				style={style}
				className={`flex items-center gap-2 rounded-lg border bg-card/80 px-3 py-2 ${
					isDragging ? "opacity-50" : ""
				}`}
			>
				<div
					className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground"
					{...attributes}
					{...listeners}
				>
					<GripVertical className="h-3.5 w-3.5" />
				</div>
				<ProgressRing value={pct} size={22} strokeWidth={2.5} />
				<span className="text-xs font-medium">{milestone.name}</span>
				<span className="text-2xs text-muted-foreground">{milestone.total} cards</span>
				{blockedCount > 0 && <span className="text-2xs text-red-500">{blockedCount} blocked</span>}
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="ml-auto text-muted-foreground hover:text-foreground"
				>
					<ChevronDown
						className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
					/>
				</button>
			</div>
		);
	}

	// Full card view
	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`rounded-lg border bg-card transition-shadow hover:shadow-sm ${
				isDragging ? "opacity-50 shadow-lg" : ""
			} ${isOverdue ? "border-red-500/30" : isAtRisk ? "border-amber-400/30" : ""}`}
		>
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2.5">
				<div
					className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground"
					{...attributes}
					{...listeners}
				>
					<GripVertical className="h-3.5 w-3.5" />
				</div>

				<ProgressRing value={pct} size={28} strokeWidth={3} />

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-semibold">{milestone.name}</span>
						{isOverdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
						{isAtRisk && !isOverdue && (
							<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
						)}
					</div>
					<div className="flex items-center gap-3 text-2xs text-muted-foreground">
						{targetDate && (
							<span
								className={`flex items-center gap-1 ${
									isOverdue ? "text-red-500" : isAtRisk ? "text-amber-500" : ""
								}`}
							>
								<Calendar className="h-3 w-3" />
								{formatDate(targetDate)}
							</span>
						)}
						<span>
							{milestone.done}/{milestone.total} done
						</span>
						{blockedCount > 0 && (
							<span className="flex items-center gap-0.5 text-red-500">
								<Link2 className="h-3 w-3" />
								{blockedCount} blocked
							</span>
						)}
					</div>
				</div>

				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<ChevronDown
						className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
					/>
				</button>
			</div>

			{/* Expandable card list */}
			<div
				className={`grid transition-[grid-template-rows] duration-200 ${
					expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
				}`}
			>
				<div className="overflow-hidden">
					<div className="flex flex-wrap gap-1.5 border-t px-3 py-2.5">
						{sortedCards.map((card) => (
							<CardChip key={card.id} card={card} onClick={() => onCardClick(card.id)} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
