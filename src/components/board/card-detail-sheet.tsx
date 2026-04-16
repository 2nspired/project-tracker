"use client";

import {
	Ban,
	Bot,
	CheckSquare,
	Clock,
	FileText,
	GitCommit,
	Link2,
	Milestone as MilestoneIcon,
	MessageSquare,
	Pencil,
	Plus,
	ShieldCheck,
	Trash2,
	User,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { formatDate, formatRelativeCompact } from "@/lib/format-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PRIORITY_BADGE } from "@/lib/priority-colors";
import { priorityValues, type Priority, type ContextBudget, type CardScope, type CardScopePatch, parseCardScope, scopeSchema } from "@/lib/schemas/card-schemas";
import { api } from "@/trpc/react";

const PRIORITY_LABELS: Record<Priority, string> = {
	NONE: "No priority",
	LOW: "Low",
	MEDIUM: "Medium",
	HIGH: "High",
	URGENT: "Urgent",
};

// ─── Main Component ───────────────────────────────────────────────

type CardDetailSheetProps = {
	cardId: string | null;
	boardId: string;
	onClose: () => void;
};

export function CardDetailSheet({ cardId, boardId, onClose }: CardDetailSheetProps) {
	const utils = api.useUtils();

	const { data: card } = api.card.getById.useQuery(
		{ id: cardId! },
		{ enabled: !!cardId },
	);

	const updateCard = api.card.update.useMutation({
		onMutate: async ({ id, data }) => {
			await utils.card.getById.cancel({ id: cardId! });
			const previous = utils.card.getById.getData({ id: cardId! });

			utils.card.getById.setData({ id: cardId! }, (old) => {
				if (!old) return old;
				// Build a cache-compatible patch: tags/scope are stored as JSON strings in cache
				const { tags, scope, ...rest } = data;
				const patch: Record<string, unknown> = { ...rest };
				if (tags !== undefined) {
					patch.tags = JSON.stringify(tags);
				}
				if (scope !== undefined) {
					const existing = parseCardScope((old as { scope?: string }).scope);
					patch.scope = JSON.stringify(scopeSchema.parse({ ...existing, ...scope }));
				}
				return { ...old, ...patch } as typeof old;
			});

			return { previous };
		},
		onError: (error, _vars, context) => {
			if (context?.previous) {
				utils.card.getById.setData({ id: cardId! }, context.previous);
			}
			toast.error(error.message);
		},
		onSettled: () => {
			utils.card.getById.invalidate({ id: cardId! });
			utils.board.getFull.invalidate({ id: boardId });
		},
	});

	const deleteCard = api.card.delete.useMutation({
		onSuccess: () => {
			utils.board.getFull.invalidate({ id: boardId });
			onClose();
			toast.success("Card deleted");
		},
		onError: (error) => toast.error(error.message),
	});

	const createChecklist = api.checklist.create.useMutation({
		onSuccess: () => {
			utils.card.getById.invalidate({ id: cardId! });
			utils.board.getFull.invalidate({ id: boardId });
		},
		onError: (error) => toast.error(error.message),
	});

	const updateChecklist = api.checklist.update.useMutation({
		onMutate: async ({ id: checklistId, data }) => {
			await utils.card.getById.cancel({ id: cardId! });
			const previous = utils.card.getById.getData({ id: cardId! });

			utils.card.getById.setData({ id: cardId! }, (old) => {
				if (!old) return old;
				return {
					...old,
					checklists: old.checklists.map((item) =>
						item.id === checklistId
							? { ...item, ...data }
							: item
					),
				};
			});

			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) {
				utils.card.getById.setData({ id: cardId! }, context.previous);
			}
		},
		onSettled: () => {
			utils.card.getById.invalidate({ id: cardId! });
			utils.board.getFull.invalidate({ id: boardId });
		},
	});

	const deleteChecklist = api.checklist.delete.useMutation({
		onSuccess: () => {
			utils.card.getById.invalidate({ id: cardId! });
			utils.board.getFull.invalidate({ id: boardId });
		},
	});

	const createComment = api.comment.create.useMutation({
		onSuccess: () => {
			utils.card.getById.invalidate({ id: cardId! });
			utils.board.getFull.invalidate({ id: boardId });
		},
		onError: (error) => toast.error(error.message),
	});

	// Form inputs
	const [newChecklistItem, setNewChecklistItem] = useState("");
	const [newComment, setNewComment] = useState("");
	const [tagInput, setTagInput] = useState("");

	// Title: local buffer with inline edit
	const [localTitle, setLocalTitle] = useState("");
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const titleInputRef = useRef<HTMLInputElement>(null);

	// Description: preview/edit with local buffer
	const [isEditingDescription, setIsEditingDescription] = useState(false);
	const [localDescription, setLocalDescription] = useState("");
	const [descriptionPreview, setDescriptionPreview] = useState(false);
	// Sync local state when card data changes (don't overwrite mid-edit)
	const isEditingTitleRef = useRef(false);
	const isEditingDescriptionRef = useRef(false);
	isEditingTitleRef.current = isEditingTitle;
	isEditingDescriptionRef.current = isEditingDescription;

	useEffect(() => {
		if (card) {
			if (!isEditingTitleRef.current) setLocalTitle(card.title);
			if (!isEditingDescriptionRef.current) setLocalDescription(card.description ?? "");
		}
	}, [card?.id, card?.title, card?.description]);

	// Reset edit states when switching cards
	useEffect(() => {
		setIsEditingTitle(false);
		setIsEditingDescription(false);
		setDescriptionPreview(false);
	}, [cardId]);

	// ─── Handlers ─────────────────────────────────────────────────

	const handleTitleSave = useCallback(() => {
		if (!card) return;
		const trimmed = localTitle.trim();
		if (!trimmed || trimmed === card.title) {
			setLocalTitle(card.title);
			setIsEditingTitle(false);
			return;
		}
		updateCard.mutate({ id: card.id, data: { title: trimmed } });
		setIsEditingTitle(false);
	}, [localTitle, card, updateCard]);

	const handleDescriptionSave = useCallback(() => {
		if (!card) return;
		const trimmed = localDescription.trim();
		if (trimmed !== (card.description ?? "")) {
			updateCard.mutate({
				id: card.id,
				data: { description: trimmed || undefined },
			});
		}
		setIsEditingDescription(false);
	}, [localDescription, card, updateCard]);

	const handleDescriptionKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			setLocalDescription(card?.description ?? "");
			setIsEditingDescription(false);
		}
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			handleDescriptionSave();
		}
	}, [card?.description, handleDescriptionSave]);

	const tags: string[] = card ? JSON.parse(card.tags) : [];
	const scope = card ? parseCardScope(card.scope) : parseCardScope(null);

	const handleAddTag = () => {
		if (!card || !tagInput.trim()) return;
		const newTags = [...tags, tagInput.trim()];
		updateCard.mutate({ id: card.id, data: { tags: newTags } });
		setTagInput("");
	};

	const handleRemoveTag = (tag: string) => {
		if (!card) return;
		const newTags = tags.filter((t) => t !== tag);
		updateCard.mutate({ id: card.id, data: { tags: newTags } });
	};

	return (
		<Sheet open={!!cardId} onOpenChange={(open) => { if (!open) onClose(); }}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
				{!card ? (
					<div className="space-y-6 pt-6">
						<SheetHeader>
							<SheetTitle>
								<Skeleton className="h-6 w-48" />
							</SheetTitle>
						</SheetHeader>
						<div className="space-y-4">
							<div className="flex gap-3">
								<Skeleton className="h-8 w-24" />
								<Skeleton className="h-8 w-24" />
							</div>
							<Skeleton className="h-24 w-full" />
							<Skeleton className="h-4 w-32" />
							<div className="space-y-2">
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-4 w-1/2" />
							</div>
						</div>
					</div>
				) : (
				<>
				<SheetHeader className="px-6">
					<SheetTitle className="pr-6">
						<div className="flex items-center gap-2">
							<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
								#{card.number}
							</span>
							{isEditingTitle ? (
								<Input
									ref={titleInputRef}
									value={localTitle}
									onChange={(e) => setLocalTitle(e.target.value)}
									onBlur={handleTitleSave}
									onKeyDown={(e) => {
										if (e.key === "Enter") handleTitleSave();
										if (e.key === "Escape") {
											setLocalTitle(card.title);
											setIsEditingTitle(false);
										}
									}}
									className="border-0 p-0 text-lg font-semibold shadow-none focus-visible:ring-0"
									autoFocus
								/>
							) : (
								<button
									type="button"
									onClick={() => {
										setLocalTitle(card.title);
										setIsEditingTitle(true);
									}}
									className="group flex min-w-0 items-center gap-1.5 text-left"
								>
									<span className="truncate text-lg font-semibold">{card.title}</span>
									<Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
								</button>
							)}
						</div>
					</SheetTitle>
					<p className="text-xs text-muted-foreground">
						Created by {card.createdBy === "AGENT" ? "Agent" : "Human"}
						{card.assignee && (
							<>
								<span className="mx-1.5">|</span>
								Assigned to {card.assignee === "AGENT" ? "Agent" : "Human"}
							</>
						)}
					</p>
				</SheetHeader>

				<div className="space-y-8 px-6 pb-8">
					{/* Metadata badges */}
					<div className="flex flex-wrap items-center gap-2">
						{/* Priority */}
						<Select
							value={card.priority}
							onValueChange={(value) =>
								updateCard.mutate({ id: card.id, data: { priority: value as Priority } })
							}
						>
							<SelectTrigger
								className={`h-7 w-fit gap-1 rounded-full border px-2.5 text-xs font-medium shadow-none ${
									PRIORITY_BADGE[card.priority as Priority]
								}`}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{priorityValues.map((p) => (
									<SelectItem key={p} value={p}>
										{PRIORITY_LABELS[p]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						{/* Assignee */}
						<Select
							value={card.assignee ?? "NONE"}
							onValueChange={(value) =>
								updateCard.mutate({
									id: card.id,
									data: { assignee: value === "NONE" ? null : (value as "HUMAN" | "AGENT") },
								})
							}
						>
							<SelectTrigger className="h-7 w-fit gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-none">
								<SelectValue placeholder="Unassigned" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="NONE">Unassigned</SelectItem>
								<SelectItem value="HUMAN">Human</SelectItem>
								<SelectItem value="AGENT">Agent</SelectItem>
							</SelectContent>
						</Select>

						{/* Milestone */}
						<MilestoneSelector
							cardId={card.id}
							projectId={card.projectId}
							currentMilestoneId={card.milestoneId}
							boardId={boardId}
						/>
					</div>

					{/* Description */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<SectionHeader>Description</SectionHeader>
							{!isEditingDescription && card.description && (
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() => {
										setLocalDescription(card.description ?? "");
										setIsEditingDescription(true);
									}}
								>
									<Pencil className="h-3 w-3" />
								</Button>
							)}
						</div>
						{isEditingDescription ? (
							<div className="space-y-2">
								<MarkdownEditor
									content={localDescription}
									setContent={setLocalDescription}
									preview={descriptionPreview}
									setPreview={setDescriptionPreview}
									rows={6}
									placeholder="Add a description..."
									previewMinHeight="min-h-[150px]"
									onKeyDown={handleDescriptionKeyDown}
									onBlur={handleDescriptionSave}
									autoFocus
								/>
								<div className="flex items-center justify-between text-xs text-muted-foreground">
									<span>Cmd+Enter to save, Esc to cancel.</span>
									<div className="flex gap-1">
										<Button
											variant="ghost"
											size="xs"
											onMouseDown={(e) => e.preventDefault()}
											onClick={() => {
												setLocalDescription(card.description ?? "");
												setIsEditingDescription(false);
												setDescriptionPreview(false);
											}}
										>
											Cancel
										</Button>
										<Button
											variant="outline"
											size="xs"
											onMouseDown={(e) => e.preventDefault()}
											onClick={handleDescriptionSave}
										>
											Save
										</Button>
									</div>
								</div>
							</div>
						) : card.description ? (
							<div
								className="cursor-pointer rounded-md border border-transparent px-1 py-0.5 text-sm transition-colors hover:border-border hover:bg-muted/50"
								onClick={() => {
									setLocalDescription(card.description ?? "");
									setIsEditingDescription(true);
								}}
							>
								<Markdown>{card.description}</Markdown>
							</div>
						) : (
							<button
								type="button"
								className="w-full rounded-md border border-dashed border-border px-3 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50"
								onClick={() => {
									setLocalDescription("");
									setIsEditingDescription(true);
								}}
							>
								Add a description...
							</button>
						)}
					</div>

					{/* Scope Guards */}
					<ScopeSection
						key={card.id}
						scope={scope}
						onUpdate={(patch) =>
							updateCard.mutate({ id: card.id, data: { scope: patch } })
						}
					/>

					{/* Tags */}
					<div className="space-y-2">
						<SectionHeader>Tags</SectionHeader>
						<div className="flex flex-wrap gap-1">
							{tags.map((tag) => (
								<Badge
									key={tag}
									variant="secondary"
									className="cursor-pointer"
									onClick={() => handleRemoveTag(tag)}
								>
									{tag} &times;
								</Badge>
							))}
						</div>
						<div className="flex gap-2">
							<Input
								value={tagInput}
								onChange={(e) => setTagInput(e.target.value)}
								placeholder="Add tag (e.g. bug, feature:auth)"
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleAddTag();
									}
								}}
								className="text-sm"
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={handleAddTag}
								disabled={!tagInput.trim()}
							>
								Add
							</Button>
						</div>
					</div>

					{/* Dependencies */}
					<DependenciesSection cardId={card.id} boardId={boardId} />

					<div className="border-t border-border/50" />

					{/* Checklist */}
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<SectionHeader>Checklist</SectionHeader>
							{card.checklists.length > 0 && (
								<Badge variant="secondary" className="h-5 px-1.5 text-2xs">
									{card.checklists.filter((c) => c.completed).length}/{card.checklists.length}
								</Badge>
							)}
						</div>
						{card.checklists.length === 0 && (
							<p className="text-xs text-muted-foreground/60">No items yet. Add one below.</p>
						)}
						<div className="space-y-1">
							{card.checklists.map((item) => (
								<div key={item.id} className="flex items-center gap-2 py-0.5">
									<Checkbox
										checked={item.completed}
										onCheckedChange={() =>
											updateChecklist.mutate({
												id: item.id,
												data: { completed: !item.completed },
											})
										}
									/>
									<span
										className={`flex-1 text-sm ${item.completed ? "text-muted-foreground line-through" : ""}`}
									>
										{item.text}
									</span>
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => deleteChecklist.mutate({ id: item.id })}
									>
										<Trash2 className="h-3 w-3" />
									</Button>
								</div>
							))}
						</div>
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								if (!newChecklistItem.trim()) return;
								createChecklist.mutate({
									cardId: card.id,
									text: newChecklistItem.trim(),
								});
								setNewChecklistItem("");
							}}
						>
							<Input
								value={newChecklistItem}
								onChange={(e) => setNewChecklistItem(e.target.value)}
								placeholder="Add item..."
								className="text-sm"
							/>
							<Button
								type="submit"
								variant="outline"
								size="sm"
								disabled={!newChecklistItem.trim()}
							>
								<Plus className="h-4 w-4" />
							</Button>
						</form>
					</div>

					<div className="border-t border-border/50" />

					{/* Comments */}
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<SectionHeader>Comments</SectionHeader>
							{card.comments.length > 0 && (
								<Badge variant="secondary" className="h-5 px-1.5 text-2xs">
									{card.comments.length}
								</Badge>
							)}
						</div>
						{card.comments.length === 0 && (
							<p className="text-xs text-muted-foreground/60">No comments yet.</p>
						)}
						<div className="space-y-3">
							{card.comments.map((comment) => (
								<div
									key={comment.id}
									className={`rounded-lg border p-3 ${
										comment.authorType === "AGENT"
											? "border-violet-500/20 bg-violet-500/5"
											: "border-border bg-muted/50"
									}`}
								>
									<div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
										{comment.authorType === "AGENT" ? (
											<Bot className="h-3.5 w-3.5 text-violet-500" />
										) : (
											<User className="h-3.5 w-3.5" />
										)}
										<span className="font-medium">
											{comment.authorName ??
												(comment.authorType === "AGENT" ? "Claude" : "You")}
										</span>
										<span className="opacity-60">
											{formatRelativeCompact(new Date(comment.createdAt))}
										</span>
									</div>
									<div className="text-sm">
										<Markdown>{comment.content}</Markdown>
									</div>
								</div>
							))}
						</div>
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								if (!newComment.trim()) return;
								createComment.mutate({
									cardId: card.id,
									content: newComment.trim(),
									authorType: "HUMAN",
								});
								setNewComment("");
							}}
						>
							<Input
								value={newComment}
								onChange={(e) => setNewComment(e.target.value)}
								placeholder="Add a comment..."
								className="text-sm"
							/>
							<Button
								type="submit"
								variant="outline"
								size="sm"
								disabled={!newComment.trim()}
							>
								Send
							</Button>
						</form>
					</div>

					{/* Decisions */}
					<DecisionsSection cardId={card.id} projectId={card.projectId} />

					{/* Commits */}
					{card.gitLinks && card.gitLinks.length > 0 && (
						<>
							<div className="border-t border-border/50" />
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<SectionHeader>Commits</SectionHeader>
									<Badge variant="secondary" className="h-5 px-1.5 text-2xs">
										{card.gitLinks.length}
									</Badge>
								</div>
								<div className="space-y-2">
									{card.gitLinks.map((link) => {
										const filePaths: string[] = JSON.parse(link.filePaths);
										return (
											<div
												key={link.id}
												className="rounded-md border p-2.5 text-xs space-y-1"
											>
												<div className="flex items-center gap-2">
													<code className="rounded bg-muted px-1 py-0.5 text-2xs font-mono">
														{link.commitHash.slice(0, 8)}
													</code>
													<span className="truncate font-medium">{link.message}</span>
												</div>
												<div className="flex items-center gap-3 text-muted-foreground">
													<span>{link.author}</span>
													<span>{formatDate(link.commitDate)}</span>
													{filePaths.length > 0 && (
														<span>{filePaths.length} file{filePaths.length !== 1 ? "s" : ""}</span>
													)}
												</div>
											</div>
										);
									})}
								</div>
							</div>
						</>
					)}

					{/* Activity log */}
					{card.activities.length > 0 && (
						<>
							<div className="border-t border-border/50" />
							<div className="space-y-3">
								<SectionHeader>Activity</SectionHeader>
								<div className="space-y-2">
									{card.activities.map((activity) => (
										<div
											key={activity.id}
											className="flex items-start gap-2 text-xs text-muted-foreground"
										>
											<div className="mt-0.5 shrink-0">
												{activity.actorType === "AGENT" ? (
													<Bot className="h-3.5 w-3.5 text-violet-500" />
												) : (
													<User className="h-3.5 w-3.5" />
												)}
											</div>
											<div className="flex-1">
												<span className="font-medium">
													{activity.actorName ??
														(activity.actorType === "AGENT" ? "Claude" : "You")}
												</span>{" "}
												<ActivityDescription action={activity.action} details={activity.details} />
												<span className="ml-1.5 opacity-50">
													{formatRelativeCompact(new Date(activity.createdAt))}
												</span>
											</div>
										</div>
									))}
								</div>
							</div>
						</>
					)}

					{/* Delete */}
					<div className="pt-4">
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="destructive" size="sm">
									<Trash2 className="mr-2 h-4 w-4" />
									Delete Card
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete card?</AlertDialogTitle>
									<AlertDialogDescription>
										This will permanently delete card #{card.number} and all its comments, checklist items, and activity history.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										onClick={() => deleteCard.mutate({ id: card.id })}
									>
										Delete
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				</div>
				</>
				)}
			</SheetContent>
		</Sheet>
	);
}

// ─── Dependencies Section ──────────────────────────────────────────

const RELATION_LABELS: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
	blocks: { icon: <Ban className="h-3 w-3" />, label: "Blocks", color: "text-red-500" },
	blockedBy: { icon: <Ban className="h-3 w-3" />, label: "Blocked by", color: "text-orange-500" },
	relatedTo: { icon: <Link2 className="h-3 w-3" />, label: "Related", color: "text-blue-500" },
	parentOf: { icon: <Link2 className="h-3 w-3" />, label: "Parent of", color: "text-violet-500" },
	childOf: { icon: <Link2 className="h-3 w-3" />, label: "Child of", color: "text-violet-500" },
};

function DependenciesSection({ cardId, boardId }: { cardId: string; boardId: string }) {
	const utils = api.useUtils();
	const { data: relations } = api.relation.getForCard.useQuery(
		{ cardId },
		{ enabled: !!cardId },
	);

	const unlinkMutation = api.relation.unlink.useMutation({
		onSuccess: () => {
			utils.relation.getForCard.invalidate({ cardId });
			utils.board.getFull.invalidate({ id: boardId });
		},
		onError: (error) => toast.error(error.message),
	});

	if (!relations) return null;

	const groups = [
		{ key: "blocks", items: relations.blocks },
		{ key: "blockedBy", items: relations.blockedBy },
		{ key: "relatedTo", items: relations.relatedTo },
		{ key: "parentOf", items: relations.parentOf },
		{ key: "childOf", items: relations.childOf },
	].filter((g) => g.items.length > 0);

	if (groups.length === 0) return null;

	return (
		<div className="space-y-2">
			<SectionHeader>Dependencies</SectionHeader>
			<div className="space-y-2">
				{groups.map((group) => {
					const meta = RELATION_LABELS[group.key];
					if (!meta) return null;
					return (
						<div key={group.key} className="space-y-1">
							<span className={`text-xs font-medium ${meta.color}`}>
								{meta.label}
							</span>
							<div className="flex flex-wrap gap-1">
								{group.items.map((item: { id: string; number: number; title: string }) => {
									const typeMap: Record<string, string> = {
										blocks: "blocks", blockedBy: "blocks",
										relatedTo: "related", parentOf: "parent", childOf: "parent",
									};
									const relType = typeMap[group.key] ?? "related";
									const isFrom = group.key === "blocks" || group.key === "relatedTo" || group.key === "parentOf";
									return (
										<Badge
											key={item.id}
											variant="outline"
											className="cursor-pointer gap-1 pr-1"
										>
											<span className="font-mono text-2xs">#{item.number}</span>
											<span className="max-w-[120px] truncate text-xs">{item.title}</span>
											<button
												type="button"
												className="ml-0.5 rounded-sm p-0.5 hover:bg-muted"
												onClick={() => {
													unlinkMutation.mutate({
														fromCardId: isFrom ? cardId : item.id,
														toCardId: isFrom ? item.id : cardId,
														type: relType,
													});
												}}
											>
												<X className="h-2.5 w-2.5" />
											</button>
										</Badge>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ─── Decisions Section ─────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
	proposed: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
	accepted: "bg-green-500/10 text-green-600 border-green-500/20",
	rejected: "bg-red-500/10 text-red-600 border-red-500/20",
	superseded: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

function DecisionsSection({ cardId, projectId }: { cardId: string; projectId: string }) {
	const { data: decisions } = api.decision.list.useQuery(
		{ projectId, cardId },
		{ enabled: !!cardId },
	);

	if (!decisions || decisions.length === 0) return null;

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<SectionHeader>Decisions</SectionHeader>
				<Badge variant="secondary" className="h-5 px-1.5 text-2xs">
					{decisions.length}
				</Badge>
			</div>
			<div className="space-y-2">
				{decisions.map((d: { id: string; title: string; status: string; decision: string }) => (
					<div key={d.id} className="rounded-md border p-2.5">
						<div className="flex items-center gap-2">
							<Badge variant="outline" className={`text-2xs ${STATUS_COLORS[d.status] ?? ""}`}>
								{d.status}
							</Badge>
							<span className="text-sm font-medium">{d.title}</span>
						</div>
						<p className="mt-1 text-xs text-muted-foreground line-clamp-2">
							{d.decision}
						</p>
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Milestone Selector ───────────────────────────────────────────

function MilestoneSelector({
	cardId,
	projectId,
	currentMilestoneId,
	boardId,
}: {
	cardId: string;
	projectId: string;
	currentMilestoneId: string | null;
	boardId: string;
}) {
	const utils = api.useUtils();
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");

	const { data: milestones } = api.milestone.list.useQuery({ projectId });

	const updateCard = api.card.update.useMutation({
		onSuccess: () => {
			utils.card.getById.invalidate({ id: cardId });
			utils.board.getFull.invalidate({ id: boardId });
		},
		onError: (error) => toast.error(error.message),
	});

	const createMilestone = api.milestone.create.useMutation({
		onSuccess: (ms) => {
			utils.milestone.list.invalidate({ projectId });
			updateCard.mutate({ id: cardId, data: { milestoneId: ms.id } });
			setCreating(false);
			setNewName("");
		},
		onError: (error) => toast.error(error.message),
	});

	return (
		<>
			<Select
				value={currentMilestoneId ?? "__none__"}
				onValueChange={(value) => {
					if (value === "__create__") {
						setCreating(true);
						return;
					}
					updateCard.mutate({
						id: cardId,
						data: { milestoneId: value === "__none__" ? null : value },
					});
				}}
			>
				<SelectTrigger className="h-7 w-fit gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-none">
					<MilestoneIcon className="h-3 w-3 text-muted-foreground" />
					<SelectValue placeholder="No milestone" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="__none__">No milestone</SelectItem>
					{milestones?.map((ms) => (
						<SelectItem key={ms.id} value={ms.id}>
							{ms.name}
						</SelectItem>
					))}
					<SelectItem value="__create__">+ Create new...</SelectItem>
				</SelectContent>
			</Select>
			{creating && (
				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (!newName.trim()) return;
						createMilestone.mutate({ projectId, name: newName.trim() });
					}}
				>
					<Input
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						placeholder="Milestone name..."
						autoFocus
						className="text-sm"
					/>
					<Button type="submit" variant="outline" size="sm" disabled={!newName.trim()}>
						Create
					</Button>
				</form>
			)}
		</>
	);
}

// ─── Scope Section ────────────���───────────────────────────────────

function ScopeSection({
	scope,
	onUpdate,
}: {
	scope: CardScope;
	onUpdate: (patch: CardScopePatch) => void;
}) {
	const [acInput, setAcInput] = useState("");
	const [oosInput, setOosInput] = useState("");

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-1.5">
				<ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
				<SectionHeader>Scope</SectionHeader>
			</div>

			{/* Context Budget */}
			<div className="space-y-1.5">
				<span className="text-xs font-medium text-muted-foreground">Context Budget</span>
				<div>
					<Select
						value={scope.contextBudget ?? "__none__"}
						onValueChange={(value) =>
							onUpdate({ contextBudget: value === "__none__" ? null : (value as ContextBudget) })
						}
					>
						<SelectTrigger className="h-7 w-fit gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-none">
							<SelectValue placeholder="Not set" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__none__">Not set</SelectItem>
							<SelectItem value="quick-fix">Quick Fix</SelectItem>
							<SelectItem value="standard">Standard</SelectItem>
							<SelectItem value="deep-dive">Deep Dive</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* Approach Hint */}
			<div className="space-y-1.5">
				<span className="text-xs font-medium text-muted-foreground">Approach Hint</span>
				<Input
					defaultValue={scope.approachHint ?? ""}
					placeholder="e.g. Just update the CSS, no refactor needed"
					className="text-sm"
					onBlur={(e) => {
						const val = e.target.value.trim() || null;
						if (val !== (scope.approachHint ?? null)) {
							onUpdate({ approachHint: val });
						}
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							(e.target as HTMLInputElement).blur();
						}
					}}
				/>
			</div>

			{/* Acceptance Criteria */}
			<div className="space-y-1.5">
				<span className="text-xs font-medium text-muted-foreground">Acceptance Criteria</span>
				{scope.acceptanceCriteria.length > 0 && (
					<div className="space-y-1">
						{scope.acceptanceCriteria.map((item, i) => (
							<div key={i} className="flex items-center gap-2 py-0.5">
								<CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span className="flex-1 text-sm">{item}</span>
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() =>
										onUpdate({ acceptanceCriteria: scope.acceptanceCriteria.filter((_, idx) => idx !== i) })
									}
								>
									<X className="h-3 w-3" />
								</Button>
							</div>
						))}
					</div>
				)}
				<div className="flex gap-2">
					<Input
						value={acInput}
						onChange={(e) => setAcInput(e.target.value)}
						placeholder="Add acceptance criterion..."
						className="text-sm"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								if (!acInput.trim()) return;
								onUpdate({ acceptanceCriteria: [...scope.acceptanceCriteria, acInput.trim()] });
								setAcInput("");
							}
						}}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={!acInput.trim()}
						onClick={() => {
							if (!acInput.trim()) return;
							onUpdate({ acceptanceCriteria: [...scope.acceptanceCriteria, acInput.trim()] });
							setAcInput("");
						}}
					>
						Add
					</Button>
				</div>
			</div>

			{/* Out of Scope */}
			<div className="space-y-1.5">
				<span className="text-xs font-medium text-muted-foreground">Out of Scope</span>
				{scope.outOfScope.length > 0 && (
					<div className="space-y-1">
						{scope.outOfScope.map((item, i) => (
							<div key={i} className="flex items-center gap-2 py-0.5">
								<Ban className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
								<span className="flex-1 text-sm text-amber-700 dark:text-amber-400">{item}</span>
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() =>
										onUpdate({ outOfScope: scope.outOfScope.filter((_, idx) => idx !== i) })
									}
								>
									<X className="h-3 w-3" />
								</Button>
							</div>
						))}
					</div>
				)}
				<div className="flex gap-2">
					<Input
						value={oosInput}
						onChange={(e) => setOosInput(e.target.value)}
						placeholder="Add out-of-scope item..."
						className="text-sm"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								if (!oosInput.trim()) return;
								onUpdate({ outOfScope: [...scope.outOfScope, oosInput.trim()] });
								setOosInput("");
							}
						}}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={!oosInput.trim()}
						onClick={() => {
							if (!oosInput.trim()) return;
							onUpdate({ outOfScope: [...scope.outOfScope, oosInput.trim()] });
							setOosInput("");
						}}
					>
						Add
					</Button>
				</div>
			</div>
		</div>
	);
}

// ─── Helpers ──────────────────────────────────────────────────────

function ActivityDescription({ action, details }: { action: string; details: string | null }) {
	switch (action) {
		case "created":
			return <span>created this card</span>;
		case "moved":
			return <span>{details ?? "moved this card"}</span>;
		case "commented":
			return <span>added a comment</span>;
		case "checklist_completed":
			return <span>completed {details?.replace("Completed: ", "") ?? "a checklist item"}</span>;
		case "checklist_unchecked":
			return <span>unchecked {details?.replace("Unchecked: ", "") ?? "a checklist item"}</span>;
		default:
			return <span>{details ?? action}</span>;
	}
}
