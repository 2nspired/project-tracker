"use client";

import { Activity, Bot, ChevronDown, ChevronUp, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatRelativeCompact } from "@/lib/format-date";
import { api } from "@/trpc/react";

type ActivityStripProps = {
	boardId: string;
	selectedCardId: string | null;
	onCardClick: (cardId: string) => void;
};

type ActorFilter = "all" | "agent" | "human" | "card";

const COLLAPSE_STORAGE_KEY = "activity-strip:collapsed";

export function ActivityStrip({ boardId, selectedCardId, onCardClick }: ActivityStripProps) {
	const [collapsed, setCollapsed] = useState(false);
	const [filter, setFilter] = useState<ActorFilter>("all");

	useEffect(() => {
		const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
		if (stored === "1") setCollapsed(true);
	}, []);

	useEffect(() => {
		window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
	}, [collapsed]);

	// Switching to "card" filter without a selection falls back to all.
	useEffect(() => {
		if (filter === "card" && !selectedCardId) setFilter("all");
	}, [filter, selectedCardId]);

	const { data: activities } = api.activity.listByBoard.useQuery({ boardId });

	const filtered = useMemo(() => {
		if (!activities) return [];
		switch (filter) {
			case "agent":
				return activities.filter((a) => a.actorType === "AGENT");
			case "human":
				return activities.filter((a) => a.actorType === "HUMAN");
			case "card":
				return selectedCardId
					? activities.filter((a) => a.card.id === selectedCardId)
					: activities;
			default:
				return activities;
		}
	}, [activities, filter, selectedCardId]);

	const handleEntryClick = (cardId: string) => {
		onCardClick(cardId);
		// Briefly highlight the targeted card. Scrolling handles mid-screen
		// columns; the ring fades after the timeout.
		const el = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
		el.classList.add("ring-2", "ring-primary", "ring-offset-2");
		window.setTimeout(() => {
			el.classList.remove("ring-2", "ring-primary", "ring-offset-2");
		}, 1500);
	};

	const count = activities?.length ?? 0;

	return (
		<div className="shrink-0 border-t bg-background">
			<div className="flex items-center justify-between px-3 py-1.5">
				<div className="flex items-center gap-2">
					<Activity className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-xs font-semibold">Activity</span>
					<span className="text-2xs text-muted-foreground">({count})</span>
					<div className="ml-2 hidden items-center gap-1 sm:flex">
						<FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
							All
						</FilterChip>
						<FilterChip active={filter === "agent"} onClick={() => setFilter("agent")}>
							Agent
						</FilterChip>
						<FilterChip active={filter === "human"} onClick={() => setFilter("human")}>
							Human
						</FilterChip>
						<FilterChip
							active={filter === "card"}
							disabled={!selectedCardId}
							onClick={() => selectedCardId && setFilter("card")}
						>
							This card
						</FilterChip>
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 gap-1 px-2 text-2xs"
					onClick={() => setCollapsed((v) => !v)}
				>
					{collapsed ? (
						<>
							<ChevronUp className="h-3 w-3" />
							Show
						</>
					) : (
						<>
							<ChevronDown className="h-3 w-3" />
							Hide
						</>
					)}
				</Button>
			</div>

			{!collapsed && (
				<div className="flex h-16 gap-2 overflow-x-auto px-3 pb-2">
					{filtered.length === 0 ? (
						<div className="flex flex-1 items-center text-2xs text-muted-foreground">
							No activity matches this filter.
						</div>
					) : (
						filtered.map((activity) => (
							<button
								key={activity.id}
								type="button"
								onClick={() => handleEntryClick(activity.card.id)}
								className="flex h-full min-w-56 max-w-64 shrink-0 flex-col items-start gap-0.5 rounded-md border bg-card px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
							>
								<div className="flex w-full items-center gap-1.5">
									{activity.actorType === "AGENT" ? (
										<Bot className="h-3 w-3 shrink-0 text-violet-500" />
									) : (
										<User className="h-3 w-3 shrink-0 text-muted-foreground" />
									)}
									<span className="truncate text-2xs font-medium">
										{activity.actorName ??
											(activity.actorType === "AGENT" ? "Agent" : "Human")}
									</span>
									<span className="ml-auto shrink-0 text-2xs text-muted-foreground/60">
										{formatRelativeCompact(new Date(activity.createdAt))}
									</span>
								</div>
								<span className="line-clamp-1 text-2xs text-muted-foreground">
									{activity.details ?? activity.action}
								</span>
								<span className="truncate text-2xs text-muted-foreground/70">
									#{activity.card.number} {activity.card.title}
								</span>
							</button>
						))
					)}
				</div>
			)}
		</div>
	);
}

function FilterChip({
	active,
	disabled,
	onClick,
	children,
}: {
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={`rounded-full border px-2 py-0.5 text-2xs transition-colors ${
				active
					? "border-primary bg-primary/10 text-primary"
					: "border-border text-muted-foreground hover:bg-muted/50"
			} ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
		>
			{children}
		</button>
	);
}
