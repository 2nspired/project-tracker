"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { CardDetailSheet } from "@/components/board/card-detail-sheet";
import type { MilestoneGroup, RoadmapCard } from "./roadmap-view";

const PRIORITY_DOT: Record<string, string> = {
	URGENT: "bg-red-500",
	HIGH: "bg-orange-500",
	MEDIUM: "bg-amber-400",
	LOW: "bg-blue-400",
	NONE: "bg-muted-foreground/30",
};

const HORIZON_ICON: Record<string, string> = {
	now: "\u25cf",   // filled circle
	next: "\u25cb",  // empty circle
	later: "\u25e6", // small empty circle
	done: "\u2713",  // checkmark
};

function CardChip({ card, onClick }: { card: RoadmapCard; onClick: () => void }) {
	const checkDone = card.checklists.filter((c) => c.completed).length;
	const checkTotal = card.checklists.length;
	const isDone = card.horizon === "done";

	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors hover:bg-muted/50 ${
				isDone ? "border-emerald-500/20 bg-emerald-500/5" : "bg-card"
			}`}
		>
			<div className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[card.priority] ?? PRIORITY_DOT.NONE}`} />
			<span className={`text-[10px] ${isDone ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
				{HORIZON_ICON[card.horizon]}
			</span>
			<span className="font-mono text-[10px] text-muted-foreground">
				#{card.number}
			</span>
			<span className={`max-w-32 truncate text-xs ${isDone ? "text-muted-foreground line-through" : ""}`}>
				{card.title}
			</span>
			{checkTotal > 0 && (
				<span className={`text-[10px] ${checkDone === checkTotal ? "text-emerald-500" : "text-muted-foreground"}`}>
					{checkDone}/{checkTotal}
				</span>
			)}
		</button>
	);
}

export function DetailCards({
	milestones,
	boardId,
}: {
	milestones: MilestoneGroup[];
	boardId: string;
}) {
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

	if (milestones.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-muted-foreground">
				No cards on this board yet.
			</p>
		);
	}

	return (
		<>
			<div className="space-y-4">
				{milestones.map((milestone) => {
					const pct = milestone.total > 0 ? Math.round((milestone.done / milestone.total) * 100) : 0;

					// Sort: now first, then next, then later, done last
					const order = { now: 0, next: 1, later: 2, done: 3 };
					const sorted = [...milestone.cards].sort(
						(a, b) => order[a.horizon] - order[b.horizon],
					);

					return (
						<div
							key={milestone.id ?? "__ungrouped__"}
							className="rounded-lg border bg-card"
						>
							{/* Milestone header */}
							<div className="flex items-center justify-between border-b px-4 py-2.5">
								<div className="flex items-center gap-2">
									<h3 className="text-sm font-semibold">{milestone.name}</h3>
									<Badge variant="outline" className="text-[10px] font-normal">
										{milestone.total} cards
									</Badge>
								</div>
								<div className="flex items-center gap-2">
									<div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
										<div
											className="h-full rounded-full bg-emerald-500 transition-all"
											style={{ width: `${pct}%` }}
										/>
									</div>
									<span className="text-xs tabular-nums text-muted-foreground">
										{pct}%
									</span>
								</div>
							</div>

							{/* Card chips */}
							<div className="flex flex-wrap gap-1.5 p-3">
								{sorted.map((card) => (
									<CardChip
										key={card.id}
										card={card}
										onClick={() => setSelectedCardId(card.id)}
									/>
								))}
							</div>
						</div>
					);
				})}
			</div>

			<CardDetailSheet
				cardId={selectedCardId}
				boardId={boardId}
				onClose={() => setSelectedCardId(null)}
			/>
		</>
	);
}
