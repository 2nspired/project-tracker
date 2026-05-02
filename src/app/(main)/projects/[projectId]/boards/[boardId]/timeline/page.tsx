"use client";

import { ArrowLeft, Clock } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoardEvents } from "@/hooks/use-board-events";
import { hasRole } from "@/lib/column-roles";
import { formatDate } from "@/lib/format-date";
import { api } from "@/trpc/react";

export default function TimelinePage({
	params,
}: {
	params: Promise<{ projectId: string; boardId: string }>;
}) {
	const { projectId, boardId } = use(params);
	const refetchInterval = useBoardEvents(boardId);

	const { data: board, isLoading } = api.board.getFull.useQuery(
		{ id: boardId },
		{ refetchInterval }
	);

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-6">
				<Skeleton className="mb-6 h-8 w-64" />
				<div className="space-y-4">
					{Array.from({ length: 5 }).map((_, i) => (
						<Skeleton key={i} className="h-20 w-full" />
					))}
				</div>
			</div>
		);
	}

	if (!board) {
		return <p className="p-8 text-center text-muted-foreground">Board not found.</p>;
	}

	// Build timeline: all cards sorted by creation date
	const allCards = board.columns
		.flatMap((col) =>
			col.cards.map((card) => ({
				...card,
				columnName: col.name,
				isParking: col.isParking,
			}))
		)
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

	// Group by date
	const grouped = new Map<string, typeof allCards>();
	for (const card of allCards) {
		const date = formatDate(card.createdAt);
		if (!grouped.has(date)) grouped.set(date, []);
		grouped.get(date)?.push(card);
	}

	const doneColumn = board.columns.find((c) => hasRole(c, "done"));
	const doneCardIds = new Set(doneColumn?.cards.map((c) => c.id) ?? []);

	return (
		<div className="container mx-auto px-4 py-6">
			<div className="mb-6 flex items-center gap-3">
				<Link href={`/projects/${projectId}/boards/${boardId}`}>
					<Button variant="ghost" size="sm">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Board
					</Button>
				</Link>
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Timeline</h1>
					<p className="text-xs text-muted-foreground">
						{board.project.name} / {board.name}
					</p>
				</div>
			</div>

			{allCards.length === 0 ? (
				<EmptyState
					icon={Clock}
					title="No cards yet"
					description="Add cards to your board to see them on the timeline."
				/>
			) : (
				<div className="relative">
					{/* Vertical line */}
					<div className="absolute left-4 top-0 h-full w-px bg-border" />

					<div className="space-y-6">
						{Array.from(grouped.entries()).map(([date, cards]) => (
							<div key={date}>
								<div className="relative mb-3 flex items-center gap-3 pl-10">
									<div className="absolute left-2.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
									<h2 className="text-sm font-semibold text-muted-foreground">{date}</h2>
								</div>
								<div className="space-y-2 pl-10">
									{cards.map((card) => {
										const tags = card.tags;
										const checkDone = card.checklists.filter((c) => c.completed).length;
										const checkTotal = card.checklists.length;
										const isDone = doneCardIds.has(card.id);

										return (
											<div
												key={card.id}
												className={`rounded-lg border p-3 transition-colors ${
													isDone ? "border-success/20 bg-success/5" : "bg-card"
												}`}
											>
												<div className="flex items-start justify-between gap-2">
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2">
															<span className="text-2xs font-mono text-muted-foreground">
																#{card.number}
															</span>
															<span
																className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}
															>
																{card.title}
															</span>
														</div>
														<div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
															<Badge
																variant={isDone ? "default" : "outline"}
																className="px-1.5 py-0 text-2xs font-normal"
															>
																{card.columnName}
															</Badge>
															{checkTotal > 0 && (
																<span className={checkDone === checkTotal ? "text-success" : ""}>
																	{checkDone}/{checkTotal} tasks
																</span>
															)}
															<span className="flex items-center gap-0.5">
																<Clock className="h-3 w-3" />
																{new Date(card.createdAt).toLocaleTimeString([], {
																	hour: "2-digit",
																	minute: "2-digit",
																})}
															</span>
														</div>
													</div>
													{tags.length > 0 && (
														<div className="flex gap-1">
															{tags.slice(0, 2).map((tag) => (
																<Badge
																	key={tag}
																	variant="outline"
																	className="px-1.5 py-0 text-2xs font-normal"
																>
																	{tag}
																</Badge>
															))}
														</div>
													)}
												</div>
											</div>
										);
									})}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
