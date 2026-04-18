"use client";

import {
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Lightbulb } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import type { BoardView as BoardViewType } from "@/lib/board-views";
import { hasRole } from "@/lib/column-roles";
import { computeWorkNextScore } from "@/lib/work-next-score";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";
import { BoardPulse } from "./board-pulse";
import { type BoardFilters, BoardToolbar, type SortMode } from "./board-toolbar";
import { CardCreateInline } from "./card-create-inline";
import { useCardNavigation } from "@/hooks/use-card-navigation";
import { CardDetailSheet } from "./card-detail-sheet";
import { AddColumnButton } from "./column-header";
import { IntentBannerProvider } from "./intent-banner-context";
import { SortableCard } from "./sortable-card";

type FullBoard = RouterOutputs["board"]["getFull"];
type BoardCardType = FullBoard["columns"][number]["cards"][number];

/**
 * Custom collision detection: use pointerWithin first (more precise for nested droppables),
 * fall back to rectIntersection for edge cases. This ensures cards can be dropped
 * on any column regardless of whether it already has cards.
 */
const kanbanCollision: CollisionDetection = (args) => {
	const pointerCollisions = pointerWithin(args);
	if (pointerCollisions.length > 0) return pointerCollisions;
	return rectIntersection(args);
};

function filterCards(cards: BoardCardType[], filters: BoardFilters): BoardCardType[] {
	return cards.filter((card) => {
		if (filters.search) {
			const q = filters.search.toLowerCase();
			const matchesTitle = card.title.toLowerCase().includes(q);
			const matchesNumber =
				`#${card.number}` === filters.search || String(card.number) === filters.search;
			if (!matchesTitle && !matchesNumber) return false;
		}
		if (filters.priority !== "ALL" && card.priority !== filters.priority) return false;
		if (filters.tag !== "ALL") {
			const tags: string[] = JSON.parse(card.tags);
			if (!tags.includes(filters.tag)) return false;
		}
		return true;
	});
}

type BoardViewProps = {
	board: FullBoard;
	filters: BoardFilters;
	onFiltersChange: (filters: BoardFilters) => void;
	sortMode: SortMode;
	onSortModeChange: (mode: SortMode) => void;
	hiddenRoles: string[];
	onHiddenRolesChange: (roles: string[]) => void;
	activeViewId: string | null;
	onViewChange: (view: BoardViewType | null) => void;
	selectedCardId: string | null;
	onCardSelect: (cardId: string | null) => void;
};

export function BoardView({
	board,
	filters,
	onFiltersChange,
	sortMode,
	onSortModeChange,
	hiddenRoles,
	onHiddenRolesChange,
	activeViewId,
	onViewChange,
	selectedCardId,
	onCardSelect,
}: BoardViewProps) {
	const [activeCard, setActiveCard] = useState<BoardCardType | null>(null);

	const utils = api.useUtils();
	const moveCard = api.card.move.useMutation({
		onMutate: async ({ id, data }) => {
			// Cancel outgoing refetches
			await utils.board.getFull.cancel({ id: board.id });

			// Snapshot current state
			const previous = utils.board.getFull.getData({ id: board.id });

			// Optimistically update the cache
			utils.board.getFull.setData({ id: board.id }, (old) => {
				if (!old) return old;
				const columns = old.columns.map((col) => ({
					...col,
					cards: col.cards.filter((c) => c.id !== id),
				}));
				// Find target column and insert card
				const targetCol = columns.find((c) => c.id === data.columnId);
				if (targetCol && previous) {
					const card = previous.columns.flatMap((c) => c.cards).find((c) => c.id === id);
					if (card) {
						const updatedCard = { ...card, columnId: data.columnId, updatedAt: new Date() };
						targetCol.cards.splice(data.position, 0, updatedCard);
						// Reindex positions
						targetCol.cards.forEach((c, i) => {
							(c as Record<string, unknown>).position = i;
						});
					}
				}
				return { ...old, columns };
			});

			return { previous };
		},
		onError: (error, _vars, context) => {
			// Roll back on error
			if (context?.previous) {
				utils.board.getFull.setData({ id: board.id }, context.previous);
			}
			toast.error(error.message);
		},
		onSettled: () => {
			// Always refetch to sync with server
			utils.board.getFull.invalidate({ id: board.id });
		},
	});

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		})
	);

	// Collect all unique tags across the board for the filter dropdown
	const allCards = board.columns.flatMap((col) => col.cards);
	const availableTags = useMemo(() => {
		const tagSet = new Set<string>();
		for (const card of allCards) {
			for (const tag of JSON.parse(card.tags) as string[]) {
				tagSet.add(tag);
			}
		}
		return Array.from(tagSet).sort();
	}, [allCards]);

	// Build a map of how many cards each card blocks (for work-next scoring)
	const blocksOtherMap = useMemo(() => {
		const map = new Map<string, number>();
		for (const col of board.columns) {
			for (const card of col.cards) {
				// relationsTo are "blocked by" relations on this card
				// We need to count how many cards THIS card blocks (i.e., appears as blocker)
				// This data isn't directly available, but _blockedByCount tells us
				// how many block relations point TO this card. We need the inverse.
			}
		}
		// We don't have relationsFrom in getFull, so we approximate:
		// cards with _blockedByCount > 0 are blocked; we can't know who blocks them
		// from this data. For now, _blocksOtherCount stays 0 unless enriched.
		return map;
	}, [board.columns]);

	// Apply filters to get filtered columns
	// Done column sorts by most recently completed (updatedAt desc) instead of position
	// Smart sort mode: sort by work-next score (descending) instead of position
	const filteredColumns = useMemo(
		() =>
			board.columns
				.filter((col) => !hiddenRoles.some((role) => hasRole(col, role)))
				.map((col) => {
					let cards = filterCards(col.cards, filters);
					if (hasRole(col, "done")) {
						cards = [...cards].sort(
							(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
						);
					} else if (sortMode === "smart") {
						cards = [...cards]
							.map((card) => ({
								...card,
								_workNextScore: computeWorkNextScore({
									...card,
									relationsTo: card.relationsTo,
									_blocksOtherCount: blocksOtherMap.get(card.id) ?? 0,
								}),
							}))
							.sort((a, b) => b._workNextScore - a._workNextScore);
					}
					return { ...col, cards };
				}),
		[board.columns, filters, sortMode, hiddenRoles, blocksOtherMap]
	);

	const totalCards = allCards.length;
	const visibleCards = filteredColumns.reduce((sum, col) => sum + col.cards.length, 0);

	// Sort: parking lot columns first, then regular columns by position
	const sortedColumns = useMemo(() => {
		const parking = filteredColumns.filter((col) => col.isParking);
		const regular = filteredColumns.filter((col) => !col.isParking);
		return [...parking, ...regular];
	}, [filteredColumns]);

	const flatCardIds = useMemo(
		() => sortedColumns.flatMap((col) => col.cards.map((c) => c.id)),
		[sortedColumns],
	);
	const handleNavigate = useCardNavigation(flatCardIds, selectedCardId, onCardSelect);

	const findColumnForCard = useCallback(
		(cardId: string) => {
			for (const col of board.columns) {
				if (col.cards.some((c) => c.id === cardId)) {
					return col;
				}
			}
			return null;
		},
		[board.columns]
	);

	const handleDragStart = (event: DragStartEvent) => {
		const { active } = event;
		const card = board.columns.flatMap((col) => col.cards).find((c) => c.id === active.id);
		if (card) setActiveCard(card);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveCard(null);

		if (!over) return;

		const activeCardId = active.id as string;

		// Determine target column and position
		let targetColumnId: string;
		let targetPosition: number;

		const overColumn = board.columns.find((col) => col.id === over.id);
		if (overColumn) {
			// Dropped directly on a column
			targetColumnId = overColumn.id;
			targetPosition = overColumn.cards.length;
		} else {
			// Dropped on another card
			const targetCol = findColumnForCard(over.id as string);
			if (!targetCol) return;
			targetColumnId = targetCol.id;
			const overIndex = targetCol.cards.findIndex((c) => c.id === over.id);
			targetPosition = overIndex >= 0 ? overIndex : targetCol.cards.length;
		}

		const sourceCol = findColumnForCard(activeCardId);
		if (!sourceCol) return;

		// Don't do anything if dropped in same spot
		if (sourceCol.id === targetColumnId) {
			const currentIndex = sourceCol.cards.findIndex((c) => c.id === activeCardId);
			if (currentIndex === targetPosition) return;
		}

		moveCard.mutate({
			id: activeCardId,
			data: { columnId: targetColumnId, position: targetPosition },
		});
	};

	return (
		<IntentBannerProvider boardId={board.id}>
			<DndContext
				sensors={sensors}
				collisionDetection={kanbanCollision}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div className="relative flex flex-1 flex-col overflow-hidden">
					<BoardToolbar
						boardId={board.id}
						filters={filters}
						onFiltersChange={onFiltersChange}
						sortMode={sortMode}
						onSortModeChange={onSortModeChange}
						hiddenRoles={hiddenRoles}
						onHiddenRolesChange={onHiddenRolesChange}
						activeViewId={activeViewId}
						onViewChange={onViewChange}
						availableTags={availableTags}
						totalCards={totalCards}
						visibleCards={visibleCards}
					/>

					<BoardPulse boardId={board.id} />

					{/* Columns */}
					<div className="flex flex-1 gap-4 overflow-x-auto p-4">
						{sortedColumns.map((column) => (
							<BoardColumn
								key={column.id}
								column={column}
								boardId={board.id}
								sortMode={sortMode}
								onCardClick={onCardSelect}
							/>
						))}
						<div className="flex shrink-0 items-start pt-1">
							<AddColumnButton boardId={board.id} />
						</div>
					</div>

					{totalCards === 0 && (
						<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
							<div className="pointer-events-auto rounded-lg border bg-card/95 px-8 py-6 shadow-lg backdrop-blur-sm">
								<EmptyState
									icon={Lightbulb}
									title="This board is empty"
									description="Click the + at the bottom of any column to create your first card, or use an AI agent with the MCP tools to populate the board."
									className="py-0"
								/>
							</div>
						</div>
					)}

					<CardDetailSheet
						cardId={selectedCardId}
						boardId={board.id}
						onClose={() => onCardSelect(null)}
						onNavigate={handleNavigate}
					/>
				</div>

				<DragOverlay>
					{activeCard && (
						<div className="w-72 rotate-2 opacity-90">
							<BoardCard card={activeCard} onClick={() => {}} />
						</div>
					)}
				</DragOverlay>
			</DndContext>
		</IntentBannerProvider>
	);
}
