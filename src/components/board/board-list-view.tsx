"use client";

import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	type CollisionDetection,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Ban, CheckSquare, ChevronDown, ChevronRight, Clock, GripVertical, MessageSquare } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDroppable } from "@dnd-kit/core";

import { getHorizon } from "@/lib/column-roles";
import { PRIORITY_BORDER, PRIORITY_DOT, STATUS_TEXT } from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import { computeWorkNextScore } from "@/lib/work-next-score";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { type BoardFilters, type SortMode, BoardToolbar } from "./board-toolbar";
import { hasRole } from "@/lib/column-roles";
import type { BoardView as BoardViewType } from "@/lib/board-views";
import { useCardNavigation } from "@/hooks/use-card-navigation";
import { CardDetailSheet } from "./card-detail-sheet";

type FullBoard = RouterOutputs["board"]["getFull"];
type BoardCard = FullBoard["columns"][number]["cards"][number];

type ListCard = BoardCard & {
	columnName: string;
	columnId: string;
	columnRole: string | null;
	_workNextScore?: number;
	_blockedByCount?: number;
};

type ColumnGroupData = {
	id: string;
	name: string;
	role: string | null;
	cards: ListCard[];
	horizon: string;
};

function filterCards(cards: ListCard[], filters: BoardFilters): ListCard[] {
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

function getAgeDays(updatedAt: Date): number {
	return Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
}

function getAgeIndicator(days: number): { className: string; label: string } | null {
	if (days >= 7) return { className: "text-orange-500", label: `${days}d` };
	if (days >= 3) return { className: "text-yellow-500", label: `${days}d` };
	return null;
}

const listCollision: CollisionDetection = (args) => {
	const pointerCollisions = pointerWithin(args);
	if (pointerCollisions.length > 0) return pointerCollisions;
	return rectIntersection(args);
};

type BoardListViewProps = {
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

export function BoardListView({
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
}: BoardListViewProps) {
	const [activeCard, setActiveCard] = useState<ListCard | null>(null);

	const utils = api.useUtils();
	const moveCard = api.card.move.useMutation({
		onMutate: async ({ id, data }) => {
			await utils.board.getFull.cancel({ id: board.id });
			const previous = utils.board.getFull.getData({ id: board.id });

			utils.board.getFull.setData({ id: board.id }, (old) => {
				if (!old) return old;
				const columns = old.columns.map((col) => ({
					...col,
					cards: col.cards.filter((c) => c.id !== id),
				}));
				const targetCol = columns.find((c) => c.id === data.columnId);
				if (targetCol && previous) {
					const card = previous.columns.flatMap((c) => c.cards).find((c) => c.id === id);
					if (card) {
						const updatedCard = { ...card, columnId: data.columnId, updatedAt: new Date() };
						targetCol.cards.splice(data.position, 0, updatedCard);
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
			if (context?.previous) {
				utils.board.getFull.setData({ id: board.id }, context.previous);
			}
			toast.error(error.message);
		},
		onSettled: () => {
			utils.board.getFull.invalidate({ id: board.id });
		},
	});

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		})
	);

	const allCards: ListCard[] = useMemo(
		() =>
			board.columns.flatMap((col) =>
				col.cards.map((card) => ({
					...card,
					columnName: col.name,
					columnId: col.id,
					columnRole: col.role,
				}))
			),
		[board.columns]
	);

	const availableTags = useMemo(() => {
		const tagSet = new Set<string>();
		for (const card of allCards) {
			for (const tag of JSON.parse(card.tags) as string[]) {
				tagSet.add(tag);
			}
		}
		return Array.from(tagSet).sort();
	}, [allCards]);

	const filteredCards = useMemo(() => {
		let cards = filterCards(allCards, filters);
		if (sortMode === "smart") {
			cards = cards.map((card) => ({
				...card,
				_workNextScore: computeWorkNextScore({
					...card,
					relationsTo: card.relationsTo,
					_blocksOtherCount: 0,
				}),
			}));
			cards.sort((a, b) => (b._workNextScore ?? 0) - (a._workNextScore ?? 0));
		}
		return cards;
	}, [allCards, filters, sortMode]);

	const groupedByColumn: ColumnGroupData[] = useMemo(() => {
		const horizonOrder = { now: 0, next: 1, later: 2, done: 3 };
		const groups = board.columns
			.filter((col) => !col.isParking && !hiddenRoles.some((role) => hasRole(col, role)))
			.map((col) => ({
				id: col.id,
				name: col.name,
				role: col.role,
				cards: filteredCards.filter((c) => c.columnName === col.name),
				horizon: getHorizon(col),
			}));
		groups.sort((a, b) => horizonOrder[a.horizon as keyof typeof horizonOrder] - horizonOrder[b.horizon as keyof typeof horizonOrder]);
		return groups;
	}, [board.columns, filteredCards, hiddenRoles]);

	const findColumnForCard = useCallback(
		(cardId: string) => {
			for (const col of board.columns) {
				if (col.cards.some((c) => c.id === cardId)) return col;
			}
			return null;
		},
		[board.columns]
	);

	const flatCardIds = useMemo(
		() => groupedByColumn.flatMap((g) => g.cards.map((c) => c.id)),
		[groupedByColumn],
	);
	const handleNavigate = useCardNavigation(flatCardIds, selectedCardId, onCardSelect);

	const handleDragStart = (event: DragStartEvent) => {
		const card = allCards.find((c) => c.id === event.active.id);
		if (card) setActiveCard(card);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveCard(null);

		if (!over) return;

		const activeCardId = active.id as string;
		const overId = over.id as string;

		// Find target column — either dropped on a column group or on a card within one
		const targetGroup = groupedByColumn.find((g) => g.id === overId);
		let targetColumnId: string;
		let targetPosition: number;

		if (targetGroup) {
			targetColumnId = targetGroup.id;
			targetPosition = targetGroup.cards.length;
		} else {
			// Dropped on a card — find which column group it belongs to
			const targetCard = allCards.find((c) => c.id === overId);
			if (!targetCard) return;
			targetColumnId = targetCard.columnId;
			const group = groupedByColumn.find((g) => g.id === targetColumnId);
			if (!group) return;
			const overIndex = group.cards.findIndex((c) => c.id === overId);
			targetPosition = overIndex >= 0 ? overIndex : group.cards.length;
		}

		const sourceCol = findColumnForCard(activeCardId);
		if (!sourceCol) return;

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
			collisionDetection={listCollision}
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
					totalCards={allCards.length}
					visibleCards={groupedByColumn.reduce((sum, g) => sum + g.cards.length, 0)}
				/>

				<div className="flex-1 overflow-y-auto p-4">
					<div className="space-y-3">
						{groupedByColumn.map((group) => (
							<ColumnGroup
								key={group.id}
								group={group}
								onCardClick={onCardSelect}
							/>
						))}
					</div>
				</div>

				<CardDetailSheet
					cardId={selectedCardId}
					boardId={board.id}
					onClose={() => onCardSelect(null)}
					onNavigate={handleNavigate}
				/>
			</div>

			<DragOverlay>
				{activeCard && (
					<div className="w-full max-w-2xl opacity-90">
						<ListRowContent card={activeCard} />
					</div>
				)}
			</DragOverlay>
		</DndContext>
	);
}

function ColumnGroup({
	group,
	onCardClick,
}: {
	group: ColumnGroupData;
	onCardClick: (id: string) => void;
}) {
	const isDone = group.role === "done";
	const [collapsed, setCollapsed] = useState(isDone);
	const isEmpty = group.cards.length === 0;

	const { setNodeRef, isOver } = useDroppable({
		id: group.id,
		data: { type: "column", columnId: group.id },
	});

	return (
		<div
			ref={setNodeRef}
			className={`rounded-lg border overflow-hidden transition-colors ${
				isOver ? "border-primary/50 bg-primary/5" : "bg-card/50"
			}`}
		>
			<button
				type="button"
				onClick={() => !isEmpty && setCollapsed(!collapsed)}
				className={`flex w-full items-center gap-2 bg-muted/40 px-4 py-2.5 text-left transition-colors ${
					isEmpty ? "cursor-default" : "hover:bg-muted/60"
				}`}
			>
				{isEmpty ? (
					<span className="h-3.5 w-3.5" />
				) : collapsed ? (
					<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
				) : (
					<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
				)}
				<span className={`text-xs font-medium ${isEmpty ? "text-muted-foreground" : ""}`}>{group.name}</span>
				<span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
					{group.cards.length}
				</span>
			</button>

			{!collapsed && !isEmpty && (
				<div className="divide-y divide-border/50">
					{group.cards.map((card) => (
						<DraggableListRow key={card.id} card={card} onClick={() => onCardClick(card.id)} />
					))}
				</div>
			)}
		</div>
	);
}

function DraggableListRow({ card, onClick }: { card: ListCard; onClick: () => void }) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: card.id,
		data: { type: "card", card },
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	const priority = card.priority as Priority;

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`flex items-center transition-colors hover:bg-muted/30 ${
				priority !== "NONE" ? `border-l-[3px] ${PRIORITY_BORDER[priority]}` : ""
			}`}
		>
			<div
				className="flex shrink-0 cursor-grab items-center px-2 py-3 text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
				{...attributes}
				{...listeners}
			>
				<GripVertical className="h-3.5 w-3.5" />
			</div>
			<div
				role="button"
				tabIndex={0}
				className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 py-3 pr-4"
				onClick={onClick}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onClick();
					}
				}}
			>
				<ListRowContent card={card} />
			</div>
		</div>
	);
}

function ListRowContent({ card }: { card: ListCard }) {
	const priority = card.priority as Priority;
	const tags: string[] = JSON.parse(card.tags);
	const checklistTotal = card.checklists.length;
	const checklistDone = card.checklists.filter((c) => c.completed).length;
	const blockedByCount = card._blockedByCount ?? 0;
	const ageDays = getAgeDays(card.updatedAt);
	const aging = getAgeIndicator(ageDays);

	return (
		<>
			{/* Number */}
			<span className="w-10 shrink-0 text-2xs font-mono text-muted-foreground">
				#{card.number}
			</span>

			{/* Priority dot */}
			<span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`} />

			{/* Title + tags */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm">{card.title}</span>
					{tags.length > 0 && (
						<div className="hidden shrink-0 items-center gap-1 sm:flex">
							{tags.slice(0, 2).map((tag) => (
								<span
									key={tag}
									className="rounded-full border border-border px-1.5 text-[0.625rem] leading-4 text-muted-foreground"
								>
									{tag}
								</span>
							))}
							{tags.length > 2 && (
								<span className="text-[0.625rem] text-muted-foreground">
									+{tags.length - 2}
								</span>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Metadata icons */}
			<div className="flex shrink-0 items-center gap-3 text-muted-foreground">
				{blockedByCount > 0 && (
					<span
						className={`flex items-center gap-0.5 ${STATUS_TEXT.blocked}`}
						title={`Blocked by ${blockedByCount}`}
					>
						<Ban className="h-3 w-3" />
					</span>
				)}
				{aging && (
					<span
						className={`flex items-center gap-0.5 ${aging.className}`}
						title={`Last updated ${ageDays}d ago`}
					>
						<Clock className="h-3 w-3" />
						<span className="text-2xs">{aging.label}</span>
					</span>
				)}
				{checklistTotal > 0 && (
					<span
						className={`flex items-center gap-1.5 ${
							checklistDone === checklistTotal ? STATUS_TEXT.done : ""
						}`}
						title={`${checklistDone}/${checklistTotal} checklist items`}
					>
						<CheckSquare className="h-3 w-3 shrink-0" />
						<span className="flex items-center gap-1.5">
							<span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
								<span
									className={`block h-full rounded-full transition-all ${
										checklistDone === checklistTotal ? "bg-emerald-500" : "bg-primary/50"
									}`}
									style={{ width: `${(checklistDone / checklistTotal) * 100}%` }}
								/>
							</span>
							<span className="text-2xs tabular-nums">{checklistDone}/{checklistTotal}</span>
						</span>
					</span>
				)}
				{card._count.comments > 0 && (
					<span
						className="flex items-center gap-0.5"
						title={`${card._count.comments} comments`}
					>
						<MessageSquare className="h-3 w-3" />
					</span>
				)}
			</div>

			{/* Status column */}
			<span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
				{card.columnName}
			</span>
		</>
	);
}
