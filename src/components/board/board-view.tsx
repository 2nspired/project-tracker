"use client";

import {
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragStartEvent,
	type CollisionDetection,
	PointerSensor,
	useSensor,
	useSensors,
	pointerWithin,
	rectIntersection,
} from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { BoardColumn } from "./board-column";
import { BoardToolbar, emptyFilters, type BoardFilters } from "./board-toolbar";
import { CardCreateInline } from "./card-create-inline";
import { CardDetailSheet } from "./card-detail-sheet";
import { BoardCard } from "./board-card";
import { SortableCard } from "./sortable-card";
import { AddColumnButton } from "./column-header";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

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
			const matchesNumber = `#${card.number}` === filters.search || String(card.number) === filters.search;
			if (!matchesTitle && !matchesNumber) return false;
		}
		if (filters.priority !== "ALL" && card.priority !== filters.priority) return false;
		if (filters.assignee !== "ALL") {
			if (filters.assignee === "UNASSIGNED" && card.assignee !== null) return false;
			if (filters.assignee !== "UNASSIGNED" && card.assignee !== filters.assignee) return false;
		}
		if (filters.tag !== "ALL") {
			const tags: string[] = JSON.parse(card.tags);
			if (!tags.includes(filters.tag)) return false;
		}
		return true;
	});
}

export function BoardView({ board }: { board: FullBoard }) {
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const [activeCard, setActiveCard] = useState<BoardCardType | null>(null);
	const [filters, setFilters] = useState<BoardFilters>(emptyFilters);

	const utils = api.useUtils();
	const moveCard = api.card.move.useMutation({
		onSuccess: () => {
			utils.board.getFull.invalidate({ id: board.id });
		},
		onError: (error) => toast.error(error.message),
	});

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
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

	// Apply filters to get filtered columns
	// Done column sorts by most recently completed (updatedAt desc) instead of position
	const filteredColumns = useMemo(
		() =>
			board.columns.map((col) => {
				const cards = filterCards(col.cards, filters);
				if (col.name === "Done") {
					return { ...col, cards: [...cards].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) };
				}
				return { ...col, cards };
			}),
		[board.columns, filters],
	);

	const totalCards = allCards.length;
	const visibleCards = filteredColumns.reduce((sum, col) => sum + col.cards.length, 0);

	// Sort: parking lot columns first, then regular columns by position
	const sortedColumns = useMemo(() => {
		const parking = filteredColumns.filter((col) => col.isParking);
		const regular = filteredColumns.filter((col) => !col.isParking);
		return [...parking, ...regular];
	}, [filteredColumns]);

	const findColumnForCard = useCallback(
		(cardId: string) => {
			for (const col of board.columns) {
				if (col.cards.some((c) => c.id === cardId)) {
					return col;
				}
			}
			return null;
		},
		[board.columns],
	);

	const handleDragStart = (event: DragStartEvent) => {
		const { active } = event;
		const card = board.columns
			.flatMap((col) => col.cards)
			.find((c) => c.id === active.id);
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
		<DndContext
			sensors={sensors}
			collisionDetection={kanbanCollision}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<div className="flex flex-1 flex-col overflow-hidden">
				<BoardToolbar
					filters={filters}
					onFiltersChange={setFilters}
					availableTags={availableTags}
					totalCards={totalCards}
					visibleCards={visibleCards}
				/>

				{/* Columns */}
				<div className="flex flex-1 gap-4 overflow-x-auto p-4">
					{sortedColumns.map((column) => (
						<BoardColumn
							key={column.id}
							column={column}
							boardId={board.id}
							onCardClick={setSelectedCardId}
						/>
					))}
					<div className="flex shrink-0 items-start pt-1">
						<AddColumnButton boardId={board.id} />
					</div>
				</div>

				<CardDetailSheet
					cardId={selectedCardId}
					boardId={board.id}
					onClose={() => setSelectedCardId(null)}
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
	);
}

