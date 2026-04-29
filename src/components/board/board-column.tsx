"use client";

import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { SortMode } from "./board-toolbar";
import { CardCreateInline } from "./card-create-inline";
import { ColumnHeader } from "./column-header";
import { SortableCard } from "./sortable-card";

type ColumnCard = {
	id: string;
	number: number;
	title: string;
	priority: string;
	tags: string;
	createdBy: string;
	updatedAt: Date;
	lastEditedBy: string | null;
	checklists: Array<{ completed: boolean }>;
	_count: { comments: number };
	_workNextScore?: number;
};

type BoardColumnProps = {
	column: {
		id: string;
		name: string;
		description: string | null;
		isParking: boolean;
		cards: ColumnCard[];
	};
	boardId: string;
	sortMode: SortMode;
	onCardClick: (cardId: string) => void;
};

export function BoardColumn({ column, boardId, sortMode, onCardClick }: BoardColumnProps) {
	// Column is sortable as a unit (horizontal reorder among siblings) AND
	// droppable for cards. useSortable provides both. Parking columns are
	// pinned: not draggable, but still droppable for cards.
	const { setNodeRef, attributes, listeners, transform, transition, isDragging, isOver } =
		useSortable({
			id: column.id,
			data: { type: "column", column },
			disabled: column.isParking,
		});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	const cardIds = column.cards.map((c) => c.id);

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`flex w-84 shrink-0 flex-col rounded-lg border border-transparent p-2 transition-colors ${
				isOver && !isDragging ? "border-primary/50 bg-primary/10 shadow-sm" : "bg-muted/30"
			}`}
		>
			<ColumnHeader
				column={column}
				boardId={boardId}
				dragAttributes={column.isParking ? undefined : attributes}
				dragListeners={column.isParking ? undefined : listeners}
			/>

			<div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto pr-2">
				<SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
					{column.cards.map((card) => (
						<SortableCard
							key={card.id}
							card={card}
							showScore={sortMode === "smart"}
							onClick={() => onCardClick(card.id)}
						/>
					))}
				</SortableContext>
			</div>

			<div className="mt-2">
				<CardCreateInline columnId={column.id} boardId={boardId} />
			</div>
		</div>
	);
}
