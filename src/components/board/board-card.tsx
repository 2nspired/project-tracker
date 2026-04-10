"use client";

import { Ban, Bot, CheckSquare, Clock, MessageSquare, Sparkles, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Priority } from "@/lib/schemas/card-schemas";
import { PRIORITY_BORDER, STATUS_TEXT } from "@/lib/priority-colors";
import { formatScore, scoreColor } from "@/lib/work-next-score";

type BoardCardProps = {
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
		_blockedByCount?: number;
		_workNextScore?: number;
	};
	showScore?: boolean;
	onClick: () => void;
};

function getAgeDays(updatedAt: Date): number {
	return Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
}

function getAgeIndicator(days: number): { className: string; label: string } | null {
	if (days >= 7) return { className: "text-orange-500", label: `${days}d` };
	if (days >= 3) return { className: "text-yellow-500", label: `${days}d` };
	return null;
}

export function BoardCard({ card, showScore, onClick }: BoardCardProps) {
	const tags: string[] = JSON.parse(card.tags);
	const priority = card.priority as Priority;
	const checklistTotal = card.checklists.length;
	const checklistDone = card.checklists.filter((c) => c.completed).length;
	const blockedByCount = card._blockedByCount ?? 0;
	const ageDays = getAgeDays(card.updatedAt);
	const aging = getAgeIndicator(ageDays);

	return (
		<div
			role="button"
			tabIndex={0}
			className={`cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md hover:ring-1 hover:ring-ring/20 ${priority !== "NONE" ? `border-l-[3px] ${PRIORITY_BORDER[priority]}` : ""}`}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick();
				}
			}}
		>
			<div className="space-y-2">
				<div className="flex items-start justify-between gap-2">
					<span className="text-sm font-medium leading-tight">{card.title}</span>
					<div className="flex shrink-0 items-center gap-1.5">
						{showScore && card._workNextScore !== undefined && (
							<span
								className={`flex items-center gap-0.5 text-2xs font-mono tabular-nums ${scoreColor(card._workNextScore)}`}
								title={`Work-next score: ${card._workNextScore}`}
							>
								<Sparkles className="h-2.5 w-2.5" />
								{formatScore(card._workNextScore)}
							</span>
						)}
						<span className="text-2xs font-mono text-muted-foreground">#{card.number}</span>
					</div>
				</div>

				{tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{tags.slice(0, 3).map((tag) => (
							<Badge key={tag} variant="outline" className="px-1.5 py-0 text-2xs font-normal">
								{tag}
							</Badge>
						))}
						{tags.length > 3 && (
							<Badge variant="outline" className="px-1.5 py-0 text-2xs font-normal">
								+{tags.length - 3}
							</Badge>
						)}
					</div>
				)}

				{(checklistTotal > 0 || card._count.comments > 0 || card.assignee || aging || blockedByCount > 0) && (
					<div className="flex items-center gap-3 text-xs text-muted-foreground">
						{blockedByCount > 0 && (
							<span className={`flex items-center gap-0.5 ${STATUS_TEXT.blocked}`} title={`Blocked by ${blockedByCount} card${blockedByCount > 1 ? "s" : ""}`}>
								<Ban className="h-3 w-3" />
								{blockedByCount}
							</span>
						)}
						{aging && (
							<span className={`flex items-center gap-0.5 ${aging.className}`} title={`Last updated ${ageDays} days ago`}>
								<Clock className="h-3 w-3" />
								{aging.label}
							</span>
						)}
						{checklistTotal > 0 && (
							<span className={`flex items-center gap-1 ${checklistDone === checklistTotal ? STATUS_TEXT.done : ""}`}>
								<CheckSquare className="h-3 w-3" />
								{checklistDone}/{checklistTotal}
							</span>
						)}
						{card._count.comments > 0 && (
							<span className="flex items-center gap-1">
								<MessageSquare className="h-3 w-3" />
								{card._count.comments}
							</span>
						)}
						{card.assignee && (
							<span className="ml-auto">
								{card.assignee === "AGENT" ? (
									<Bot className="h-3.5 w-3.5 text-violet-500" />
								) : (
									<User className="h-3.5 w-3.5" />
								)}
							</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
