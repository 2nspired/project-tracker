"use client";

import {
	BookOpen,
	CheckSquare,
	ExternalLink,
	Loader2,
	Rocket,
	Search,
	Target,
	X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BoardHygienePanel } from "@/components/dashboard/board-hygiene-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getHorizon } from "@/lib/column-roles";
import { PRIORITY_DOT } from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import { api } from "@/trpc/react";

export default function DashboardPage() {
	const [search, setSearch] = useState("");
	const [priority, setPriority] = useState("ALL");

	const utils = api.useUtils();

	const seedTutorial = api.project.seedTutorial.useMutation({
		onSuccess: () => {
			utils.project.list.invalidate();
			utils.card.listAll.invalidate();
		},
	});

	const { data: cards, isLoading } = api.card.listAll.useQuery({
		search: search || undefined,
		priority: priority !== "ALL" ? priority : undefined,
	});

	const hasFilters = search !== "" || priority !== "ALL";
	const PREVIEW_COUNT = 5;

	// Compute all derived data
	const { stats, focusCards, grouped } = useMemo(() => {
		type CardItem = NonNullable<typeof cards>[number];
		type MilestoneEntry = { name: string; cells: Array<"done" | "now" | "later"> };
		type ProjectStat = {
			name: string;
			id: string;
			done: number;
			total: number;
			milestones: MilestoneEntry[];
		};
		type GroupEntry = {
			projectName: string;
			projectId: string;
			boardId: string;
			cards: CardItem[];
		};
		if (!cards)
			return { stats: null, focusCards: [] as CardItem[], grouped: new Map<string, GroupEntry>() };

		// Stats by horizon
		const horizonCounts = { now: 0, later: 0, done: 0 };
		// Per-project stats (including milestones)
		const projectStats = new Map<string, ProjectStat>();
		// Per-project milestone maps
		const projectMilestones = new Map<string, Map<string, MilestoneEntry>>();
		// Focus cards (active/review)
		const focus: CardItem[] = [];
		// Group by project
		const groups = new Map<string, GroupEntry>();

		for (const card of cards) {
			const horizon = getHorizon(card.column);
			horizonCounts[horizon]++;

			// Project stats — get-or-create so the local binding stays narrowed.
			const pId = card.column.board.project.id;
			const pName = card.column.board.project.name;
			let ps = projectStats.get(pId);
			let msMap = projectMilestones.get(pId);
			if (!ps || !msMap) {
				ps = { name: pName, id: pId, done: 0, total: 0, milestones: [] };
				msMap = new Map();
				projectStats.set(pId, ps);
				projectMilestones.set(pId, msMap);
			}
			ps.total++;
			if (horizon === "done") ps.done++;

			// Focus
			if (horizon === "now") focus.push(card);

			// Milestones per project
			if (card.milestone) {
				if (!msMap.has(card.milestone.id))
					msMap.set(card.milestone.id, { name: card.milestone.name, cells: [] });
				msMap.get(card.milestone.id)?.cells.push(horizon);
			}

			// Group by project
			if (!groups.has(pId))
				groups.set(pId, {
					projectName: pName,
					projectId: pId,
					boardId: card.column.board.id,
					cards: [],
				});
			groups.get(pId)?.cards.push(card);
		}

		// Attach sorted milestones to each project. The msMap loop only ever
		// fires for project IDs we registered above, so projectStats always has
		// a hit — but bail safely on the impossible case rather than `!`-asserting.
		const cellOrder = { done: 0, now: 1, later: 2 };
		for (const [pId, msMap] of projectMilestones) {
			const ps = projectStats.get(pId);
			if (!ps) continue;
			ps.milestones = Array.from(msMap.values())
				.filter((m) => m.cells.length > 1)
				.map((m) => {
					m.cells.sort((a, b) => cellOrder[a] - cellOrder[b]);
					return m;
				})
				.sort((a, b) => {
					const aDone = a.cells.filter((c) => c === "done").length / a.cells.length;
					const bDone = b.cells.filter((c) => c === "done").length / b.cells.length;
					return bDone - aDone;
				});
		}

		// Sort cards in each group: priority desc, then most recently updated
		const priorityOrder: Record<string, number> = {
			URGENT: 0,
			HIGH: 1,
			MEDIUM: 2,
			LOW: 3,
			NONE: 4,
		};
		for (const group of groups.values()) {
			group.cards.sort((a, b) => {
				const pDiff = (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
				if (pDiff !== 0) return pDiff;
				return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
			});
		}

		return {
			stats: { ...horizonCounts, projects: Array.from(projectStats.values()) },
			focusCards: focus,
			grouped: groups,
		};
	}, [cards]);

	return (
		<div className="container mx-auto px-4 py-6">
			<div className="mb-6">
				<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
				<p className="text-sm text-muted-foreground">All cards across every project</p>
			</div>

			{/* ─── Stats Strip ─────────────────────────────────────── */}
			{stats && cards && cards.length > 0 && (
				<div className="mb-6 space-y-4">
					{/* Horizon counts */}
					<div className="grid grid-cols-3 gap-3">
						<div className="rounded-lg border bg-card p-3">
							<div className="text-xs font-medium text-muted-foreground">Active</div>
							<div className="mt-1 text-2xl font-bold">{stats.now}</div>
						</div>
						<div className="rounded-lg border bg-card p-3">
							<div className="text-xs font-medium text-muted-foreground">Backlog</div>
							<div className="mt-1 text-2xl font-bold">{stats.later}</div>
						</div>
						<div className="rounded-lg border bg-card p-3">
							<div className="text-xs font-medium text-muted-foreground">Done</div>
							<div className="mt-1 text-2xl font-bold text-success">{stats.done}</div>
						</div>
					</div>

					{/* Per-project progress with stacked milestone bar */}
					<div className="space-y-3">
						{stats.projects.map((p) => {
							const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
							// Cards not in any milestone
							const milestonedCount = p.milestones.reduce((sum, m) => sum + m.cells.length, 0);
							const unmilestoned = p.total - milestonedCount;

							// Green shades for done portions, gray shades for remaining
							const greens = [
								"bg-emerald-500",
								"bg-emerald-400",
								"bg-teal-500",
								"bg-green-500",
								"bg-emerald-600",
								"bg-teal-400",
							];
							const grays = [
								"bg-zinc-600",
								"bg-zinc-500",
								"bg-neutral-600",
								"bg-stone-600",
								"bg-zinc-700",
								"bg-neutral-500",
							];

							return (
								<div key={p.id} className="rounded-lg border bg-card p-4">
									<div className="mb-1 flex items-center justify-between">
										<span className="text-sm font-medium">{p.name}</span>
										<span className="text-xs text-muted-foreground">
											{p.done}/{p.total} done · {pct}%
										</span>
									</div>

									{p.milestones.length > 0 ? (
										<>
											{/* Stacked milestone bar */}
											<div className="mt-2 flex h-5 w-full overflow-hidden rounded">
												{p.milestones.map((ms, idx) => {
													const done = ms.cells.filter((c) => c === "done").length;
													const remaining = ms.cells.length - done;
													const donePct = (done / p.total) * 100;
													const remainPct = (remaining / p.total) * 100;
													const green = greens[idx % greens.length];
													const gray = grays[idx % grays.length];

													return (
														<Tooltip key={ms.name}>
															<TooltipTrigger asChild>
																<div className="flex" style={{ width: `${donePct + remainPct}%` }}>
																	{donePct > 0 && (
																		<div
																			className={`${green} h-full transition-[width]`}
																			style={{
																				width: `${(donePct / (donePct + remainPct)) * 100}%`,
																			}}
																		/>
																	)}
																	{remainPct > 0 && (
																		<div
																			className={`${gray} h-full transition-[width]`}
																			style={{
																				width: `${(remainPct / (donePct + remainPct)) * 100}%`,
																			}}
																		/>
																	)}
																</div>
															</TooltipTrigger>
															<TooltipContent side="bottom" className="text-xs">
																<p className="font-medium">{ms.name}</p>
																<p className="text-muted-foreground">
																	{done}/{ms.cells.length} done
																</p>
															</TooltipContent>
														</Tooltip>
													);
												})}
												{unmilestoned > 0 && (
													<Tooltip>
														<TooltipTrigger asChild>
															<div
																className="bg-muted-foreground/15 h-full"
																style={{ width: `${(unmilestoned / p.total) * 100}%` }}
															/>
														</TooltipTrigger>
														<TooltipContent side="bottom" className="text-xs">
															<p className="font-medium">No milestone</p>
															<p className="text-muted-foreground">{unmilestoned} cards</p>
														</TooltipContent>
													</Tooltip>
												)}
											</div>
										</>
									) : (
										<Progress value={pct} className="mt-2 h-2" />
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* ─── Focus Section ───────────────────────────────────── */}
			{focusCards.length > 0 && !hasFilters && (
				<div className="mb-6">
					<div className="mb-3 flex items-center gap-2">
						<Target className="h-4 w-4 text-warning" />
						<h2 className="text-sm font-semibold">Focus — In Progress & Review</h2>
						<span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-2xs font-medium text-warning">
							{focusCards.length}
						</span>
					</div>
					<div className="divide-y rounded-lg border border-warning/20 bg-warning/[0.03]">
						{focusCards.map((card) => {
							const tags = card.tags;
							const checkTotal = card.checklists.length;
							const checkDone = card.checklists.filter((c) => c.completed).length;
							return (
								<div
									key={card.id}
									className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-warning/[0.05]"
								>
									<div
										className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[card.priority as Priority] ?? PRIORITY_DOT.NONE}`}
										title={card.priority}
									/>
									<span className="shrink-0 font-mono text-2xs text-muted-foreground">
										#{card.number}
									</span>
									<div className="min-w-0 flex-1">
										<span className="text-sm font-medium">{card.title}</span>
										<div className="flex items-center gap-2 text-2xs text-muted-foreground">
											<span>{card.column.name}</span>
											<span>in {card.column.board.project.name}</span>
										</div>
									</div>
									{checkTotal > 0 && (
										<span className="flex items-center gap-1 text-2xs text-muted-foreground">
											<CheckSquare className="h-3 w-3" />
											{checkDone}/{checkTotal}
										</span>
									)}
									{tags.length > 0 && (
										<div className="hidden gap-1 sm:flex">
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
									<Link
										href={`/projects/${card.column.board.project.id}/boards/${card.column.board.id}`}
										className="shrink-0"
									>
										<ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
									</Link>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* ─── Board Hygiene Panel (#173) ─────────────────────── */}
			{/* Renders below Focus; recessive vs. Pulse — hygiene is */}
			{/* weekly cleanup work, not flow work. Self-hides on cold */}
			{/* mount until at least one signal has loaded.            */}
			{!hasFilters && cards && cards.length > 0 && <BoardHygienePanel />}

			{/* ─── Filters ────────────────────────────────────────── */}
			<div className="mb-4 flex items-center gap-3">
				<div className="relative w-64">
					<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search cards..."
						className="h-8 pl-8 text-sm"
					/>
				</div>

				<Select value={priority} onValueChange={setPriority}>
					<SelectTrigger className="h-8 w-32 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ALL">All priorities</SelectItem>
						<SelectItem value="URGENT">Urgent</SelectItem>
						<SelectItem value="HIGH">High</SelectItem>
						<SelectItem value="MEDIUM">Medium</SelectItem>
						<SelectItem value="LOW">Low</SelectItem>
						<SelectItem value="NONE">None</SelectItem>
					</SelectContent>
				</Select>

				{hasFilters && (
					<Button
						variant="ghost"
						size="sm"
						className="h-8 px-2 text-xs"
						onClick={() => {
							setSearch("");
							setPriority("ALL");
						}}
					>
						<X className="mr-1 h-3 w-3" />
						Clear
					</Button>
				)}

				{cards && (
					<span className="ml-auto text-xs text-muted-foreground">
						{cards.length} card{cards.length !== 1 ? "s" : ""}
					</span>
				)}
			</div>

			{/* ─── Card List ──────────────────────────────────────── */}
			{isLoading ? (
				<div className="space-y-6">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{Array.from({ length: 4 }).map((_, i) => (
							<div key={i} className="rounded-lg border bg-card p-3">
								<Skeleton className="h-3 w-16" />
								<Skeleton className="mt-2 h-7 w-12" />
							</div>
						))}
					</div>
					<div className="space-y-3">
						{Array.from({ length: 3 }).map((_, i) => (
							<div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-3">
								<Skeleton className="h-2 w-2 rounded-full" />
								<Skeleton className="h-4 w-12" />
								<Skeleton className="h-4 flex-1 max-w-[200px]" />
								<Skeleton className="ml-auto h-4 w-16" />
							</div>
						))}
					</div>
				</div>
			) : grouped.size === 0 ? (
				hasFilters ? (
					<p className="py-12 text-center text-muted-foreground">No cards match your filters.</p>
				) : (
					<EmptyState
						icon={Rocket}
						title="Get started"
						description="No cards yet. Create a project and add cards, or explore the tutorial to see how everything works."
						className="py-16"
					>
						<div className="mt-3 flex items-center gap-3">
							<Link href="/projects">
								<Button>Go to Projects</Button>
							</Link>
							<Button
								variant="outline"
								onClick={() => seedTutorial.mutate()}
								disabled={seedTutorial.isPending}
							>
								{seedTutorial.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<BookOpen className="mr-2 h-4 w-4" />
								)}
								Create Tutorial Project
							</Button>
						</div>
					</EmptyState>
				)
			) : (
				<div className="space-y-6">
					{Array.from(grouped.values()).map((group) => {
						const visibleCards = group.cards.slice(0, PREVIEW_COUNT);
						const remaining = group.cards.length - PREVIEW_COUNT;

						return (
							<div key={group.projectId}>
								<div className="mb-3 flex items-center gap-2">
									<h2 className="text-sm font-semibold">{group.projectName}</h2>
									<span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
										{group.cards.length}
									</span>
								</div>
								<div className="divide-y rounded-lg border">
									{visibleCards.map((card) => {
										const tags = card.tags;
										const checkTotal = card.checklists.length;
										const checkDone = card.checklists.filter((c) => c.completed).length;
										return (
											<div
												key={card.id}
												className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
											>
												<div
													className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[card.priority as Priority] ?? PRIORITY_DOT.NONE}`}
													title={card.priority}
												/>
												<span className="shrink-0 font-mono text-2xs text-muted-foreground">
													#{card.number}
												</span>
												<div className="min-w-0 flex-1">
													<span className="text-sm font-medium">{card.title}</span>
													<div className="flex items-center gap-2 text-2xs text-muted-foreground">
														<span>{card.column.name}</span>
														<span>in {card.column.board.name}</span>
													</div>
												</div>
												{checkTotal > 0 && (
													<span className="flex items-center gap-1 text-2xs text-muted-foreground">
														<CheckSquare className="h-3 w-3" />
														{checkDone}/{checkTotal}
													</span>
												)}
												{card.milestone && (
													<Badge variant="secondary" className="px-1.5 py-0 text-2xs font-normal">
														{card.milestone.name}
													</Badge>
												)}
												{tags.length > 0 && (
													<div className="hidden gap-1 sm:flex">
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
												<Link
													href={`/projects/${group.projectId}/boards/${group.boardId}`}
													className="shrink-0"
												>
													<ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
												</Link>
											</div>
										);
									})}
									{remaining > 0 && (
										<Link
											href={`/projects/${group.projectId}/boards/${group.boardId}`}
											className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
										>
											{remaining} more card{remaining !== 1 ? "s" : ""} — View board
											<ExternalLink className="h-3 w-3" />
										</Link>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
