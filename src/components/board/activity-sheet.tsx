"use client";

import { useMemo, useState } from "react";
import { ActorDot } from "@/components/ui/actor-dot";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getAccentBorderStyle, getActorIdentity } from "@/lib/actor-colors";
import { formatActionVerb } from "@/lib/format-activity";
import { formatRelativeCompact } from "@/lib/format-date";
import { api } from "@/trpc/react";

type ActivitySheetProps = {
	boardId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCardClick: (cardId: string) => void;
};

type ActorFilter = "all" | "agent" | "human";

export function ActivitySheet({ boardId, open, onOpenChange, onCardClick }: ActivitySheetProps) {
	const [filter, setFilter] = useState<ActorFilter>("all");

	const { data: activities } = api.activity.listByBoard.useQuery(
		{ boardId },
		{
			enabled: open,
			refetchOnMount: "always",
			refetchInterval: open ? 10_000 : false,
		}
	);

	const filtered = useMemo(() => {
		if (!activities) return [];
		switch (filter) {
			case "agent":
				return activities.filter((a) => a.actorType === "AGENT");
			case "human":
				return activities.filter((a) => a.actorType === "HUMAN");
			default:
				return activities;
		}
	}, [activities, filter]);

	const handleEntryClick = (cardId: string) => {
		onCardClick(cardId);
		onOpenChange(false);
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col p-0 sm:max-w-md">
				<SheetHeader className="border-b px-5 py-4">
					<SheetTitle className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
						Activity
						<span className="font-mono text-2xs tabular-nums text-muted-foreground/60">
							{activities?.length ?? 0}
						</span>
					</SheetTitle>
					<div className="mt-2 flex items-center gap-1">
						<FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
							All
						</FilterChip>
						<FilterChip active={filter === "agent"} onClick={() => setFilter("agent")}>
							Agents
						</FilterChip>
						<FilterChip active={filter === "human"} onClick={() => setFilter("human")}>
							You
						</FilterChip>
					</div>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{!activities ? (
						<p className="text-xs text-muted-foreground">Loading…</p>
					) : filtered.length === 0 ? (
						<p className="text-xs text-muted-foreground">No activity matches this filter.</p>
					) : (
						<ol className="space-y-2">
							{filtered.map((activity) => {
								const { color } = getActorIdentity(activity.actorType, activity.actorName);
								const name =
									activity.actorName ?? (activity.actorType === "AGENT" ? "Agent" : "You");
								const verb = formatActionVerb(activity.action);
								const hasIntent = Boolean(activity.intent);
								return (
									<li key={activity.id}>
										<button
											type="button"
											onClick={() => handleEntryClick(activity.card.id)}
											className="group flex w-full flex-col gap-0.5 rounded-sm py-1.5 pl-3 pr-2 text-left transition-colors hover:bg-muted/40"
											style={getAccentBorderStyle(color, { hasIntent })}
										>
											<div className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
												<ActorDot actorType={activity.actorType} actorName={activity.actorName} />
												<span className="shrink-0 font-medium text-foreground">{name}</span>
												<span className="shrink-0">{verb}</span>
												<span className="shrink-0 font-mono text-2xs text-muted-foreground">
													#{activity.card.number}
												</span>
												<span className="ml-auto shrink-0 font-mono text-[0.625rem] tabular-nums text-muted-foreground/60">
													{formatRelativeCompact(new Date(activity.createdAt))}
												</span>
											</div>
											<div className="flex w-full items-baseline gap-1.5">
												<span className="truncate text-2xs text-muted-foreground/80">
													{activity.card.title}
												</span>
											</div>
											{hasIntent && activity.intent && (
												<p className="text-2xs italic text-foreground/80 line-clamp-2">
													{activity.intent}
												</p>
											)}
											{!hasIntent && activity.details && (
												<p className="text-2xs text-muted-foreground/70 line-clamp-2">
													{activity.details}
												</p>
											)}
										</button>
									</li>
								);
							})}
						</ol>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

function FilterChip({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-full px-2 py-0.5 text-2xs transition-colors ${
				active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/60"
			}`}
		>
			{children}
		</button>
	);
}
