"use client";

import {
	ArchiveRestore,
	ArchiveX,
	ArrowDown,
	ArrowUp,
	Calendar,
	GitMerge,
	MoreHorizontal,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format-date";
import { api } from "@/trpc/react";

type MilestoneRow = {
	id: string;
	name: string;
	description: string | null;
	targetDate: Date | string | null;
	state: string;
	_count: { cards: number };
	cardsByStatus: { now: number; later: number; done: number };
	_governanceHints?: {
		singletonAfterDays?: number;
		possibleMerge?: Array<{ id: string; name: string; distance: number }>;
	};
};

type MergeIntent = { fromId: string; fromName: string; preselectedIntoId?: string };

export function MilestoneManager({
	projectId,
	open,
	onClose,
}: {
	projectId: string;
	open: boolean;
	onClose: () => void;
}) {
	const utils = api.useUtils();

	const { data: milestones } = api.milestone.list.useQuery({ projectId }, { enabled: open });

	const createMilestone = api.milestone.create.useMutation({
		onSuccess: () => {
			void utils.milestone.list.invalidate({ projectId });
			toast.success("Milestone created");
		},
		onError: (e) => toast.error(e.message),
	});

	const updateMilestone = api.milestone.update.useMutation({
		onSuccess: () => {
			void utils.milestone.list.invalidate({ projectId });
			void utils.board.getFull.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteMilestone = api.milestone.delete.useMutation({
		onSuccess: () => {
			void utils.milestone.list.invalidate({ projectId });
			void utils.board.getFull.invalidate();
			toast.success("Milestone deleted");
		},
		onError: (e) => toast.error(e.message),
	});

	const reorderMilestones = api.milestone.reorder.useMutation({
		onSuccess: () => {
			void utils.milestone.list.invalidate({ projectId });
		},
	});

	const mergeMilestone = api.milestone.merge.useMutation({
		onSuccess: (data, variables) => {
			void utils.milestone.list.invalidate({ projectId });
			void utils.board.getFull.invalidate();
			const dest = milestones?.find((m) => m.id === variables.intoMilestoneId);
			toast.success(
				dest
					? `Merged into "${dest.name}" — rewrote ${data.rewroteCount} card${data.rewroteCount === 1 ? "" : "s"}`
					: `Merged — rewrote ${data.rewroteCount} card${data.rewroteCount === 1 ? "" : "s"}`
			);
		},
		onError: (e) => toast.error(e.message),
	});

	const [newName, setNewName] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [showArchived, setShowArchived] = useState(false);
	const [mergeIntent, setMergeIntent] = useState<MergeIntent | null>(null);
	const [mergeTarget, setMergeTarget] = useState<string>("");

	// Active first; archived hidden by default. The "Show archived" toggle
	// reveals the rest. Reordering operates on the visible list — archived
	// rows have no position semantics in the picker, so dropping them out is
	// safe.
	const visible = useMemo<MilestoneRow[] | undefined>(() => {
		if (!milestones) return undefined;
		const list = (milestones as MilestoneRow[]).filter((m) =>
			showArchived ? true : m.state === "active"
		);
		return list;
	}, [milestones, showArchived]);

	const archivedCount = useMemo(
		() => milestones?.filter((m) => m.state === "archived").length ?? 0,
		[milestones]
	);

	const handleCreate = () => {
		if (!newName.trim()) return;
		createMilestone.mutate({ projectId, name: newName.trim() });
		setNewName("");
	};

	const handleMove = (index: number, direction: -1 | 1) => {
		if (!visible) return;
		const newOrder = [...visible];
		const target = index + direction;
		if (target < 0 || target >= newOrder.length) return;
		[newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
		reorderMilestones.mutate({
			projectId,
			orderedIds: newOrder.map((m) => m.id),
		});
	};

	const handleArchive = (m: MilestoneRow) => {
		updateMilestone.mutate(
			{ id: m.id, data: { state: "archived" } },
			{
				onSuccess: () =>
					toast.success(`Archived "${m.name}" — hidden from picker, cards keep assignment`),
			}
		);
	};

	const handleUnarchive = (m: MilestoneRow) => {
		updateMilestone.mutate(
			{ id: m.id, data: { state: "active" } },
			{ onSuccess: () => toast.success(`Restored "${m.name}"`) }
		);
	};

	const openMergeIntent = (intent: MergeIntent) => {
		setMergeIntent(intent);
		setMergeTarget(intent.preselectedIntoId ?? "");
	};
	const closeMergeIntent = () => {
		setMergeIntent(null);
		setMergeTarget("");
	};
	const confirmMerge = () => {
		if (!mergeIntent || !mergeTarget) return;
		mergeMilestone.mutate(
			{ fromMilestoneId: mergeIntent.fromId, intoMilestoneId: mergeTarget },
			{ onSettled: () => closeMergeIntent() }
		);
	};

	return (
		<TooltipProvider delayDuration={200}>
			<Sheet open={open} onOpenChange={() => onClose()}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-lg">
					<SheetHeader>
						<SheetTitle>Manage Milestones</SheetTitle>
						<SheetDescription>
							Create, archive, and merge milestones. Archived rows stay in the schema so card
							assignments keep resolving — they just disappear from the picker.
						</SheetDescription>
					</SheetHeader>

					<div className="space-y-4 px-4 pb-6">
						{/* Create new */}
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								handleCreate();
							}}
						>
							<Input
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								placeholder="New milestone name..."
							/>
							<Button type="submit" variant="outline" size="sm" disabled={!newName.trim()}>
								<Plus className="mr-1 h-4 w-4" />
								Add
							</Button>
						</form>

						{/* Show archived toggle. Archived rows still get full counts and
						   actions; the toggle just gates whether they render at all. */}
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<Checkbox
								id="milestone-show-archived"
								checked={showArchived}
								onCheckedChange={(v) => setShowArchived(v === true)}
							/>
							<Label
								htmlFor="milestone-show-archived"
								className="cursor-pointer text-xs font-normal text-muted-foreground"
							>
								Show archived
								{archivedCount > 0 && (
									<span className="ml-1 text-muted-foreground/70">({archivedCount})</span>
								)}
							</Label>
						</div>

						{/* List */}
						<div className="space-y-2">
							{visible?.map((ms, i) => (
								<div
									key={ms.id}
									className={`rounded-lg border bg-card p-3 ${ms.state === "archived" ? "opacity-60" : ""}`}
								>
									{editingId === ms.id ? (
										<MilestoneEditForm
											milestone={ms}
											onSave={(data) => {
												updateMilestone.mutate({ id: ms.id, data });
												setEditingId(null);
											}}
											onCancel={() => setEditingId(null)}
										/>
									) : (
										<MilestoneRowView
											milestone={ms}
											isFirst={i === 0}
											isLast={i === (visible?.length ?? 0) - 1}
											onMoveUp={() => handleMove(i, -1)}
											onMoveDown={() => handleMove(i, 1)}
											onEdit={() => setEditingId(ms.id)}
											onArchive={() => handleArchive(ms)}
											onUnarchive={() => handleUnarchive(ms)}
											onMerge={(preselectedIntoId) =>
												openMergeIntent({
													fromId: ms.id,
													fromName: ms.name,
													preselectedIntoId,
												})
											}
											onDelete={() => {
												if (
													confirm(
														`Delete milestone "${ms.name}"? Cards will be unassigned. Prefer Archive if you want history preserved.`
													)
												) {
													deleteMilestone.mutate({ id: ms.id });
												}
											}}
										/>
									)}
								</div>
							))}

							{visible?.length === 0 && (
								<EmptyState
									icon={Calendar}
									title={
										milestones && milestones.length > 0
											? "All milestones are archived"
											: "No milestones yet"
									}
									description={
										milestones && milestones.length > 0
											? "Toggle 'Show archived' above to see them."
											: "Create one above to organize your roadmap."
									}
									className="py-6"
								/>
							)}
						</div>
					</div>
				</SheetContent>
			</Sheet>

			<MergeDialog
				intent={mergeIntent}
				peers={(milestones as MilestoneRow[] | undefined) ?? []}
				selected={mergeTarget}
				onSelectedChange={setMergeTarget}
				onCancel={closeMergeIntent}
				onConfirm={confirmMerge}
				pending={mergeMilestone.isPending}
			/>
		</TooltipProvider>
	);
}

function MilestoneRowView({
	milestone: ms,
	isFirst,
	isLast,
	onMoveUp,
	onMoveDown,
	onEdit,
	onArchive,
	onUnarchive,
	onMerge,
	onDelete,
}: {
	milestone: MilestoneRow;
	isFirst: boolean;
	isLast: boolean;
	onMoveUp: () => void;
	onMoveDown: () => void;
	onEdit: () => void;
	onArchive: () => void;
	onUnarchive: () => void;
	onMerge: (preselectedIntoId?: string) => void;
	onDelete: () => void;
}) {
	const isArchived = ms.state === "archived";
	const hints = ms._governanceHints;
	const possibleMerge = hints?.possibleMerge ?? [];

	return (
		<div className="flex items-center gap-2">
			<div className="flex flex-col gap-0.5">
				<Button
					variant="ghost"
					size="icon"
					className="h-5 w-5"
					onClick={onMoveUp}
					disabled={isFirst}
				>
					<ArrowUp className="h-3 w-3" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-5 w-5"
					onClick={onMoveDown}
					disabled={isLast}
				>
					<ArrowDown className="h-3 w-3" />
				</Button>
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<p className="text-sm font-medium truncate">{ms.name}</p>
					{isArchived && (
						<Badge variant="secondary" className="text-2xs h-5 px-1.5">
							Archived
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>{ms._count.cards} cards</span>
					{ms.targetDate && (
						<span className="flex items-center gap-1">
							<Calendar className="h-3 w-3" />
							{formatDate(ms.targetDate)}
						</span>
					)}
				</div>
				{ms.description && <p className="mt-1 text-xs text-muted-foreground">{ms.description}</p>}
				{/* Governance hints — surface inline so a human running triage sees
				   the same signals the MCP listMilestones response carries. */}
				{(hints?.singletonAfterDays !== undefined || possibleMerge.length > 0) && (
					<div className="mt-1 flex flex-wrap items-center gap-1.5">
						{hints?.singletonAfterDays !== undefined && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Badge variant="outline" className="text-2xs h-5 px-1.5">
										Singleton ({hints.singletonAfterDays}d)
									</Badge>
								</TooltipTrigger>
								<TooltipContent>
									Only one card after {hints.singletonAfterDays} days. Consider whether this
									milestone is still earning its keep.
								</TooltipContent>
							</Tooltip>
						)}
						{possibleMerge.map((peer) => (
							<Tooltip key={peer.id}>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => onMerge(peer.id)}
										className="inline-flex h-5 items-center gap-1 rounded-md border border-dashed border-warning/40 bg-warning/5 px-1.5 text-2xs font-medium text-warning transition-colors hover:border-warning/60 hover:bg-warning/10"
									>
										<GitMerge className="h-2.5 w-2.5" />
										Near-miss: {peer.name}
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Edit distance {peer.distance}. Click to merge into {peer.name}.
								</TooltipContent>
							</Tooltip>
						))}
					</div>
				)}
			</div>
			<div className="flex items-center gap-1">
				<Badge variant="outline" className="text-2xs">
					{ms.cardsByStatus.done}/{ms._count.cards} done
				</Badge>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
							<Pencil className="h-3 w-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Edit name / target date</TooltipContent>
				</Tooltip>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7">
									<MoreHorizontal className="h-3 w-3" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent>More actions</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" className="w-48">
						<DropdownMenuItem onClick={() => onMerge()}>
							<GitMerge className="mr-2 h-3.5 w-3.5" />
							Merge into…
						</DropdownMenuItem>
						{isArchived ? (
							<DropdownMenuItem onClick={onUnarchive}>
								<ArchiveRestore className="mr-2 h-3.5 w-3.5" />
								Unarchive
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem onClick={onArchive}>
								<ArchiveX className="mr-2 h-3.5 w-3.5" />
								Archive
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={onDelete}
							className="text-destructive focus:text-destructive"
						>
							<Trash2 className="mr-2 h-3.5 w-3.5" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

function MergeDialog({
	intent,
	peers,
	selected,
	onSelectedChange,
	onCancel,
	onConfirm,
	pending,
}: {
	intent: MergeIntent | null;
	peers: MilestoneRow[];
	selected: string;
	onSelectedChange: (id: string) => void;
	onCancel: () => void;
	onConfirm: () => void;
	pending: boolean;
}) {
	// Exclude the source from the destination list. Allow merging into
	// archived milestones — that's a legitimate consolidation pattern when
	// you've already retired one of the duplicates.
	const candidates = peers.filter((p) => p.id !== intent?.fromId);

	return (
		<AlertDialog open={!!intent} onOpenChange={(o) => !o && onCancel()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Merge milestone</AlertDialogTitle>
					<AlertDialogDescription>
						Move every card from <strong>{intent?.fromName}</strong> onto another milestone. The
						source milestone is deleted on success.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="space-y-2 py-2">
					<Label className="text-xs">Merge into</Label>
					<Select value={selected} onValueChange={onSelectedChange}>
						<SelectTrigger>
							<SelectValue placeholder="Pick a destination milestone…" />
						</SelectTrigger>
						<SelectContent>
							{candidates.length === 0 ? (
								<div className="px-2 py-3 text-xs text-muted-foreground">
									No other milestones in this project.
								</div>
							) : (
								candidates.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										<span>{p.name}</span>
										<span className="ml-2 text-xs text-muted-foreground">
											{p._count.cards} card{p._count.cards === 1 ? "" : "s"}
											{p.state === "archived" ? " · archived" : ""}
										</span>
									</SelectItem>
								))
							)}
						</SelectContent>
					</Select>
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} disabled={!selected || pending}>
						Merge
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function MilestoneEditForm({
	milestone,
	onSave,
	onCancel,
}: {
	milestone: { name: string; description: string | null; targetDate: Date | string | null };
	onSave: (data: {
		name?: string;
		description?: string | null;
		targetDate?: string | null;
	}) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(milestone.name);
	const [description, setDescription] = useState(milestone.description ?? "");
	const [targetDate, setTargetDate] = useState(
		milestone.targetDate ? new Date(milestone.targetDate).toISOString().split("T")[0] : ""
	);

	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<Label className="text-xs">Name</Label>
				<Input value={name} onChange={(e) => setName(e.target.value)} />
			</div>
			<div className="space-y-1">
				<Label className="text-xs">Description</Label>
				<Textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					rows={2}
					placeholder="Optional description..."
				/>
			</div>
			<div className="space-y-1">
				<Label className="text-xs">Target Date</Label>
				<Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
			</div>
			<div className="flex gap-2">
				<Button
					size="sm"
					onClick={() =>
						onSave({
							name: name.trim() || undefined,
							description: description.trim() || null,
							targetDate: targetDate ? new Date(targetDate).toISOString() : null,
						})
					}
				>
					Save
				</Button>
				<Button variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
