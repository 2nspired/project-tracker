"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { BoardCard } from "./board-card";

type SortableCardProps = {
	card: {
		id: string;
		number: number;
		title: string;
		priority: string;
		tags: string;
		assignee: string | null;
		createdBy: string;
		updatedAt: Date;
		checklists: Array<{ completed: boolean }>;
		_count: { comments: number };
		_workNextScore?: number;
	};
	showScore?: boolean;
	onClick: () => void;
};

export function SortableCard({ card, showScore, onClick }: SortableCardProps) {
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
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div ref={setNodeRef} style={style} {...attributes} {...listeners}>
			<BoardCard card={card} showScore={showScore} onClick={onClick} />
		</div>
	);
}
