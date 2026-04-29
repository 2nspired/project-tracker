"use client";

import { Ban } from "lucide-react";

import {
	PRIORITY_DOT,
	STATUS_BG,
	STATUS_BORDER,
	STATUS_DOT,
	STATUS_TEXT,
} from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import type { RoadmapCard } from "./roadmap-view";

export function CardChip({ card, onClick }: { card: RoadmapCard; onClick: () => void }) {
	const isDone = card.horizon === "done";
	const isBlocked = card.isBlocked && !isDone;
	const checkDone = card.checklists.filter((c) => c.completed).length;
	const checkTotal = card.checklists.length;

	return (
		<button
			type="button"
			onClick={onClick}
			className={`group flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors hover:bg-accent/50 ${
				isBlocked
					? `${STATUS_BORDER.blocked} ${STATUS_BG.blocked}`
					: isDone
						? `${STATUS_BORDER.done} ${STATUS_BG.done}`
						: "border-border bg-card"
			}`}
		>
			{/* Priority dot */}
			<div
				className={`h-1.5 w-1.5 shrink-0 rounded-full ${
					isBlocked
						? STATUS_DOT.blocked
						: isDone
							? STATUS_DOT.done
							: (PRIORITY_DOT[card.priority as Priority] ?? PRIORITY_DOT.NONE)
				}`}
			/>

			{/* Blocked icon */}
			{isBlocked && <Ban className={`h-2.5 w-2.5 shrink-0 ${STATUS_TEXT.blocked}`} />}

			{/* Card number */}
			<span className="font-mono text-2xs text-muted-foreground">#{card.number}</span>

			{/* Title */}
			<span
				className={`max-w-36 truncate text-xs ${
					isDone ? "text-muted-foreground line-through" : ""
				}`}
			>
				{card.title}
			</span>

			{/* Checklist progress */}
			{checkTotal > 0 && (
				<span
					className={`text-2xs ${
						checkDone === checkTotal ? STATUS_TEXT.done : "text-muted-foreground"
					}`}
				>
					{checkDone}/{checkTotal}
				</span>
			)}
		</button>
	);
}
