"use client";

import {
	ArrowLeft,
	ArrowUpRight,
	Bold,
	Code,
	DollarSign,
	Eye,
	FileText,
	Heading2,
	Italic,
	LayoutGrid,
	Link as LinkIcon,
	List,
	ListOrdered,
	Loader2,
	MoreHorizontal,
	NotebookPen,
	Pencil,
	Plus,
	Quote,
	Tags,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use, useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
	filterNotes,
	NoteCollection,
	type NoteItem,
	NoteSearchInput,
	NoteTagFilter,
	NoteTagInput,
	type NoteViewMode,
	NoteViewToggle,
} from "@/components/notes/note-views";
import { CreateBoardDialog } from "@/components/project/create-board-dialog";
import { TagManager } from "@/components/tag/tag-manager";
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
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/ui/markdown";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { hasRole } from "@/lib/column-roles";
import { formatDate } from "@/lib/format-date";
import { COLOR_CLASSES } from "@/lib/project-colors";
import { type Priority, priorityValues } from "@/lib/schemas/card-schemas";
import type { ProjectColor } from "@/lib/schemas/project-schemas";
import { api } from "@/trpc/react";

// ─── Markdown toolbar (shared logic) ──────────────────────────────

type InsertAction = {
	label: string;
	icon: React.ReactNode;
	prefix: string;
	suffix?: string;
	block?: boolean;
};

const toolbarActions: InsertAction[] = [
	{ label: "Bold", icon: <Bold className="h-3.5 w-3.5" />, prefix: "**", suffix: "**" },
	{ label: "Italic", icon: <Italic className="h-3.5 w-3.5" />, prefix: "_", suffix: "_" },
	{ label: "Heading", icon: <Heading2 className="h-3.5 w-3.5" />, prefix: "## ", block: true },
	{ label: "Quote", icon: <Quote className="h-3.5 w-3.5" />, prefix: "> ", block: true },
	{ label: "Bullet list", icon: <List className="h-3.5 w-3.5" />, prefix: "- ", block: true },
	{
		label: "Numbered list",
		icon: <ListOrdered className="h-3.5 w-3.5" />,
		prefix: "1. ",
		block: true,
	},
	{ label: "Code", icon: <Code className="h-3.5 w-3.5" />, prefix: "`", suffix: "`" },
	{ label: "Link", icon: <LinkIcon className="h-3.5 w-3.5" />, prefix: "[", suffix: "](url)" },
];

function applyToolbarAction(
	textarea: HTMLTextAreaElement,
	action: InsertAction,
	content: string,
	setContent: (v: string) => void
) {
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const selected = content.slice(start, end);

	let insertion: string;
	let cursorOffset: number;

	if (action.block) {
		const lineStart = content.lastIndexOf("\n", start - 1) + 1;
		const before = content.slice(0, lineStart);
		const after = content.slice(lineStart);
		insertion = `${before}${action.prefix}${after}`;
		cursorOffset = lineStart + action.prefix.length;
	} else {
		const suffix = action.suffix ?? "";
		const wrapped = `${action.prefix}${selected || "text"}${suffix}`;
		insertion = content.slice(0, start) + wrapped + content.slice(end);
		cursorOffset = selected ? start + wrapped.length : start + action.prefix.length;
	}

	setContent(insertion);
	requestAnimationFrame(() => {
		textarea.focus();
		const pos = cursorOffset;
		textarea.setSelectionRange(pos, selected ? pos : pos + (selected ? 0 : 4));
	});
}

function NoteEditor({
	content,
	setContent,
	preview,
	setPreview,
	rows,
}: {
	content: string;
	setContent: (v: string) => void;
	preview: boolean;
	setPreview: (v: boolean) => void;
	rows?: number;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleToolbar = useCallback(
		(action: InsertAction) => {
			if (!textareaRef.current) return;
			applyToolbarAction(textareaRef.current, action, content, setContent);
		},
		[content, setContent]
	);

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<Label>Content (markdown)</Label>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 gap-1.5 text-xs"
					onClick={() => setPreview(!preview)}
				>
					<Eye className="h-3.5 w-3.5" />
					{preview ? "Edit" : "Preview"}
				</Button>
			</div>
			{preview ? (
				<div className="min-h-[600px] rounded-md border bg-background p-3 text-sm">
					{content ? (
						<Markdown>{content}</Markdown>
					) : (
						<p className="text-muted-foreground">Nothing to preview</p>
					)}
				</div>
			) : (
				<>
					<div className="flex flex-wrap gap-0.5 rounded-t-md border border-b-0 bg-muted/30 px-1 py-1">
						{toolbarActions.map((action) => (
							<Button
								key={action.label}
								type="button"
								variant="ghost"
								size="icon"
								className="h-7 w-7"
								title={action.label}
								onClick={() => handleToolbar(action)}
							>
								{action.icon}
							</Button>
						))}
					</div>
					<Textarea
						ref={textareaRef}
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="Details, context, links..."
						rows={rows ?? 20}
						className="rounded-t-none font-mono text-sm"
					/>
				</>
			)}
		</div>
	);
}

// ─── Page ──────────────────────────────────────────────────────────

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
	const { projectId } = use(params);
	const searchParams = useSearchParams();
	const tabParam = searchParams.get("tab");
	const initialTab =
		tabParam === "notes" ? "notes" : tabParam === "decisions" ? "decisions" : "boards";
	const fromBoardId = searchParams.get("from");
	const [tab, setTab] = useState<"boards" | "notes" | "decisions">(initialTab);
	const [noteCreateOpen, setNoteCreateOpen] = useState(false);
	const [tagManagerOpen, setTagManagerOpen] = useState(false);

	const { data: project } = api.project.getById.useQuery({ id: projectId });
	const { data: boards, isLoading: boardsLoading } = api.board.list.useQuery({ projectId });

	const projectColor = (project?.color as ProjectColor) || "slate";

	return (
		<div className="container mx-auto px-4 py-6">
			<div className="mb-6">
				{fromBoardId && tab === "notes" ? (
					<Link href={`/projects/${projectId}/boards/${fromBoardId}`}>
						<Button variant="ghost" size="sm" className="mb-2">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Board
						</Button>
					</Link>
				) : (
					<Link href="/projects">
						<Button variant="ghost" size="sm" className="mb-2">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Projects
						</Button>
					</Link>
				)}
				<div className="flex items-center justify-between">
					<div
						className={`flex items-center gap-3 border-l-[4px] pl-3 ${COLOR_CLASSES[projectColor].border}`}
					>
						<div>
							<h1 className="text-2xl font-bold tracking-tight">{project?.name ?? "..."}</h1>
							{project?.description && (
								<p className="text-sm text-muted-foreground">{project.description}</p>
							)}
						</div>
					</div>
					{tab === "boards" && (
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="h-8 gap-1.5 text-xs"
								onClick={() => setTagManagerOpen(true)}
							>
								<Tags className="h-3.5 w-3.5" />
								Manage tags
							</Button>
							<Link href={`/projects/${projectId}/costs`}>
								<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
									<DollarSign className="h-3.5 w-3.5" />
									Costs
								</Button>
							</Link>
							<CreateBoardDialog projectId={projectId} />
						</div>
					)}
					{tab === "notes" && (
						<Button onClick={() => setNoteCreateOpen(true)}>
							<Plus className="mr-2 h-4 w-4" />
							New Note
						</Button>
					)}
				</div>
			</div>

			<TagManager
				projectId={projectId}
				open={tagManagerOpen}
				onClose={() => setTagManagerOpen(false)}
			/>

			{/* Tabs */}
			<div className="mb-6 flex gap-1 border-b">
				<button
					type="button"
					onClick={() => setTab("boards")}
					className={`px-4 py-2 text-sm font-medium transition-colors ${
						tab === "boards"
							? "border-b-2 border-primary text-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<span className="flex items-center gap-2">
						<LayoutGrid className="h-4 w-4" />
						Boards
					</span>
				</button>
				<button
					type="button"
					onClick={() => setTab("notes")}
					className={`px-4 py-2 text-sm font-medium transition-colors ${
						tab === "notes"
							? "border-b-2 border-primary text-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<span className="flex items-center gap-2">
						<NotebookPen className="h-4 w-4" />
						Notes
					</span>
				</button>
				<button
					type="button"
					onClick={() => setTab("decisions")}
					className={`px-4 py-2 text-sm font-medium transition-colors ${
						tab === "decisions"
							? "border-b-2 border-primary text-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<span className="flex items-center gap-2">
						<FileText className="h-4 w-4" />
						Decisions
					</span>
				</button>
			</div>

			{tab === "boards" && (
				<BoardsTab projectId={projectId} boards={boards} isLoading={boardsLoading} />
			)}
			{tab === "notes" && (
				<ProjectNotesTab
					projectId={projectId}
					createOpen={noteCreateOpen}
					setCreateOpen={setNoteCreateOpen}
				/>
			)}
			{tab === "decisions" && <ProjectDecisionsTab projectId={projectId} />}
		</div>
	);
}

// ─── Boards Tab ────────────────────────────────────────────────────

type BoardListItem = {
	id: string;
	name: string;
	description: string | null;
	updatedAt: Date;
	columns: Array<{
		id: string;
		name: string;
		isParking: boolean;
		_count: { cards: number };
	}>;
};

function BoardsTab({
	projectId,
	boards,
	isLoading,
}: {
	projectId: string;
	boards: BoardListItem[] | undefined;
	isLoading: boolean;
}) {
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [renameId, setRenameId] = useState<string | null>(null);
	const [renameName, setRenameName] = useState("");

	const utils = api.useUtils();

	const deleteBoard = api.board.delete.useMutation({
		onSuccess: () => {
			utils.board.list.invalidate();
			setDeleteId(null);
			toast.success("Board deleted");
		},
		onError: (e) => toast.error(e.message),
	});

	const updateBoard = api.board.update.useMutation({
		onSuccess: () => {
			utils.board.list.invalidate();
			setRenameId(null);
			toast.success("Board renamed");
		},
		onError: (e) => toast.error(e.message),
	});

	const boardToDelete = boards?.find((b) => b.id === deleteId);

	const handleRename = (e: React.FormEvent) => {
		e.preventDefault();
		if (!renameId || !renameName.trim()) return;
		updateBoard.mutate({ id: renameId, data: { name: renameName.trim() } });
	};

	return (
		<>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{isLoading ? (
					Array.from({ length: 2 }).map((_, i) => (
						<Card key={i}>
							<CardHeader>
								<Skeleton className="h-5 w-32" />
								<Skeleton className="h-4 w-48" />
							</CardHeader>
						</Card>
					))
				) : boards?.length === 0 ? (
					<EmptyState
						icon={LayoutGrid}
						title="No boards yet"
						description="Create a board to start tracking work."
						className="col-span-full py-16"
					/>
				) : (
					boards?.map((board) => {
						const totalCards = board.columns.reduce((sum, col) => sum + col._count.cards, 0);
						const doneCol = board.columns.find((c) => hasRole(c, "done"));
						const doneCards = doneCol?._count.cards ?? 0;
						const inProgressCol = board.columns.find((c) => hasRole(c, "active"));
						const inProgressCards = inProgressCol?._count.cards ?? 0;
						const pct = totalCards > 0 ? Math.round((doneCards / totalCards) * 100) : 0;

						return (
							<div key={board.id} className="group relative">
								<Link href={`/projects/${projectId}/boards/${board.id}`}>
									<Card className="transition-colors hover:bg-muted/50">
										<CardHeader className="pb-3">
											<CardTitle className="text-lg">{board.name}</CardTitle>
											{board.description && <CardDescription>{board.description}</CardDescription>}
										</CardHeader>
										<div className="px-6 pb-4">
											{totalCards > 0 ? (
												<>
													<div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground">
														{inProgressCards > 0 && (
															<span className="flex items-center gap-1">
																<span className="h-2 w-2 rounded-full bg-blue-500" />
																{inProgressCards} in progress
															</span>
														)}
														{doneCards > 0 && (
															<span className="flex items-center gap-1">
																<span className="h-2 w-2 rounded-full bg-emerald-500" />
																{doneCards} done
															</span>
														)}
													</div>
													<div className="flex items-center gap-2">
														<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
															<div
																className="h-full rounded-full bg-emerald-500 transition-all"
																style={{ width: `${pct}%` }}
															/>
														</div>
														<span className="text-2xs text-muted-foreground">
															{totalCards} cards
														</span>
													</div>
												</>
											) : (
												<p className="text-xs text-muted-foreground">No cards yet</p>
											)}
										</div>
									</Card>
								</Link>
								<div className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												className="h-7 w-7"
												onClick={(e) => e.preventDefault()}
											>
												<MoreHorizontal className="h-4 w-4" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem
												onClick={() => {
													setRenameId(board.id);
													setRenameName(board.name);
												}}
											>
												<Pencil className="mr-2 h-3.5 w-3.5" />
												Rename
											</DropdownMenuItem>
											<DropdownMenuItem
												className="text-destructive"
												onClick={() => setDeleteId(board.id)}
											>
												<Trash2 className="mr-2 h-3.5 w-3.5" />
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</div>
						);
					})
				)}
			</div>

			{/* Delete board confirmation */}
			<AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete board?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete <strong>{boardToDelete?.name}</strong> and all its
							columns and cards. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (deleteId) deleteBoard.mutate({ id: deleteId });
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Rename board dialog */}
			<Dialog open={!!renameId} onOpenChange={() => setRenameId(null)}>
				<DialogContent>
					<form onSubmit={handleRename}>
						<DialogHeader>
							<DialogTitle>Rename Board</DialogTitle>
						</DialogHeader>
						<div className="mt-4 space-y-2">
							<Label htmlFor="board-rename">Name</Label>
							<Input
								id="board-rename"
								value={renameName}
								onChange={(e) => setRenameName(e.target.value)}
								autoFocus
							/>
						</div>
						<DialogFooter className="mt-6">
							<Button type="submit" disabled={updateBoard.isPending || !renameName.trim()}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

// ─── Project Notes Tab ─────────────────────────────────────────────

function ProjectNotesTab({
	projectId,
	createOpen,
	setCreateOpen,
}: {
	projectId: string;
	createOpen: boolean;
	setCreateOpen: (v: boolean) => void;
}) {
	const [viewingId, setViewingId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [promoteId, setPromoteId] = useState<string | null>(null);
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	const [preview, setPreview] = useState(false);
	const [noteTags, setNoteTags] = useState<string[]>([]);
	const [noteTagInput, setNoteTagInput] = useState("");
	const [viewMode, setViewMode] = useState<NoteViewMode>("card");
	const [filterTags, setFilterTags] = useState<string[]>([]);
	const [search, setSearch] = useState("");

	// Promote state
	const [promoteBoardId, setPromoteBoardId] = useState("");
	const [promoteColumnId, setPromoteColumnId] = useState("");
	const [promoteTitle, setPromoteTitle] = useState("");
	const [promotePriority, setPromotePriority] = useState<Priority>("NONE");

	const utils = api.useUtils();

	const { data: notes, isLoading } = api.note.list.useQuery({ projectId });

	const { data: boards } = api.board.list.useQuery({ projectId });

	const { data: promoteBoard } = api.board.getFull.useQuery(
		{ id: promoteBoardId },
		{ enabled: !!promoteBoardId }
	);

	const createNote = api.note.create.useMutation({
		onSuccess: () => {
			utils.note.list.invalidate();
			setCreateOpen(false);
			resetForm();
			toast.success("Note created");
		},
		onError: (e) => toast.error(e.message),
	});

	const updateNote = api.note.update.useMutation({
		onSuccess: () => {
			utils.note.list.invalidate();
			setEditingId(null);
			resetForm();
			toast.success("Note updated");
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteNote = api.note.delete.useMutation({
		onSuccess: () => {
			utils.note.list.invalidate();
			toast.success("Note deleted");
		},
		onError: (e) => toast.error(e.message),
	});

	const closePromote = () => {
		setPromoteId(null);
		setPromoteBoardId("");
		setPromoteColumnId("");
		setPromoteTitle("");
		setPromotePriority("NONE");
	};

	const openPromote = (id: string) => {
		const note = notes?.find((n) => n.id === id);
		setPromoteId(id);
		setPromoteTitle(note?.title ?? "");
		setPromotePriority("NONE");
		setPromoteBoardId("");
		setPromoteColumnId("");
	};

	const promoteToCard = api.note.promoteToCard.useMutation({
		onSuccess: () => {
			utils.note.list.invalidate();
			utils.board.getFull.invalidate();
			closePromote();
			toast.success("Note promoted to card");
		},
		onError: (e) => toast.error(e.message),
	});

	const resetForm = () => {
		setTitle("");
		setContent("");
		setPreview(false);
		setNoteTags([]);
		setNoteTagInput("");
	};

	const handleCreate = (e: React.FormEvent) => {
		e.preventDefault();
		if (!title.trim()) return;
		createNote.mutate({
			title: title.trim(),
			content: content.trim(),
			projectId,
			tags: noteTags,
		});
	};

	const handleUpdate = (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingId || !title.trim()) return;
		updateNote.mutate({
			id: editingId,
			data: { title: title.trim(), content: content.trim(), tags: noteTags },
		});
	};

	const handlePromote = () => {
		if (!promoteId || !promoteColumnId || !promoteTitle.trim()) return;
		promoteToCard.mutate({
			noteId: promoteId,
			columnId: promoteColumnId,
			title: promoteTitle.trim(),
			priority: promotePriority,
		});
	};

	const startEdit = (note: NoteItem) => {
		setEditingId(note.id);
		setTitle(note.title);
		setContent(note.content);
		setNoteTags(JSON.parse(note.tags));
		setNoteTagInput("");
		setPreview(false);
	};

	return (
		<>
			{isLoading ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 3 }).map((_, i) => (
						<div key={i} className="rounded-lg border bg-card p-4">
							<Skeleton className="h-5 w-3/4" />
							<Skeleton className="mt-2 h-4 w-full" />
							<Skeleton className="mt-1 h-4 w-2/3" />
						</div>
					))}
				</div>
			) : !notes || notes.length === 0 ? (
				<EmptyState icon={NotebookPen} title="No notes for this project yet." className="py-16" />
			) : (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<NoteTagFilter
							notes={notes}
							selectedTags={filterTags}
							setSelectedTags={setFilterTags}
						/>
						<div className="flex items-center gap-3">
							<NoteSearchInput value={search} onChange={setSearch} />
							<NoteViewToggle view={viewMode} setView={setViewMode} />
						</div>
					</div>
					<NoteCollection
						notes={filterNotes(notes, { search, tags: filterTags })}
						view={viewMode}
						actions={{
							onView: (id) => setViewingId(id),
							onEdit: (note) => startEdit(note),
							onPromote: openPromote,
							onDelete: (id) => deleteNote.mutate({ id }),
						}}
					/>
				</div>
			)}

			{/* View dialog */}
			{(() => {
				const viewNote = notes?.find((n) => n.id === viewingId);
				if (!viewNote) return null;
				return (
					<Dialog open={!!viewingId} onOpenChange={() => setViewingId(null)}>
						<DialogContent className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto">
							<DialogHeader>
								<DialogTitle className="text-xl">{viewNote.title}</DialogTitle>
								<p className="text-xs text-muted-foreground">
									{formatDate(viewNote.updatedAt, { includeTime: true })}
								</p>
							</DialogHeader>
							{JSON.parse(viewNote.tags).length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{(JSON.parse(viewNote.tags) as string[]).map((tag) => (
										<Badge key={tag} variant="outline" className="text-xs">
											{tag}
										</Badge>
									))}
								</div>
							)}
							<div className="mt-4 min-h-[200px] text-sm">
								{viewNote.content ? (
									<Markdown>{viewNote.content}</Markdown>
								) : (
									<p className="text-muted-foreground italic">No content</p>
								)}
							</div>
							<DialogFooter>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										setViewingId(null);
										openPromote(viewNote.id);
									}}
								>
									<ArrowUpRight className="mr-2 h-3.5 w-3.5" />
									Promote to Card
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										setViewingId(null);
										startEdit(viewNote);
									}}
								>
									<Pencil className="mr-2 h-3.5 w-3.5" />
									Edit
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				);
			})()}

			{/* Create dialog */}
			<Dialog
				open={createOpen}
				onOpenChange={(open) => {
					if (!open) resetForm();
					setCreateOpen(open);
				}}
			>
				<DialogContent className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto">
					<form onSubmit={handleCreate}>
						<DialogHeader>
							<DialogTitle>New Note</DialogTitle>
							<DialogDescription>Jot down a quick thought or idea.</DialogDescription>
						</DialogHeader>
						<div className="mt-4 space-y-4">
							<div className="space-y-2">
								<Label htmlFor="pnote-title">Title</Label>
								<Input
									id="pnote-title"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									placeholder="What's on your mind?"
									autoFocus
								/>
							</div>
							<NoteTagInput
								tags={noteTags}
								setTags={setNoteTags}
								tagInput={noteTagInput}
								setTagInput={setNoteTagInput}
							/>
							<NoteEditor
								content={content}
								setContent={setContent}
								preview={preview}
								setPreview={setPreview}
							/>
						</div>
						<DialogFooter className="mt-6">
							<Button type="submit" disabled={createNote.isPending || !title.trim()}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Edit dialog */}
			<Dialog open={!!editingId} onOpenChange={() => setEditingId(null)}>
				<DialogContent className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto">
					<form onSubmit={handleUpdate}>
						<DialogHeader>
							<DialogTitle>Edit Note</DialogTitle>
						</DialogHeader>
						<div className="mt-4 space-y-4">
							<div className="space-y-2">
								<Label htmlFor="pnote-edit-title">Title</Label>
								<Input
									id="pnote-edit-title"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									autoFocus
								/>
							</div>
							<NoteTagInput
								tags={noteTags}
								setTags={setNoteTags}
								tagInput={noteTagInput}
								setTagInput={setNoteTagInput}
							/>
							<NoteEditor
								content={content}
								setContent={setContent}
								preview={preview}
								setPreview={setPreview}
							/>
						</div>
						<DialogFooter className="mt-6">
							<Button type="submit" disabled={updateNote.isPending || !title.trim()}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Promote dialog — project is implicit, so no project picker. */}
			<Dialog open={!!promoteId} onOpenChange={(open) => !open && closePromote()}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Promote to Card</DialogTitle>
						<DialogDescription>
							The note stays in your scratch space and is linked to the new card.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="promote-title">Card title</Label>
							<Input
								id="promote-title"
								value={promoteTitle}
								onChange={(e) => setPromoteTitle(e.target.value)}
								placeholder="Card title"
							/>
						</div>
						<div className="space-y-2">
							<Label>Priority</Label>
							<Select
								value={promotePriority}
								onValueChange={(v) => setPromotePriority(v as Priority)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{priorityValues.map((p) => (
										<SelectItem key={p} value={p}>
											{p}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label>Board</Label>
							<Select
								value={promoteBoardId}
								onValueChange={(v) => {
									setPromoteBoardId(v);
									setPromoteColumnId("");
								}}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select board" />
								</SelectTrigger>
								<SelectContent>
									{boards?.map((b) => (
										<SelectItem key={b.id} value={b.id}>
											{b.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{promoteBoardId && promoteBoard && (
							<div className="space-y-2">
								<Label>Column</Label>
								<Select value={promoteColumnId} onValueChange={setPromoteColumnId}>
									<SelectTrigger>
										<SelectValue placeholder="Select column" />
									</SelectTrigger>
									<SelectContent>
										{promoteBoard.columns.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
					</div>
					<DialogFooter className="mt-6">
						<Button
							onClick={handlePromote}
							disabled={!promoteColumnId || !promoteTitle.trim() || promoteToCard.isPending}
						>
							{promoteToCard.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							Promote to Card
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

// ─── Project Decisions Tab ────────────────────────────────────────

const DECISION_STATUS_COLORS: Record<string, string> = {
	proposed: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
	accepted: "bg-green-500/10 text-green-600 border-green-500/20",
	rejected: "bg-red-500/10 text-red-600 border-red-500/20",
	superseded: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

function ProjectDecisionsTab({ projectId }: { projectId: string }) {
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const { data: decisions, isLoading } = api.decision.list.useQuery({
		projectId,
		...(statusFilter !== "all" ? { status: statusFilter } : {}),
	});

	if (isLoading) {
		return (
			<div className="space-y-3">
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="rounded-lg border bg-card px-4 py-3">
						<div className="flex items-center gap-2">
							<Skeleton className="h-5 w-16" />
							<Skeleton className="h-4 flex-1 max-w-[200px]" />
							<Skeleton className="ml-auto h-4 w-20" />
						</div>
						<Skeleton className="mt-2 h-3 w-3/4" />
					</div>
				))}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<Select value={statusFilter} onValueChange={setStatusFilter}>
					<SelectTrigger className="w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						<SelectItem value="proposed">Proposed</SelectItem>
						<SelectItem value="accepted">Accepted</SelectItem>
						<SelectItem value="rejected">Rejected</SelectItem>
						<SelectItem value="superseded">Superseded</SelectItem>
					</SelectContent>
				</Select>
				<span className="text-sm text-muted-foreground">
					{decisions?.length ?? 0} decision{decisions?.length !== 1 ? "s" : ""}
				</span>
			</div>

			{!decisions || decisions.length === 0 ? (
				<EmptyState
					icon={FileText}
					title="No decisions recorded yet."
					description="Agents record decisions automatically, or use the MCP tools to add them."
					className="py-16"
				/>
			) : (
				<div className="space-y-3">
					{decisions.map(
						(d: {
							id: string;
							title: string;
							status: string;
							decision: string;
							alternatives: string[];
							rationale: string;
							author: string;
							card: { id: string; number: number; title: string } | null;
							createdAt: Date;
						}) => {
							const isExpanded = expandedId === d.id;
							return (
								<div
									key={d.id}
									className="rounded-lg border bg-card transition-colors hover:bg-muted/30"
								>
									<button
										type="button"
										className="w-full px-4 py-3 text-left"
										onClick={() => setExpandedId(isExpanded ? null : d.id)}
									>
										<div className="flex items-center gap-2">
											<Badge
												variant="outline"
												className={`text-2xs ${DECISION_STATUS_COLORS[d.status] ?? ""}`}
											>
												{d.status}
											</Badge>
											<span className="flex-1 text-sm font-medium">{d.title}</span>
											{d.card && (
												<span className="text-xs font-mono text-muted-foreground">
													#{d.card.number}
												</span>
											)}
											<span className="text-xs text-muted-foreground">
												{formatDate(d.createdAt)}
											</span>
										</div>
										{!isExpanded && (
											<p className="mt-1 text-xs text-muted-foreground line-clamp-1">
												{d.decision}
											</p>
										)}
									</button>
									{isExpanded && (
										<div className="border-t px-4 py-3 space-y-3">
											<div>
												<Label className="text-xs text-muted-foreground">Decision</Label>
												<p className="mt-0.5 text-sm">{d.decision}</p>
											</div>
											{d.rationale && (
												<div>
													<Label className="text-xs text-muted-foreground">Rationale</Label>
													<p className="mt-0.5 text-sm">{d.rationale}</p>
												</div>
											)}
											{d.alternatives.length > 0 && (
												<div>
													<Label className="text-xs text-muted-foreground">
														Alternatives considered
													</Label>
													<ul className="mt-0.5 space-y-1">
														{d.alternatives.map((alt, i) => (
															<li key={i} className="text-sm text-muted-foreground">
																&bull; {alt}
															</li>
														))}
													</ul>
												</div>
											)}
											<div className="flex items-center gap-3 text-xs text-muted-foreground">
												<span>By {d.author}</span>
												{d.card && (
													<span>
														Linked to #{d.card.number} {d.card.title}
													</span>
												)}
											</div>
										</div>
									)}
								</div>
							);
						}
					)}
				</div>
			)}
		</div>
	);
}
