"use client";

import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Maximize2, Minimize2, Target } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CardDetailSheet } from "@/components/board/card-detail-sheet";
import { Button } from "@/components/ui/button";
import { useCardNavigation } from "@/hooks/use-card-navigation";
import { getHorizon, HORIZON_ORDER, type Horizon } from "@/lib/column-roles";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { HorizonBand } from "./horizon-band";

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
	/** The dominant horizon of this milestone's non-done cards */
	primaryHorizon: Horizon;
	targetDate: Date | string | null;
};

type DensityMode = "expanded" | "compact" | "focus";

/** Compute the primary horizon for a milestone based on its cards' horizons. */
function computePrimaryHorizon(cards: RoadmapCard[]): Horizon {
	const active = cards.filter((c) => c.horizon !== "done");
	if (active.length === 0) return "done";

	// Priority: if any card is "now", milestone is "now"
	if (active.some((c) => c.horizon === "now")) return "now";
	return "later";
}

function groupByMilestoneAndHorizon(
	cards: RoadmapCard[],
	milestoneOrder: string[]
): {
	now: MilestoneGroup[];
	later: MilestoneGroup[];
	done: MilestoneGroup[];
} {
	// First group cards by milestone
	const map = new Map<string, MilestoneGroup>();

	for (const card of cards) {
		const key = card.milestone?.id ?? "__ungrouped__";
		const name = card.milestone?.name ?? "Unplanned";

		let group = map.get(key);
		if (!group) {
			group = {
				id: card.milestone?.id ?? null,
				name,
				cards: [],
				done: 0,
				total: 0,
				primaryHorizon: "later",
				targetDate:
					(card.milestone as { targetDate?: Date | string | null } | undefined)?.targetDate ?? null,
			};
			map.set(key, group);
		}

		group.cards.push(card);
		group.total++;
		if (card.horizon === "done") group.done++;
	}

	// Set primary horizon for each milestone
	for (const group of map.values()) {
		group.primaryHorizon = computePrimaryHorizon(group.cards);
	}

	// Sort milestones within each horizon by the provided order
	const orderIndex = new Map(milestoneOrder.map((id, i) => [id, i]));
	const sortByOrder = (a: MilestoneGroup, b: MilestoneGroup) => {
		// Ungrouped always last
		if (a.id === null) return 1;
		if (b.id === null) return -1;
		const ai = orderIndex.get(a.id) ?? 999;
		const bi = orderIndex.get(b.id) ?? 999;
		return ai - bi;
	};

	const groups = Array.from(map.values());

	return {
		now: groups.filter((g) => g.primaryHorizon === "now").sort(sortByOrder),
		later: groups.filter((g) => g.primaryHorizon === "later").sort(sortByOrder),
		done: groups.filter((g) => g.primaryHorizon === "done").sort(sortByOrder),
	};
}

export function RoadmapView({ board }: { board: FullBoard }) {
	const [density, setDensity] = useState<DensityMode>("focus");
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const [activeDragId, setActiveDragId] = useState<string | null>(null);

	const utils = api.useUtils();
	const reorderMilestones = api.milestone.reorder.useMutation({
		onSuccess: () => {
			utils.milestone.list.invalidate();
			utils.board.getFull.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	// Flatten all cards with column context and horizon
	const allCards: RoadmapCard[] = useMemo(
		() =>
			board.columns.flatMap((col) =>
				col.cards.map((card) => ({
					...card,
					columnName: col.name,
					horizon: getHorizon(col),
					isBlocked: (card.relationsTo?.length ?? 0) > 0,
				}))
			),
		[board]
	);

	// Get milestone ordering from board data
	const milestoneOrder = useMemo(() => {
		const seen = new Set<string>();
		const order: string[] = [];
		for (const card of allCards) {
			if (card.milestone?.id && !seen.has(card.milestone.id)) {
				seen.add(card.milestone.id);
				order.push(card.milestone.id);
			}
		}
		return order;
	}, [allCards]);

	const horizonGroups = useMemo(
		() => groupByMilestoneAndHorizon(allCards, milestoneOrder),
		[allCards, milestoneOrder]
	);

	// DnD sensors
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 8 },
		}),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	const handleDragStart = useCallback((event: DragStartEvent) => {
		setActiveDragId(event.active.id as string);
	}, []);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveDragId(null);
			const { active, over } = event;
			if (!over || active.id === over.id) return;

			// Reorder within the same horizon band
			const activeData = active.data.current as {
				type: string;
				horizon: Horizon;
			};
			const overData = over.data.current as {
				type: string;
				horizon?: Horizon;
			};

			if (activeData?.type === "milestone" && overData?.type === "milestone") {
				// Get the horizon group that contains both
				const horizon = activeData.horizon;
				const group = horizonGroups[horizon];
				const activeIndex = group.findIndex((m) => (m.id ?? "__ungrouped__") === active.id);
				const overIndex = group.findIndex((m) => (m.id ?? "__ungrouped__") === over.id);

				if (activeIndex !== -1 && overIndex !== -1) {
					const reordered = arrayMove(group, activeIndex, overIndex);
					const allMilestoneIds = [
						...horizonGroups.now,
						...horizonGroups.later,
						...horizonGroups.done,
					]
						.map((m) => m.id)
						.filter((id): id is string => id !== null);

					// Build new order: replace the reordered horizon's milestones in position
					const reorderedIds = reordered.map((m) => m.id).filter((id): id is string => id !== null);
					const _otherIds = allMilestoneIds.filter((id) => !reorderedIds.includes(id));

					// Reconstruct full order: iterate through horizons in order
					const fullOrder: string[] = [];
					for (const h of HORIZON_ORDER) {
						const milestones = h === horizon ? reordered : horizonGroups[h];
						for (const m of milestones) {
							if (m.id) fullOrder.push(m.id);
						}
					}

					reorderMilestones.mutate({
						projectId: board.project.id,
						orderedIds: fullOrder,
					});
				}
			}
		},
		[horizonGroups, board.project.id, reorderMilestones]
	);

	const handleCardClick = useCallback((cardId: string) => {
		setSelectedCardId(cardId);
	}, []);

	const flatCardIds = useMemo(() => {
		const ids: string[] = [];
		for (const h of HORIZON_ORDER) {
			for (const group of horizonGroups[h]) {
				for (const card of group.cards) ids.push(card.id);
			}
		}
		return ids;
	}, [horizonGroups]);
	const handleNavigate = useCardNavigation(flatCardIds, selectedCardId, setSelectedCardId);

	// Find the active milestone for drag overlay
	const activeMilestone = activeDragId
		? [...horizonGroups.now, ...horizonGroups.later, ...horizonGroups.done].find(
				(m) => (m.id ?? "__ungrouped__") === activeDragId
			)
		: null;

	const totalCards = allCards.length;
	const totalDone = allCards.filter((c) => c.horizon === "done").length;

	if (totalCards === 0) {
		return (
			<div className="rounded-lg border bg-card py-12 text-center">
				<p className="text-sm text-muted-foreground">
					No cards on this board yet. Create cards to see them in the roadmap.
				</p>
			</div>
		);
	}

	return (
		<>
			{/* Toolbar */}
			<div className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-3">
					<span className="text-xs text-muted-foreground">
						{totalDone}/{totalCards} cards done
					</span>
					{/* Mini progress bar */}
					<div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-emerald-500 transition-all duration-500"
							style={{
								width: `${totalCards > 0 ? (totalDone / totalCards) * 100 : 0}%`,
							}}
						/>
					</div>
				</div>
				<div className="flex items-center gap-1 rounded-md border p-0.5">
					<Button
						variant={density === "expanded" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 gap-1 px-2 text-xs"
						onClick={() => setDensity("expanded")}
						title="Expanded — show all cards"
					>
						<Maximize2 className="h-3 w-3" />
					</Button>
					<Button
						variant={density === "focus" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 gap-1 px-2 text-xs"
						onClick={() => setDensity("focus")}
						title="Focus — expand Now only"
					>
						<Target className="h-3 w-3" />
					</Button>
					<Button
						variant={density === "compact" ? "secondary" : "ghost"}
						size="sm"
						className="h-6 gap-1 px-2 text-xs"
						onClick={() => setDensity("compact")}
						title="Compact — milestones only"
					>
						<Minimize2 className="h-3 w-3" />
					</Button>
				</div>
			</div>

			{/* Horizon landscape */}
			<DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
				<div className="space-y-3">
					<HorizonBand
						horizon="now"
						milestones={horizonGroups.now}
						density={density}
						onCardClick={handleCardClick}
					/>
					<HorizonBand
						horizon="later"
						milestones={horizonGroups.later}
						density={density}
						onCardClick={handleCardClick}
					/>
					{horizonGroups.done.length > 0 && (
						<HorizonBand
							horizon="done"
							milestones={horizonGroups.done}
							density={density}
							onCardClick={handleCardClick}
						/>
					)}
				</div>

				<DragOverlay>
					{activeMilestone && (
						<div className="rounded-lg border bg-card px-4 py-2 shadow-lg">
							<span className="text-sm font-semibold">{activeMilestone.name}</span>
							<span className="ml-2 text-2xs text-muted-foreground">
								{activeMilestone.total} cards
							</span>
						</div>
					)}
				</DragOverlay>
			</DndContext>

			<CardDetailSheet
				cardId={selectedCardId}
				boardId={board.id}
				onClose={() => setSelectedCardId(null)}
				onNavigate={handleNavigate}
			/>
		</>
	);
}
