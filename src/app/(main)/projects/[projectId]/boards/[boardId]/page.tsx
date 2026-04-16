"use client";

import { ArrowLeft, Bot, BrainCircuit, Clock, Columns3, List, Map, NotebookPen, Pencil, Users } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { ActivityFeedToggle } from "@/components/board/activity-feed";
import { BoardListView } from "@/components/board/board-list-view";
import { type BoardFilters, type SortMode, emptyFilters } from "@/components/board/board-toolbar";
import { BoardView } from "@/components/board/board-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { BoardView as BoardViewType } from "@/lib/board-views";
import { useBoardEvents } from "@/hooks/use-board-events";
import { api } from "@/trpc/react";

function EditableBoardName({ boardId, name }: { boardId: string; name: string }) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(name);
	const inputRef = useRef<HTMLInputElement>(null);
	const utils = api.useUtils();

	const updateBoard = api.board.update.useMutation({
		onSuccess: () => {
			utils.board.getFull.invalidate();
			setEditing(false);
			toast.success("Board renamed");
		},
		onError: (e) => toast.error(e.message),
	});

	const handleSave = () => {
		const trimmed = value.trim();
		if (!trimmed || trimmed === name) {
			setValue(name);
			setEditing(false);
			return;
		}
		updateBoard.mutate({ id: boardId, data: { name: trimmed } });
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") handleSave();
		if (e.key === "Escape") {
			setValue(name);
			setEditing(false);
		}
	};

	if (editing) {
		return (
			<div className="flex items-center gap-1">
				<Input
					ref={inputRef}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={handleKeyDown}
					onBlur={handleSave}
					className="h-7 w-48 text-lg font-semibold"
					autoFocus
				/>
			</div>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => {
						setEditing(true);
						setValue(name);
					}}
					className="group flex items-center gap-1.5 text-left"
				>
					<h1 className="text-lg font-semibold">{name}</h1>
					<Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
				</button>
			</TooltipTrigger>
			<TooltipContent>Rename board</TooltipContent>
		</Tooltip>
	);
}

export default function BoardPage({
	params,
}: {
	params: Promise<{ projectId: string; boardId: string }>;
}) {
	const { projectId, boardId } = use(params);

	const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
	const [showHandoffs, setShowHandoffs] = useState(false);
	const [showScratch, setShowScratch] = useState(false);
	const refetchInterval = useBoardEvents(boardId);

	// Lifted filter state — shared across kanban and list views
	const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
	const [sortMode, setSortMode] = useState<SortMode>("manual");
	const [hiddenRoles, setHiddenRoles] = useState<string[]>([]);
	const [activeViewId, setActiveViewId] = useState<string | null>(null);

	const handleViewChange = useCallback((view: BoardViewType | null) => {
		if (view) {
			setFilters(view.filters);
			setSortMode(view.sortMode);
			setHiddenRoles(view.hiddenRoles);
			setActiveViewId(view.id);
		} else {
			setFilters(emptyFilters);
			setSortMode("manual");
			setHiddenRoles([]);
			setActiveViewId(null);
		}
	}, []);

	const { data: board, isLoading } = api.board.getFull.useQuery(
		{ id: boardId },
		{ refetchInterval }
	);

	if (isLoading) {
		return (
			<div className="flex h-full flex-col">
				<div className="border-b px-4 py-3">
					<Skeleton className="h-6 w-48" />
				</div>
				<div className="flex flex-1 gap-4 p-4">
					{Array.from({ length: 3 }).map((_, i) => (
						<Skeleton key={i} className="h-96 w-72 shrink-0" />
					))}
				</div>
			</div>
		);
	}

	if (!board) {
		return (
			<div className="flex items-center justify-center py-16">
				<p className="text-muted-foreground">Board not found.</p>
			</div>
		);
	}

	const viewProps = {
		filters,
		onFiltersChange: setFilters,
		sortMode,
		onSortModeChange: setSortMode,
		hiddenRoles,
		onHiddenRolesChange: setHiddenRoles,
		activeViewId,
		onViewChange: handleViewChange,
	};

	return (
		<TooltipProvider>
			<div className="flex h-[calc(100dvh-3.5rem-1px)] flex-col">
				<div className="flex items-center gap-3 border-b px-4 py-2">
					<Tooltip>
						<TooltipTrigger asChild>
							<Link href={`/projects/${projectId}`}>
								<Button variant="ghost" size="sm">
									<ArrowLeft className="mr-2 h-4 w-4" />
									Back
								</Button>
							</Link>
						</TooltipTrigger>
						<TooltipContent>Return to project</TooltipContent>
					</Tooltip>
					<div className="flex-1">
						<EditableBoardName boardId={board.id} name={board.name} />
						<p className="text-xs text-muted-foreground">{board.project.name}</p>
					</div>
					<div className="flex items-center rounded-md border">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant={viewMode === "kanban" ? "secondary" : "ghost"}
									size="sm"
									className="h-8 rounded-r-none border-0 px-2"
									onClick={() => setViewMode("kanban")}
								>
									<Columns3 className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Board view</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant={viewMode === "list" ? "secondary" : "ghost"}
									size="sm"
									className="h-8 rounded-l-none border-0 px-2"
									onClick={() => setViewMode("list")}
								>
									<List className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>List view</TooltipContent>
						</Tooltip>
					</div>
					<Tooltip>
						<TooltipTrigger asChild>
							<Link href={`/projects/${projectId}?tab=notes&from=${boardId}`}>
								<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
									<NotebookPen className="h-3.5 w-3.5" />
									Notes
								</Button>
							</Link>
						</TooltipTrigger>
						<TooltipContent>Project notes and documentation</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Link href={`/projects/${projectId}/boards/${boardId}/roadmap`}>
								<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
									<Map className="h-3.5 w-3.5" />
									Roadmap
								</Button>
							</Link>
						</TooltipTrigger>
						<TooltipContent>View milestone roadmap</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Link href={`/projects/${projectId}/boards/${boardId}/timeline`}>
								<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
									<Clock className="h-3.5 w-3.5" />
									Timeline
								</Button>
							</Link>
						</TooltipTrigger>
						<TooltipContent>View card timeline</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={showHandoffs ? "secondary" : "outline"}
								size="sm"
								className="h-8 gap-1.5 text-xs"
								onClick={() => { setShowHandoffs(!showHandoffs); if (!showHandoffs) setShowScratch(false); }}
							>
								<Users className="h-3.5 w-3.5" />
								Sessions
							</Button>
						</TooltipTrigger>
						<TooltipContent>View agent work sessions</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={showScratch ? "secondary" : "outline"}
								size="sm"
								className="h-8 gap-1.5 text-xs"
								onClick={() => { setShowScratch(!showScratch); if (!showScratch) setShowHandoffs(false); }}
							>
								<BrainCircuit className="h-3.5 w-3.5" />
								Agent Notes
							</Button>
						</TooltipTrigger>
						<TooltipContent>Notes from AI agents</TooltipContent>
					</Tooltip>
					<ActivityFeedToggle boardId={board.id} onCardClick={() => {}} />
				</div>
				{showHandoffs && <SessionHistoryPanel boardId={board.id} />}
				{showScratch && <AgentNotesPanel boardId={board.id} />}
				{viewMode === "kanban"
					? <BoardView board={board} {...viewProps} />
					: <BoardListView board={board} {...viewProps} />
				}
			</div>
		</TooltipProvider>
	);
}

// ─── Session History Panel ────────────────────────────────────────

function SessionHistoryPanel({ boardId }: { boardId: string }) {
	const { data: handoffs } = api.handoff.list.useQuery({ boardId, limit: 10 });

	if (!handoffs || handoffs.length === 0) {
		return (
			<div className="border-b bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
				No agent sessions recorded yet.
			</div>
		);
	}

	return (
		<div className="max-h-48 overflow-y-auto border-b bg-muted/30">
			<div className="space-y-0 divide-y">
				{handoffs.map(
					(h: {
						id: string;
						agentName: string;
						summary: string;
						workingOn: string[];
						findings: string[];
						nextSteps: string[];
						blockers: string[];
						createdAt: Date;
					}) => (
						<div key={h.id} className="px-4 py-2">
							<div className="flex items-center gap-2">
								<Bot className="h-3.5 w-3.5 text-violet-500" />
								<span className="text-xs font-medium">{h.agentName}</span>
								<span className="text-2xs text-muted-foreground">
									{new Date(h.createdAt).toLocaleString(undefined, {
										month: "short",
										day: "numeric",
										hour: "2-digit",
										minute: "2-digit",
									})}
								</span>
							</div>
							{h.summary && (
								<p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{h.summary}</p>
							)}
							<div className="mt-1 flex flex-wrap gap-1">
								{h.workingOn.length > 0 && (
									<Badge variant="outline" className="text-2xs px-1 py-0">
										{h.workingOn.length} worked on
									</Badge>
								)}
								{h.nextSteps.length > 0 && (
									<Badge variant="outline" className="text-2xs px-1 py-0">
										{h.nextSteps.length} next steps
									</Badge>
								)}
								{h.blockers.length > 0 && (
									<Badge
										variant="outline"
										className="text-2xs px-1 py-0 text-red-500 border-red-500/20"
									>
										{h.blockers.length} blockers
									</Badge>
								)}
							</div>
						</div>
					)
				)}
			</div>
		</div>
	);
}

// ─── Agent Notes Panel ───────────────────────────────────────────

function AgentNotesPanel({ boardId }: { boardId: string }) {
	const { data: entries } = api.scratch.list.useQuery({ boardId });

	if (!entries || entries.length === 0) {
		return (
			<div className="border-b bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
				No agent notes yet.
			</div>
		);
	}

	// Group by agent name
	type ScratchEntry = (typeof entries)[number];
	const byAgent: Record<string, ScratchEntry[]> = {};
	for (const entry of entries) {
		(byAgent[entry.agentName] ??= []).push(entry);
	}

	return (
		<div className="max-h-48 overflow-y-auto border-b bg-muted/30">
			<div className="space-y-0 divide-y">
				{Object.entries(byAgent).map(([agent, notes]) => (
					<div key={agent} className="px-4 py-2">
						<div className="flex items-center gap-2">
							<BrainCircuit className="h-3.5 w-3.5 text-cyan-500" />
							<span className="text-xs font-medium">{agent}</span>
							<span className="text-2xs text-muted-foreground">
								{notes.length} {notes.length === 1 ? "note" : "notes"}
							</span>
						</div>
						<div className="mt-1 space-y-0.5">
							{notes.map((note) => (
								<div key={note.id} className="flex items-baseline gap-2">
									<span className="shrink-0 font-mono text-2xs text-cyan-500/70">{note.key}</span>
									<span className="text-xs text-muted-foreground line-clamp-1">{note.value}</span>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
