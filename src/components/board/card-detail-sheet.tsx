"use client";

import {
	Ban,
	ChevronDown,
	ChevronRight,
	Clock,
	FileCode,
	GitCommit,
	Link2,
	MoonStar,
	Pencil,
	Plus,
	Trash2,
	User,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MilestoneCombobox } from "@/components/board/milestone-combobox";
import { TagCombobox } from "@/components/board/tag-combobox";
import { TokenTrackingSetupDialog } from "@/components/board/token-tracking-setup-dialog";
import { ActorChip } from "@/components/ui/actor-chip";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { CardPigeonOverheadChip } from "@/components/ui/pigeon-overhead-chip";
import { SectionHeader } from "@/components/ui/section-header";
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
import { Skeleton } from "@/components/ui/skeleton";
import { TokenCostChip } from "@/components/ui/token-cost-chip";
import { getAccentBorderStyle, getActorIdentity } from "@/lib/actor-colors";
import { formatActivityDescription } from "@/lib/format-activity";
import { formatDate, formatRelativeCompact } from "@/lib/format-date";
import { PRIORITY_BADGE } from "@/lib/priority-colors";
import { type Priority, priorityValues } from "@/lib/schemas/card-schemas";
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
	onNavigate?: (direction: "prev" | "next") => void;
};

export function CardDetailSheet({ cardId, boardId, onClose, onNavigate }: CardDetailSheetProps) {
	const utils = api.useUtils();

	// All cache reads/writes below use the same id. When cardId is null the
	// sheet is closed and these never fire — but we narrow inside each
	// callback rather than carrying `!` everywhere. The query is disabled
	// when cardId is null so the sentinel "" is never actually requested.
	const { data: card } = api.card.getById.useQuery({ id: cardId ?? "" }, { enabled: !!cardId });

	const updateCard = api.card.update.useMutation({
		onMutate: async ({ data }) => {
			if (!cardId) return;
			await utils.card.getById.cancel({ id: cardId });
			const previous = utils.card.getById.getData({ id: cardId });

			utils.card.getById.setData({ id: cardId }, (old) => {
				if (!old) return old;
				// Tags now travel as a string[] on the API surface (the legacy
				// JSON column was dropped in v5 / #227); the optimistic patch
				// just mirrors that shape directly.
				return { ...old, ...data } as typeof old;
			});

			return { previous };
		},
		onError: (error, _vars, context) => {
			if (cardId && context?.previous) {
				utils.card.getById.setData({ id: cardId }, context.previous);
			}
			toast.error(error.message);
		},
		onSettled: () => {
			if (!cardId) return;
			utils.card.getById.invalidate({ id: cardId });
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
			if (!cardId) return;
			utils.card.getById.invalidate({ id: cardId });
			utils.board.getFull.invalidate({ id: boardId });
		},
		onError: (error) => toast.error(error.message),
	});

	const updateChecklist = api.checklist.update.useMutation({
		onMutate: async ({ id: checklistId, data }) => {
			if (!cardId) return;
			await utils.card.getById.cancel({ id: cardId });
			const previous = utils.card.getById.getData({ id: cardId });

			utils.card.getById.setData({ id: cardId }, (old) => {
				if (!old) return old;
				return {
					...old,
					checklists: old.checklists.map((item) =>
						item.id === checklistId ? { ...item, ...data } : item
					),
				};
			});

			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (cardId && context?.previous) {
				utils.card.getById.setData({ id: cardId }, context.previous);
			}
		},
		onSettled: () => {
			if (!cardId) return;
			utils.card.getById.invalidate({ id: cardId });
			utils.board.getFull.invalidate({ id: boardId });
		},
	});

	const deleteChecklist = api.checklist.delete.useMutation({
		onSuccess: () => {
			if (!cardId) return;
			utils.card.getById.invalidate({ id: cardId });
			utils.board.getFull.invalidate({ id: boardId });
		},
	});

	const createComment = api.comment.create.useMutation({
		onSuccess: () => {
			if (!cardId) return;
			utils.card.getById.invalidate({ id: cardId });
			utils.board.getFull.invalidate({ id: boardId });
		},
		onError: (error) => toast.error(error.message),
	});

	// Form inputs
	const [newChecklistItem, setNewChecklistItem] = useState("");
	const [newComment, setNewComment] = useState("");

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
		if (card?.id) {
			if (!isEditingTitleRef.current) setLocalTitle(card.title);
			if (!isEditingDescriptionRef.current) setLocalDescription(card.description ?? "");
		}
	}, [card?.id, card?.title, card?.description]);

	// Reset edit states when switching cards. cardId is a trigger-only dep:
	// the effect resets state whenever the user navigates to a different card,
	// even though cardId isn't read inside the body.
	// biome-ignore lint/correctness/useExhaustiveDependencies: cardId is the change trigger
	useEffect(() => {
		setIsEditingTitle(false);
		setIsEditingDescription(false);
		setDescriptionPreview(false);
	}, [cardId]);

	// ←/→ navigate between sibling cards. Guarded so it doesn't fire while
	// typing in inputs or while a Radix popover/menu/alert is focused.
	useEffect(() => {
		if (!cardId || !onNavigate) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const el = document.activeElement as HTMLElement | null;
			if (el) {
				const tag = el.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
				if (el.isContentEditable) return;
				if (
					el.closest?.('[role="listbox"], [role="menu"], [role="alertdialog"], [role="combobox"]')
				)
					return;
			}
			e.preventDefault();
			onNavigate(e.key === "ArrowLeft" ? "prev" : "next");
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [cardId, onNavigate]);

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

	const handleDescriptionKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				setLocalDescription(card?.description ?? "");
				setIsEditingDescription(false);
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				handleDescriptionSave();
			}
		},
		[card?.description, handleDescriptionSave]
	);

	const tags: string[] = card ? card.tags : [];

	return (
		<Sheet
			open={!!cardId}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
				{!card ? (
					<div className="space-y-6 pt-6">
						<SheetHeader>
							<SheetTitle>
								<Skeleton className="h-6 w-48" />
							</SheetTitle>
							<SheetDescription className="sr-only">Loading card details.</SheetDescription>
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
							<SheetDescription className="sr-only">
								Card details, with editable title, description, checklists, comments, and activity.
							</SheetDescription>
							<p className="text-xs text-muted-foreground">
								Created by {card.createdBy === "AGENT" ? "Agent" : "Human"}
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

								{/* Milestone */}
								<MilestoneCombobox
									cardId={card.id}
									projectId={card.projectId}
									currentMilestoneId={card.milestoneId}
									boardId={boardId}
								/>
							</div>

							{/* Stalled-in-progress callout */}
							{card.stale && (
								<div
									className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
									title={`Last signal at ${new Date(card.stale.lastSignalAt).toLocaleString()}.`}
								>
									<MoonStar className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									<div className="space-y-0.5">
										<div className="font-medium">Stalled — last signal {card.stale.days}d ago</div>
										<div className="text-warning/70">
											Revive with a comment, commit, or checklist update — or move to Parking Lot /
											Done.
										</div>
									</div>
								</div>
							)}

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
									// biome-ignore lint/a11y/noStaticElementInteractions: Markdown content can contain links — wrapping in <button> would be invalid HTML
									// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation flows through the focusable Markdown links inside
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

							{/* Tags */}
							<div className="space-y-2">
								<SectionHeader>Tags</SectionHeader>
								<TagCombobox
									projectId={card.projectId}
									currentTags={tags}
									onChange={(nextTags) =>
										updateCard.mutate({ id: card.id, data: { tags: nextTags } })
									}
								/>
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
												<ActorChip
													actorType={comment.authorType}
													actorName={
														comment.authorName ??
														(comment.authorType === "AGENT" ? "Claude" : "You")
													}
													size="sm"
													showName
												/>
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
									<Button type="submit" variant="outline" size="sm" disabled={!newComment.trim()}>
										Send
									</Button>
								</form>
							</div>

							{/* Decisions */}
							<DecisionsSection cardId={card.id} projectId={card.projectId} />

							{/* Token cost (#96) */}
							<CardCostSection cardId={card.id} projectId={card.projectId} />

							{/* Commit Summary */}
							{card.gitLinks && card.gitLinks.length > 0 && (
								<>
									<div className="border-t border-border/50" />
									<CommitSummarySection cardId={card.id} />
								</>
							)}

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
													<div key={link.id} className="rounded-md border p-2.5 text-xs space-y-1">
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
																<span>
																	{filePaths.length} file{filePaths.length !== 1 ? "s" : ""}
																</span>
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
										<ol className="space-y-2">
											{card.activities.map((activity) => {
												const { color } = getActorIdentity(activity.actorType, activity.actorName);
												const name =
													activity.actorName ?? (activity.actorType === "AGENT" ? "Claude" : "You");
												const hasIntent = Boolean(activity.intent);
												return (
													<li
														key={activity.id}
														className="pl-3"
														style={getAccentBorderStyle(color, { hasIntent })}
													>
														<div className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
															<span className="font-medium text-foreground">{name}</span>
															<span>
																{formatActivityDescription(activity.action, activity.details)}
															</span>
															<span className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/60">
																{formatRelativeCompact(new Date(activity.createdAt))}
															</span>
														</div>
														{activity.intent && (
															<p className="mt-0.5 text-2xs italic text-foreground/80">
																{activity.intent}
															</p>
														)}
													</li>
												);
											})}
										</ol>
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
												This will permanently delete card #{card.number} and all its comments,
												checklist items, and activity history.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction onClick={() => deleteCard.mutate({ id: card.id })}>
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
	blocks: { icon: <Ban className="h-3 w-3" />, label: "Blocks", color: "text-danger" },
	blockedBy: { icon: <Ban className="h-3 w-3" />, label: "Blocked by", color: "text-warning" },
	relatedTo: { icon: <Link2 className="h-3 w-3" />, label: "Related", color: "text-info" },
	parentOf: {
		icon: <Link2 className="h-3 w-3" />,
		label: "Parent of",
		color: "text-accent-violet",
	},
	childOf: { icon: <Link2 className="h-3 w-3" />, label: "Child of", color: "text-accent-violet" },
};

function DependenciesSection({ cardId, boardId }: { cardId: string; boardId: string }) {
	const utils = api.useUtils();
	const { data: relations } = api.relation.getForCard.useQuery({ cardId }, { enabled: !!cardId });

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
							<span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
							<div className="flex flex-wrap gap-1">
								{group.items.map((item: { id: string; number: number; title: string }) => {
									const typeMap: Record<string, string> = {
										blocks: "blocks",
										blockedBy: "blocks",
										relatedTo: "related",
										parentOf: "parent",
										childOf: "parent",
									};
									const relType = typeMap[group.key] ?? "related";
									const isFrom =
										group.key === "blocks" || group.key === "relatedTo" || group.key === "parentOf";
									return (
										<Badge key={item.id} variant="outline" className="cursor-pointer gap-1 pr-1">
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

// Post-#86 the Claim status enum is `active` | `superseded` only. The legacy
// proposed/accepted/rejected values collapsed into `active` during the v5.0
// cutover, so only these two branches can ever fire here.
const STATUS_COLORS: Record<string, string> = {
	active: "bg-success/10 text-success border-success/20",
	superseded: "bg-muted text-muted-foreground border-muted-foreground/20",
};

function DecisionsSection({ cardId, projectId }: { cardId: string; projectId: string }) {
	const { data: decisions } = api.decision.list.useQuery(
		{ projectId, cardId },
		{ enabled: !!cardId }
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
						<p className="mt-1 text-xs text-muted-foreground line-clamp-2">{d.decision}</p>
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Card cost section (#96) ──────────────────────────────────────

// Three states (#147):
//   1. card has usage  → render chip + session count
//   2. project has usage but this card doesn't → render nothing (silence
//      stays correct for the "tracked elsewhere" case)
//   3. project has no usage at all → render a one-line "Not tracked yet"
//      hint that opens the in-app TokenTrackingSetupDialog (#153), since the
//      feature is otherwise undiscoverable

function CardCostSection({ cardId, projectId }: { cardId: string; projectId: string }) {
	const { data: cardSummary } = api.tokenUsage.getCardSummary.useQuery(
		{ cardId },
		{ enabled: !!cardId, retry: false }
	);
	const { data: projectSummary } = api.tokenUsage.getProjectSummary.useQuery(
		{ projectId },
		{ enabled: !!projectId, retry: false }
	);

	if (cardSummary && cardSummary.totalCostUsd > 0) {
		return (
			<div className="space-y-1">
				<div className="flex items-center gap-2">
					<SectionHeader>Token cost</SectionHeader>
					<TokenCostChip
						costUsd={cardSummary.totalCostUsd}
						sessionCount={cardSummary.sessionCount}
					/>
					<CardPigeonOverheadChip cardId={cardId} />
					<span className="text-xs text-muted-foreground">
						across {cardSummary.sessionCount} session{cardSummary.sessionCount === 1 ? "" : "s"}
					</span>
				</div>
			</div>
		);
	}

	if (projectSummary && projectSummary.totalCostUsd === 0) {
		return (
			<div className="space-y-1">
				<div className="flex items-center gap-2">
					<SectionHeader>Token cost</SectionHeader>
					<span className="text-xs text-muted-foreground">
						Not tracked yet ·{" "}
						<TokenTrackingSetupDialog
							trigger={
								<button
									type="button"
									className="underline underline-offset-2 hover:text-foreground"
								>
									Set up →
								</button>
							}
						/>
					</span>
				</div>
			</div>
		);
	}

	return null;
}

// ─── Commit Summary Section ───────────────────────────────────────

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
	source: { label: "Source", color: "text-info" },
	styles: { label: "Styles", color: "text-pink-500" },
	config: { label: "Config", color: "text-warning" },
	schema: { label: "Schema", color: "text-accent-violet" },
	tests: { label: "Tests", color: "text-success" },
	docs: { label: "Docs", color: "text-cyan-500" },
	other: { label: "Other", color: "text-muted-foreground" },
};

const CATEGORY_ORDER = ["source", "schema", "styles", "tests", "config", "docs", "other"];

function CommitSummarySection({ cardId }: { cardId: string }) {
	const [expanded, setExpanded] = useState(true);
	const { data: summary } = api.card.getCommitSummary.useQuery({ cardId }, { enabled: !!cardId });

	if (!summary || summary.commitCount === 0) return null;

	const sortedCategories = Object.keys(summary.filesByCategory).sort(
		(a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)
	);

	return (
		<div className="space-y-3">
			<button
				type="button"
				className="flex w-full items-center gap-1.5"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? (
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3 w-3 text-muted-foreground" />
				)}
				<SectionHeader>Commit Summary</SectionHeader>
			</button>

			{expanded && (
				<div className="space-y-3">
					{/* Stats row */}
					<div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
						<span className="flex items-center gap-1">
							<GitCommit className="h-3 w-3" />
							{summary.commitCount} commit{summary.commitCount !== 1 ? "s" : ""}
						</span>
						<span className="flex items-center gap-1">
							<FileCode className="h-3 w-3" />
							{summary.totalFiles} file{summary.totalFiles !== 1 ? "s" : ""}
						</span>
						{summary.authors.length > 0 && (
							<span className="flex items-center gap-1">
								<User className="h-3 w-3" />
								{summary.authors.join(", ")}
							</span>
						)}
						{summary.timeSpan && (
							<span className="flex items-center gap-1">
								<Clock className="h-3 w-3" />
								{formatDate(summary.timeSpan.first)} – {formatDate(summary.timeSpan.last)}
							</span>
						)}
					</div>

					{/* Files by category */}
					<div className="space-y-2">
						{sortedCategories.map((cat) => {
							const meta = CATEGORY_LABELS[cat] ?? CATEGORY_LABELS.other;
							const files = summary.filesByCategory[cat];
							return (
								<div key={cat}>
									<span className={`text-xs font-medium ${meta.color}`}>
										{meta.label}
										<span className="ml-1 text-muted-foreground font-normal">({files.length})</span>
									</span>
									<div className="mt-0.5 flex flex-wrap gap-1">
										{files.map((file) => (
											<code
												key={file}
												className="rounded bg-muted px-1.5 py-0.5 text-2xs font-mono text-muted-foreground"
											>
												{file}
											</code>
										))}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
