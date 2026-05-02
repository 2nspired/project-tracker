"use client";

import { Check, GitMerge, Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";

type TagRow = {
	id: string;
	slug: string;
	label: string;
	state: "active" | "archived";
	_count: { cardTags: number };
	_governanceHints?: {
		singleton?: true;
		possibleMerge?: Array<{ id: string; label: string; distance: number }>;
	};
};

type MergeIntent = { fromId: string; fromLabel: string; preselectedIntoId?: string };
type DeleteIntent = { id: string; label: string };

export function TagManager({
	projectId,
	open,
	onClose,
}: {
	projectId: string;
	open: boolean;
	onClose: () => void;
}) {
	const utils = api.useUtils();

	// `state` defaults server-side to "active". No UI to archive a tag yet
	// (schema column is forward-compat for #170 follow-ups), so we don't
	// expose a toggle — it would just be a control over an unreachable state.
	const { data: tags } = api.tag.list.useQuery({ projectId }, { enabled: open });

	const createTag = api.tag.create.useMutation({
		onSuccess: () => {
			void utils.tag.list.invalidate({ projectId });
			toast.success("Tag created");
		},
		onError: (e) => toast.error(e.message),
	});

	const renameTag = api.tag.rename.useMutation({
		onSuccess: () => {
			void utils.tag.list.invalidate({ projectId });
			toast.success("Tag renamed");
		},
		onError: (e) => toast.error(e.message),
	});

	const mergeTags = api.tag.merge.useMutation({
		onSuccess: (data) => {
			void utils.tag.list.invalidate({ projectId });
			void utils.board.getFull.invalidate();
			const skipped = data.skippedDuplicates;
			toast.success(
				skipped > 0
					? `Merged: ${data.rewroteCount} rewrote, ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped`
					: `Merged ${data.rewroteCount} card${data.rewroteCount === 1 ? "" : "s"}`
			);
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteTag = api.tag.delete.useMutation({
		onSuccess: () => {
			void utils.tag.list.invalidate({ projectId });
			toast.success("Tag deleted");
		},
		onError: (e) => toast.error(e.message),
	});

	const [newLabel, setNewLabel] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [mergeIntent, setMergeIntent] = useState<MergeIntent | null>(null);
	const [mergeTarget, setMergeTarget] = useState<string>("");
	const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);

	const openMergeIntent = (intent: MergeIntent) => {
		setMergeIntent(intent);
		setMergeTarget(intent.preselectedIntoId ?? "");
	};
	const closeMergeIntent = () => {
		setMergeIntent(null);
		setMergeTarget("");
	};

	// Sort: usage desc, then label asc. High-usage tags rise to the top so
	// the agent immediately sees the "real" vocabulary; singletons and
	// near-misses sink to the bottom where they invite review/merge.
	const sortedTags = useMemo(() => {
		if (!tags) return undefined;
		return [...tags].sort((a, b) => {
			const usageDelta = b._count.cardTags - a._count.cardTags;
			if (usageDelta !== 0) return usageDelta;
			return a.label.localeCompare(b.label);
		});
	}, [tags]);

	const handleCreate = () => {
		const trimmed = newLabel.trim();
		if (!trimmed) return;
		createTag.mutate({ projectId, label: trimmed });
		setNewLabel("");
	};

	const confirmMerge = () => {
		if (!mergeIntent || !mergeTarget) return;
		mergeTags.mutate(
			{ fromTagId: mergeIntent.fromId, intoTagId: mergeTarget },
			{ onSettled: () => closeMergeIntent() }
		);
	};

	const confirmDelete = () => {
		if (!deleteIntent) return;
		deleteTag.mutate({ tagId: deleteIntent.id }, { onSettled: () => setDeleteIntent(null) });
	};

	return (
		<TooltipProvider delayDuration={200}>
			<Sheet open={open} onOpenChange={() => onClose()}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-lg">
					<SheetHeader>
						<SheetTitle>Manage Tags</SheetTitle>
						<SheetDescription>
							Tags are project-scoped. Sorted by usage; near-duplicates surface a merge hint.
						</SheetDescription>
					</SheetHeader>

					<div className="space-y-4 px-4 pb-6">
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								handleCreate();
							}}
						>
							<Input
								value={newLabel}
								onChange={(e) => setNewLabel(e.target.value)}
								placeholder="New tag label..."
								maxLength={50}
							/>
							<Button
								type="submit"
								variant="outline"
								size="sm"
								disabled={!newLabel.trim() || createTag.isPending}
							>
								<Plus className="mr-1 h-4 w-4" />
								Add
							</Button>
						</form>

						<div className="space-y-2">
							{sortedTags?.map((tag) => (
								<TagRowView
									key={tag.id}
									tag={tag}
									isEditing={editingId === tag.id}
									onStartEdit={() => setEditingId(tag.id)}
									onCancelEdit={() => setEditingId(null)}
									onRename={(label) => {
										renameTag.mutate(
											{ tagId: tag.id, label },
											{ onSettled: () => setEditingId(null) }
										);
									}}
									onMerge={(preselectedIntoId) =>
										openMergeIntent({
											fromId: tag.id,
											fromLabel: tag.label,
											preselectedIntoId,
										})
									}
									onDelete={() => setDeleteIntent({ id: tag.id, label: tag.label })}
								/>
							))}

							{sortedTags?.length === 0 && (
								<EmptyState
									icon={TagIcon}
									title="No tags yet"
									description="Create one above, or add tags to cards via the tag combobox."
									className="py-6"
								/>
							)}
						</div>
					</div>
				</SheetContent>
			</Sheet>

			<MergeDialog
				intent={mergeIntent}
				peers={sortedTags ?? []}
				selected={mergeTarget}
				onSelectedChange={setMergeTarget}
				onCancel={closeMergeIntent}
				onConfirm={confirmMerge}
				pending={mergeTags.isPending}
			/>

			<DeleteDialog
				intent={deleteIntent}
				onCancel={() => setDeleteIntent(null)}
				onConfirm={confirmDelete}
				pending={deleteTag.isPending}
			/>
		</TooltipProvider>
	);
}

function TagRowView({
	tag,
	isEditing,
	onStartEdit,
	onCancelEdit,
	onRename,
	onMerge,
	onDelete,
}: {
	tag: TagRow;
	isEditing: boolean;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onRename: (label: string) => void;
	onMerge: (preselectedIntoId?: string) => void;
	onDelete: () => void;
}) {
	const isOrphan = tag._count.cardTags === 0;
	const hints = tag._governanceHints;
	const possibleMerge = hints?.possibleMerge ?? [];

	if (isEditing) {
		return (
			<div className="rounded-lg border bg-card p-3">
				<TagEditForm tag={tag} onSave={onRename} onCancel={onCancelEdit} />
			</div>
		);
	}

	return (
		<div className="rounded-lg border bg-card p-3">
			<div className="flex items-center gap-2">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<p className="text-sm font-medium truncate">{tag.label}</p>
						<span className="text-xs text-muted-foreground font-mono">{tag.slug}</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						<span>
							{tag._count.cardTags} card{tag._count.cardTags === 1 ? "" : "s"}
						</span>
						{hints?.singleton && (
							<Badge variant="outline" className="text-2xs h-5 px-1.5">
								Singleton
							</Badge>
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
										Near-miss: {peer.label}
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Edit distance {peer.distance}. Click to merge into {peer.label}.
								</TooltipContent>
							</Tooltip>
						))}
					</div>
				</div>

				<div className="flex items-center gap-0.5">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStartEdit}>
								<Pencil className="h-3 w-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Rename</TooltipContent>
					</Tooltip>

					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMerge()}>
								<GitMerge className="h-3 w-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Merge into another tag…</TooltipContent>
					</Tooltip>

					<Tooltip>
						<TooltipTrigger asChild>
							{/* Span wrapper lets the tooltip render even when the button is disabled. */}
							<span>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7 text-destructive disabled:pointer-events-none"
									disabled={!isOrphan}
									onClick={onDelete}
								>
									<Trash2 className="h-3 w-3" />
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent>
							{isOrphan ? "Delete tag" : "Tag is in use — merge it into another tag first."}
						</TooltipContent>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}

function TagEditForm({
	tag,
	onSave,
	onCancel,
}: {
	tag: { label: string; slug: string };
	onSave: (label: string) => void;
	onCancel: () => void;
}) {
	const [label, setLabel] = useState(tag.label);
	const trimmed = label.trim();
	const dirty = trimmed.length > 0 && trimmed !== tag.label;

	return (
		<form
			className="space-y-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (dirty) onSave(trimmed);
			}}
		>
			<div className="space-y-1">
				<Label className="text-xs">Label</Label>
				<Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={50} autoFocus />
				<p className="text-2xs text-muted-foreground">
					Slug <span className="font-mono">{tag.slug}</span> is immutable. To change it, create a
					new tag and merge.
				</p>
			</div>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={!dirty}>
					<Check className="mr-1 h-3 w-3" />
					Save
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					<X className="mr-1 h-3 w-3" />
					Cancel
				</Button>
			</div>
		</form>
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
	peers: TagRow[];
	selected: string;
	onSelectedChange: (id: string) => void;
	onCancel: () => void;
	onConfirm: () => void;
	pending: boolean;
}) {
	const candidates = peers.filter((p) => p.id !== intent?.fromId);

	return (
		<AlertDialog open={!!intent} onOpenChange={(o) => !o && onCancel()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Merge tag</AlertDialogTitle>
					<AlertDialogDescription>
						Move every card from <strong>{intent?.fromLabel}</strong> onto another tag. The source
						tag is deleted on success. Cards already carrying both tags keep just the destination.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="space-y-2 py-2">
					<Label className="text-xs">Merge into</Label>
					<Select value={selected} onValueChange={onSelectedChange}>
						<SelectTrigger>
							<SelectValue placeholder="Pick a destination tag…" />
						</SelectTrigger>
						<SelectContent>
							{candidates.length === 0 ? (
								<div className="px-2 py-3 text-xs text-muted-foreground">
									No other tags in this project.
								</div>
							) : (
								candidates.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										<span>{p.label}</span>
										<span className="ml-2 text-xs text-muted-foreground">
											{p._count.cardTags} card{p._count.cardTags === 1 ? "" : "s"}
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

function DeleteDialog({
	intent,
	onCancel,
	onConfirm,
	pending,
}: {
	intent: DeleteIntent | null;
	onCancel: () => void;
	onConfirm: () => void;
	pending: boolean;
}) {
	return (
		<AlertDialog open={!!intent} onOpenChange={(o) => !o && onCancel()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete tag</AlertDialogTitle>
					<AlertDialogDescription>
						Permanently delete <strong>{intent?.label}</strong>. This is allowed because the tag has
						zero card associations. If a card picks the tag up after you opened this dialog, the
						delete will be rejected — refresh and merge instead.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} disabled={pending}>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
