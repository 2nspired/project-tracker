"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

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
	const { setNodeRef, isOver } = useDroppable({
		id: column.id,
		data: { type: "column", column },
	});

	const cardIds = column.cards.map((c) => c.id);

	return (
		<div
			className={`flex w-84 shrink-0 flex-col rounded-lg border border-transparent p-2 transition-colors ${
				isOver ? "border-primary/50 bg-primary/10 shadow-sm" : "bg-muted/30"
			}`}
		>
			<ColumnHeader column={column} boardId={boardId} />

			<div
				ref={setNodeRef}
				className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto pr-2"
			>
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
