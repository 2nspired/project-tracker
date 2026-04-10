"use client";

import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RouterOutputs } from "@/trpc/react";

import { getHorizon, type Horizon } from "@/lib/column-roles";
import { RiverFlow } from "./river-flow";
import { DetailCards } from "./detail-cards";
import { DetailRows } from "./detail-rows";

type FullBoard = RouterOutputs["board"]["getFull"];
type BoardCard = FullBoard["columns"][number]["cards"][number];

export type { Horizon };

export type RoadmapCard = BoardCard & {
	columnName: string;
	horizon: Horizon;
	isBlocked: boolean;
};

export type MilestoneGroup = {
	id: string | null;
	name: string;
	cards: RoadmapCard[];
	done: number;
	total: number;
};

function groupByMilestone(cards: RoadmapCard[]): MilestoneGroup[] {
	const map = new Map<string, MilestoneGroup>();

	for (const card of cards) {
		const key = card.milestone?.id ?? "__ungrouped__";
		const name = card.milestone?.name ?? "Ungrouped";

		if (!map.has(key)) {
			map.set(key, {
				id: card.milestone?.id ?? null,
				name,
				cards: [],
				done: 0,
				total: 0,
			});
		}

		const group = map.get(key)!;
		group.cards.push(card);
		group.total++;
		if (card.horizon === "done") group.done++;
	}

	// Named milestones first (sorted by name), ungrouped last
	const groups = Array.from(map.values());
	return groups.sort((a, b) => {
		if (a.id === null) return 1;
		if (b.id === null) return -1;
		return a.name.localeCompare(b.name);
	});
}

type DetailView = "cards" | "rows";

export function RoadmapView({ board }: { board: FullBoard }) {
	const [view, setView] = useState<DetailView>("cards");

	// Flatten all cards with column context and horizon
	const allCards: RoadmapCard[] = board.columns.flatMap((col) =>
		col.cards.map((card) => ({
			...card,
			columnName: col.name,
			horizon: getHorizon(col),
			isBlocked: (card.relationsTo?.length ?? 0) > 0,
		})),
	);

	const milestones = groupByMilestone(allCards);

	// Column order for the river flow
	const columnOrder = board.columns
		.filter((c) => !c.isParking)
		.sort((a, b) => a.position - b.position)
		.map((c) => c.name);

	return (
		<div className="space-y-6">
			{/* River Flow Summary */}
			<RiverFlow
				milestones={milestones}
				columnOrder={columnOrder}
				allCards={allCards}
			/>

			{/* Detail Section */}
			<div>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-muted-foreground">
						Detail
					</h2>
					<div className="flex items-center gap-1 rounded-md border p-0.5">
						<Button
							variant={view === "cards" ? "secondary" : "ghost"}
							size="sm"
							className="h-6 gap-1 px-2 text-xs"
							onClick={() => setView("cards")}
						>
							<LayoutGrid className="h-3 w-3" />
							Cards
						</Button>
						<Button
							variant={view === "rows" ? "secondary" : "ghost"}
							size="sm"
							className="h-6 gap-1 px-2 text-xs"
							onClick={() => setView("rows")}
						>
							<List className="h-3 w-3" />
							Rows
						</Button>
					</div>
				</div>

				{view === "cards" ? (
					<DetailCards milestones={milestones} boardId={board.id} />
				) : (
					<DetailRows milestones={milestones} boardId={board.id} />
				)}
			</div>
		</div>
	);
}
