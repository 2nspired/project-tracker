"use client";

import { useState } from "react";
import { Ban, Bot, LayoutList, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CardDetailSheet } from "@/components/board/card-detail-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { HORIZON_DOT, PRIORITY_BADGE, STATUS_BG, STATUS_TEXT } from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import type { MilestoneGroup, RoadmapCard } from "./roadmap-view";

function StatusDot({ horizon }: { horizon: string }) {
	return <div className={`h-2 w-2 rounded-full ${HORIZON_DOT[horizon] ?? HORIZON_DOT.later}`} />;
}

export function DetailRows({
	milestones,
	boardId,
}: {
	milestones: MilestoneGroup[];
	boardId: string;
}) {
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

	if (milestones.length === 0) {
		return (
			<EmptyState icon={LayoutList} title="No cards on this board yet" description="Create cards on your board to see them in the roadmap." className="py-8" />
		);
	}

	return (
		<>
			<div className="space-y-4">
				{milestones.map((milestone) => {
					const pct = milestone.total > 0 ? Math.round((milestone.done / milestone.total) * 100) : 0;

					const order = { now: 0, next: 1, later: 2, done: 3 };
					const sorted = [...milestone.cards].sort(
						(a, b) => order[a.horizon] - order[b.horizon],
					);

					return (
						<div
							key={milestone.id ?? "__ungrouped__"}
							className="rounded-lg border bg-card"
						>
							{/* Milestone header */}
							<div className="flex items-center justify-between border-b px-4 py-2.5">
								<div className="flex items-center gap-2">
									<h3 className="text-sm font-semibold">{milestone.name}</h3>
									<Badge variant="outline" className="text-2xs font-normal">
										{milestone.total} cards
									</Badge>
								</div>
								<div className="flex items-center gap-2">
									<div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
										<div
											className="h-full rounded-full bg-emerald-500 transition-all"
											style={{ width: `${pct}%` }}
										/>
									</div>
									<span className="text-xs tabular-nums text-muted-foreground">
										{pct}%
									</span>
								</div>
							</div>

							{/* Table */}
							<div className="overflow-x-auto">
								<table className="w-full text-xs">
									<thead>
										<tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
											<th className="px-4 py-2 w-8">#</th>
											<th className="px-2 py-2">Title</th>
											<th className="px-2 py-2 w-28">Status</th>
											<th className="px-2 py-2 w-20">Priority</th>
											<th className="px-2 py-2 w-20">Assignee</th>
											<th className="px-2 py-2 w-16">Tasks</th>
										</tr>
									</thead>
									<tbody>
										{sorted.map((card) => {
											const checkDone = card.checklists.filter((c) => c.completed).length;
											const checkTotal = card.checklists.length;
											const isDone = card.horizon === "done";
											const isBlocked = card.isBlocked && !isDone;

											return (
												<tr
													key={card.id}
													onClick={() => setSelectedCardId(card.id)}
													className={`cursor-pointer border-b last:border-0 transition-colors hover:bg-muted/50 ${
														isBlocked ? STATUS_BG.blocked : isDone ? STATUS_BG.done : ""
													}`}
												>
													<td className="px-4 py-2 font-mono text-muted-foreground">
														{card.number}
													</td>
													<td className={`px-2 py-2 font-medium ${isDone ? "text-muted-foreground line-through" : ""}`}>
														<span className="flex items-center gap-1.5">
															{isBlocked && <Ban className={`h-3 w-3 shrink-0 ${STATUS_TEXT.blocked}`} />}
															{card.title}
														</span>
													</td>
													<td className="px-2 py-2">
														<div className="flex items-center gap-1.5">
															<StatusDot horizon={card.horizon} />
															<span className="text-muted-foreground">{card.columnName}</span>
														</div>
													</td>
													<td className="px-2 py-2">
														{card.priority !== "NONE" && (
															<Badge
																variant="outline"
																className={`px-1.5 py-0 text-2xs font-normal ${PRIORITY_BADGE[card.priority as Priority] ?? PRIORITY_BADGE.NONE}`}
															>
																{card.priority}
															</Badge>
														)}
													</td>
													<td className="px-2 py-2">
														{card.assignee && (
															<div className="flex items-center gap-1 text-muted-foreground">
																{card.assignee === "AGENT" ? (
																	<Bot className="h-3.5 w-3.5 text-violet-500" />
																) : (
																	<User className="h-3 w-3" />
																)}
																<span>{card.assignee === "AGENT" ? "Agent" : "Human"}</span>
															</div>
														)}
													</td>
													<td className="px-2 py-2 text-muted-foreground">
														{checkTotal > 0 && (
															<span className={checkDone === checkTotal ? STATUS_TEXT.done : ""}>
																{checkDone}/{checkTotal}
															</span>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</div>
					);
				})}
			</div>

			<CardDetailSheet
				cardId={selectedCardId}
				boardId={boardId}
				onClose={() => setSelectedCardId(null)}
			/>
		</>
	);
}
