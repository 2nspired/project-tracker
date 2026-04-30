"use client";

import {
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
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
import { CardDetailSheet } from "./card-detail-sheet";
import { AddColumnButton } from "./column-header";
import { IntentBannerProvider } from "./intent-banner-context";
import { SortableCard } from "./sortable-card";

type FullBoard = RouterOutputs["board"]["getFull"];
type BoardColumnType = FullBoard["columns"][number];
type BoardCardType = BoardColumnType["cards"][number];

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
	// Drag-time projection of column state. While set, columns render from this
	// instead of `sortedColumns` so siblings shift in real time as the user
	// hovers — the dnd-kit "Multiple Containers" pattern.
	const [dragColumns, setDragColumns] = useState<BoardColumnType[] | null>(null);

	const utils = api.useUtils();
	const reorderColumns = api.column.reorder.useMutation({
		onError: (error) => toast.error(error.message),
		onSettled: () => {
			utils.board.getFull.invalidate({ id: board.id });
		},
	});
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
		}),
		// Long-press on touch so a deliberate gesture is needed — keeps drag
		// from hijacking vertical scrolls on mobile.
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
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

	const findColumnForCard = useCallback((cardId: string, columns: BoardColumnType[]) => {
		for (const col of columns) {
			if (col.cards.some((c) => c.id === cardId)) return col;
		}
		return null;
	}, []);

	const handleDragStart = (event: DragStartEvent) => {
		const { active } = event;
		if (active.data.current?.type === "column") return;
		const card = board.columns.flatMap((col) => col.cards).find((c) => c.id === active.id);
		if (card) setActiveCard(card);
	};

	const handleDragOver = (event: DragOverEvent) => {
		const { active, over } = event;
		if (!over) return;
		// Column reorder is handled natively by SortableContext + horizontalListSortingStrategy;
		// the dragColumns projection is only for cross-column card moves.
		if (active.data.current?.type === "column") return;
		const activeId = active.id as string;
		const overId = over.id as string;
		if (activeId === overId) return;

		setDragColumns((prev) => {
			const current = prev ?? sortedColumns;
			const activeColumn = findColumnForCard(activeId, current);
			if (!activeColumn) return prev;

			// over.id is either a column id (empty column / column body drop)
			// or a card id (hovered over a sibling).
			const overColumn =
				current.find((col) => col.id === overId) ?? findColumnForCard(overId, current);
			if (!overColumn) return prev;

			if (activeColumn.id === overColumn.id) {
				const oldIndex = activeColumn.cards.findIndex((c) => c.id === activeId);
				const newIndex = activeColumn.cards.findIndex((c) => c.id === overId);
				if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
				const reordered = arrayMove(activeColumn.cards, oldIndex, newIndex);
				return current.map((col) =>
					col.id === activeColumn.id ? { ...col, cards: reordered } : col
				);
			}

			const draggedCard = activeColumn.cards.find((c) => c.id === activeId);
			if (!draggedCard) return prev;
			const overIndex = overColumn.cards.findIndex((c) => c.id === overId);
			const insertIndex = overIndex >= 0 ? overIndex : overColumn.cards.length;

			return current.map((col) => {
				if (col.id === activeColumn.id) {
					return { ...col, cards: col.cards.filter((c) => c.id !== activeId) };
				}
				if (col.id === overColumn.id) {
					const next = [...col.cards];
					next.splice(insertIndex, 0, draggedCard);
					return { ...col, cards: next };
				}
				return col;
			});
		});
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveCard(null);

		// Column reorder branch
		if (active.data.current?.type === "column") {
			if (!over || active.id === over.id) return;
			const activeId = active.id as string;
			const overId = over.id as string;
			const sortableIds = sortedColumns.filter((c) => !c.isParking).map((c) => c.id);
			const oldIndex = sortableIds.indexOf(activeId);
			const newIndex = sortableIds.indexOf(overId);
			if (oldIndex === -1 || newIndex === -1) return;
			const reorderedSortable = arrayMove(sortableIds, oldIndex, newIndex);
			// Keep parking columns pinned at their existing positions in the
			// authoritative column.position order — service derives final
			// positions from the columnIds array we send.
			const parkingIds = sortedColumns.filter((c) => c.isParking).map((c) => c.id);
			reorderColumns.mutate({
				boardId: board.id,
				columnIds: [...parkingIds, ...reorderedSortable],
			});
			return;
		}

		const activeCardId = active.id as string;
		const final = dragColumns ?? sortedColumns;
		const finalColumn = findColumnForCard(activeCardId, final);
		if (!finalColumn) {
			setDragColumns(null);
			return;
		}
		const finalIndex = finalColumn.cards.findIndex((c) => c.id === activeCardId);

		// No-op detection: compare against pre-drag state (sortedColumns) so we
		// don't fire a redundant mutation when the card lands where it started.
		const originalColumn = findColumnForCard(activeCardId, sortedColumns);
		if (originalColumn?.id === finalColumn.id) {
			const originalIndex = originalColumn.cards.findIndex((c) => c.id === activeCardId);
			if (originalIndex === finalIndex) {
				setDragColumns(null);
				return;
			}
		}

		// Fire mutation first — its onMutate updates the tRPC cache synchronously,
		// so clearing dragColumns afterward doesn't flicker back to the old state.
		moveCard.mutate({
			id: activeCardId,
			data: { columnId: finalColumn.id, position: finalIndex },
		});
		setDragColumns(null);
	};

	const handleDragCancel = () => {
		setActiveCard(null);
		setDragColumns(null);
	};

	// Render projection: drag-time map during a drag, derived state otherwise.
	const renderColumns = dragColumns ?? sortedColumns;
	const parkingRenderColumns = renderColumns.filter((c) => c.isParking);
	const sortableRenderColumns = renderColumns.filter((c) => !c.isParking);
	const sortableColumnIds = sortableRenderColumns.map((c) => c.id);

	return (
		<IntentBannerProvider boardId={board.id}>
			<DndContext
				sensors={sensors}
				collisionDetection={kanbanCollision}
				onDragStart={handleDragStart}
				onDragOver={handleDragOver}
				onDragEnd={handleDragEnd}
				onDragCancel={handleDragCancel}
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

					{/* Columns — parking columns are pinned and not reorderable; the
					    rest are wrapped in a horizontal SortableContext so the
					    user can drag-reorder by the column header. */}
					<div className="flex flex-1 gap-4 overflow-x-auto p-4">
						{parkingRenderColumns.map((column) => (
							<BoardColumn
								key={column.id}
								column={column}
								boardId={board.id}
								sortMode={sortMode}
								onCardClick={onCardSelect}
							/>
						))}
						<SortableContext items={sortableColumnIds} strategy={horizontalListSortingStrategy}>
							{sortableRenderColumns.map((column) => (
								<BoardColumn
									key={column.id}
									column={column}
									boardId={board.id}
									sortMode={sortMode}
									onCardClick={onCardSelect}
								/>
							))}
						</SortableContext>
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
