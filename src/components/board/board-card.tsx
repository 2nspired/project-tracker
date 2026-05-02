"use client";

import { Ban, CheckSquare, Clock, MessageSquare, MoonStar, Sparkles, X } from "lucide-react";

import { ActorDot } from "@/components/ui/actor-dot";
import { getAccentBorderStyle, getActorIdentity } from "@/lib/actor-colors";
import { PRIORITY_BORDER, STATUS_TEXT } from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import { formatScore, scoreColor } from "@/lib/work-next-score";
import { useIntentBanner } from "./intent-banner-context";

type BoardCardProps = {
	card: {
		id: string;
		number: number;
		title: string;
		priority: string;
		tags: string[];
		createdBy: string;
		updatedAt: Date;
		lastEditedBy: string | null;
		checklists: Array<{ completed: boolean }>;
		_count: { comments: number };
		_blockedByCount?: number;
		_workNextScore?: number;
		stale?: { days: number; lastSignalAt: string };
	};
	showScore?: boolean;
	onClick: () => void;
};

const AUTHORSHIP_PILL_WINDOW_MS = 30 * 60 * 1000;

function getAgeDays(updatedAt: Date): number {
	return Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
}

function getAgeIndicator(days: number): { className: string; label: string } | null {
	if (days >= 7) return { className: "text-warning", label: `${days}d` };
	if (days >= 3) return { className: "text-yellow-500", label: `${days}d` };
	return null;
}

function formatRelativeTime(ms: number): string {
	if (ms < 60_000) return "just now";
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h`;
}

function getAuthorshipPill(
	lastEditedBy: string | null,
	updatedAt: Date
): { isHuman: boolean; name: string; relative: string; tooltip: string } | null {
	if (!lastEditedBy) return null;
	const updated = new Date(updatedAt);
	const elapsed = Date.now() - updated.getTime();
	if (elapsed < 0 || elapsed >= AUTHORSHIP_PILL_WINDOW_MS) return null;
	const isHuman = lastEditedBy === "HUMAN";
	const name = isHuman ? "Human" : lastEditedBy;
	return {
		isHuman,
		name,
		relative: formatRelativeTime(elapsed),
		tooltip: `Last edited by ${name} at ${updated.toLocaleString()}`,
	};
}

export function BoardCard({ card, showScore, onClick }: BoardCardProps) {
	const tags = card.tags;
	const priority = card.priority as Priority;
	const checklistTotal = card.checklists.length;
	const checklistDone = card.checklists.filter((c) => c.completed).length;
	const blockedByCount = card._blockedByCount ?? 0;
	const ageDays = getAgeDays(card.updatedAt);
	// Stalled In-Progress takes precedence over the generic aging clock —
	// it's a more specific, column-aware signal that this card has gone
	// silent (no activity, comments, commits, or checklist changes).
	const aging = card.stale ? null : getAgeIndicator(ageDays);
	const authorship = getAuthorshipPill(card.lastEditedBy, card.updatedAt);
	const { banner, dismiss } = useIntentBanner(card.id);
	const bannerColor = banner ? getActorIdentity(banner.actorType, banner.actorName).color : null;

	return (
		// biome-ignore lint/a11y/useSemanticElements: nested banner/buttons forbid converting outer to <button>
		<div
			role="button"
			tabIndex={0}
			data-card-id={card.id}
			className={`relative cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md hover:ring-1 hover:ring-ring/20 ${card.stale ? "opacity-60" : ""} ${priority !== "NONE" ? `border-l-[3px] ${PRIORITY_BORDER[priority]}` : ""}`}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick();
				}
			}}
		>
			{banner && bannerColor && (
				<button
					type="button"
					className="mb-2 flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-2xs text-foreground/80"
					style={getAccentBorderStyle(bannerColor, {
						hasIntent: true,
						withBackground: true,
					})}
					onClick={(e) => {
						e.stopPropagation();
						dismiss();
					}}
					title="Click to dismiss"
				>
					<ActorDot actorType={banner.actorType} actorName={banner.actorName} className="mt-1" />
					<span className="line-clamp-2 flex-1 italic">{banner.intent}</span>
					<X className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
				</button>
			)}
			<div className="space-y-2">
				<div className="flex items-start justify-between gap-2">
					<span className="text-sm font-normal leading-tight">{card.title}</span>
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

				{authorship && (
					<span
						className="inline-flex items-center gap-1.5 text-[0.625rem] leading-4 text-muted-foreground"
						title={authorship.tooltip}
					>
						<ActorDot
							actorType={authorship.isHuman ? "HUMAN" : "AGENT"}
							actorName={authorship.name}
						/>
						<span className="font-medium text-foreground/80">{authorship.name}</span>
						<span className="font-mono tabular-nums opacity-60">{authorship.relative}</span>
					</span>
				)}

				{tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{tags.slice(0, 3).map((tag) => (
							<span
								key={tag}
								className="rounded-full border border-border px-1.5 text-[0.625rem] leading-4 text-muted-foreground"
							>
								{tag}
							</span>
						))}
						{tags.length > 3 && (
							<span className="rounded-full border border-border px-1.5 text-[0.625rem] leading-4 text-muted-foreground">
								+{tags.length - 3}
							</span>
						)}
					</div>
				)}

				{(checklistTotal > 0 ||
					card._count.comments > 0 ||
					aging ||
					card.stale ||
					blockedByCount > 0) && (
					<div className="flex items-center gap-3 text-xs text-muted-foreground">
						{blockedByCount > 0 && (
							<span
								className={`flex items-center gap-0.5 ${STATUS_TEXT.blocked}`}
								title={`Blocked by ${blockedByCount} card${blockedByCount > 1 ? "s" : ""}`}
							>
								<Ban className="h-3 w-3" />
								{blockedByCount}
							</span>
						)}
						{card.stale && (
							<span
								className="flex items-center gap-0.5 text-warning"
								title={`No activity, comments, commits, or checklist changes for ${card.stale.days} days — revive, re-park, or close.`}
							>
								<MoonStar className="h-3 w-3" />
								stalled {card.stale.days}d
							</span>
						)}
						{aging && (
							<span
								className={`flex items-center gap-0.5 ${aging.className}`}
								title={`Last updated ${ageDays} days ago`}
							>
								<Clock className="h-3 w-3" />
								{aging.label}
							</span>
						)}
						{checklistTotal > 0 && (
							<span
								className={`flex items-center gap-1 ${checklistDone === checklistTotal ? STATUS_TEXT.done : ""}`}
							>
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
					</div>
				)}
			</div>
		</div>
	);
}
