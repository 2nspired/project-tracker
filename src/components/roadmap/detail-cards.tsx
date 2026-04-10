"use client";

import { useState } from "react";

import { Ban, LayoutGrid } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardDetailSheet } from "@/components/board/card-detail-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { PRIORITY_DOT, STATUS_BG, STATUS_BORDER, STATUS_DOT, STATUS_TEXT } from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import type { MilestoneGroup, RoadmapCard } from "./roadmap-view";

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
	const isBlocked = card.isBlocked && !isDone;

	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors hover:bg-muted/50 ${
				isBlocked ? `${STATUS_BORDER.blocked} ${STATUS_BG.blocked}` : isDone ? `${STATUS_BORDER.done} ${STATUS_BG.done}` : "bg-card"
			}`}
		>
			<div className={`h-1.5 w-1.5 shrink-0 rounded-full ${isBlocked ? STATUS_DOT.blocked : (PRIORITY_DOT[card.priority as Priority] ?? PRIORITY_DOT.NONE)}`} />
			{isBlocked && <Ban className={`h-2.5 w-2.5 shrink-0 ${STATUS_TEXT.blocked}`} />}
			<span className={`text-2xs ${isDone ? STATUS_TEXT.done : "text-muted-foreground"}`}>
				{HORIZON_ICON[card.horizon]}
			</span>
			<span className="font-mono text-2xs text-muted-foreground">
				#{card.number}
			</span>
			<span className={`max-w-32 truncate text-xs ${isDone ? "text-muted-foreground line-through" : ""}`}>
				{card.title}
			</span>
			{checkTotal > 0 && (
				<span className={`text-2xs ${checkDone === checkTotal ? STATUS_TEXT.done : "text-muted-foreground"}`}>
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
			<EmptyState icon={LayoutGrid} title="No cards on this board yet" description="Create cards on your board to see them in the roadmap." className="py-8" />
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
									<Badge variant="outline" className="text-2xs font-normal">
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
