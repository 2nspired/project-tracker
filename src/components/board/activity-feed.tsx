"use client";

import { Activity, Bot, ChevronRight, User, X } from "lucide-react";
import { useState } from "react";

import { formatRelativeCompact } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";

type ActivityFeedProps = {
	boardId: string;
	onCardClick: (cardId: string) => void;
};

export function ActivityFeedToggle({ boardId, onCardClick }: ActivityFeedProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="h-8 gap-1.5 text-xs"
				onClick={() => setOpen(!open)}
			>
				<Activity className="h-3.5 w-3.5" />
				Activity
			</Button>

			{open && (
				<ActivityFeedPanel
					boardId={boardId}
					onCardClick={onCardClick}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}

function ActivityFeedPanel({
	boardId,
	onCardClick,
	onClose,
}: ActivityFeedProps & { onClose: () => void }) {
	const { data: activities } = api.activity.listByBoard.useQuery({ boardId });

	return (
		<div className="fixed right-0 top-14 z-40 flex h-[calc(100dvh-3.5rem)] w-80 flex-col border-l bg-background shadow-lg">
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2">
					<Activity className="h-4 w-4" />
					<h3 className="text-sm font-semibold">Activity Feed</h3>
				</div>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="sm" onClick={onClose}>
							<X className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Close activity feed</TooltipContent>
				</Tooltip>
			</div>

			<div className="flex-1 overflow-y-auto">
				{!activities || activities.length === 0 ? (
					<EmptyState icon={Activity} title="No activity yet" description="Activity will appear here as cards are created and moved" className="py-8" />
				) : (
					<div className="divide-y">
						{activities.map((activity) => (
							<button
								key={activity.id}
								type="button"
								className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
								onClick={() => onCardClick(activity.card.id)}
							>
								<div className="mt-0.5 shrink-0">
									{activity.actorType === "AGENT" ? (
										<Bot className="h-3.5 w-3.5 text-violet-500" />
									) : (
										<User className="h-4 w-4 text-muted-foreground" />
									)}
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-xs">
										<span className="font-medium">
											{activity.actorName ??
												(activity.actorType === "AGENT" ? "Claude" : "You")}
										</span>{" "}
										<span className="text-muted-foreground">
											{activity.details ?? activity.action}
										</span>
									</p>
									<div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
										<span className="truncate font-mono">
											#{activity.card.number}
										</span>
										<span className="truncate">{activity.card.title}</span>
									</div>
									<span className="text-2xs text-muted-foreground/60">
										{formatRelativeCompact(new Date(activity.createdAt))}
									</span>
								</div>
								<ChevronRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/40" />
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}