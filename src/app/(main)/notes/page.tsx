"use client";

import { ArrowUpRight, Loader2, NotebookPen, Pencil, Plus } from "lucide-react";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/ui/markdown";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format-date";
import { type Priority, priorityValues } from "@/lib/schemas/card-schemas";
import { api } from "@/trpc/react";

// ─── Page ──────────────────────────────────────────────────────────

export default function NotesPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const [viewingId, setViewingId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [promoteId, setPromoteId] = useState<string | null>(null);
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	const [projectId, setProjectId] = useState<string | null>(null);
	const [preview, setPreview] = useState(false);
	const [noteTags, setNoteTags] = useState<string[]>([]);
	const [noteTagInput, setNoteTagInput] = useState("");
	const [viewMode, setViewMode] = useState<NoteViewMode>("card");
	const [filterTags, setFilterTags] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [filterProjectId, setFilterProjectId] = useState<string | undefined>(undefined);

	// Promote state
	const [promoteProjectId, setPromoteProjectId] = useState("");
	const [promoteBoardId, setPromoteBoardId] = useState("");
	const [promoteColumnId, setPromoteColumnId] = useState("");
	const [promoteTitle, setPromoteTitle] = useState("");
	const [promotePriority, setPromotePriority] = useState<Priority>("NONE");

	const utils = api.useUtils();

	const { data: notes, isLoading } = api.note.list.useQuery(
		filterProjectId !== undefined ? { projectId: filterProjectId || null } : undefined
	);

	const { data: projects } = api.project.list.useQuery();

	const { data: boards } = api.board.list.useQuery(
		{ projectId: promoteProjectId },
		{ enabled: !!promoteProjectId }
	);

	const { data: board } = api.board.getFull.useQuery(
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
		setPromoteProjectId("");
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
		setPromoteProjectId(note?.project?.id ?? "");
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
		setProjectId(null);
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
			data: { title: title.trim(), content: content.trim(), projectId, tags: noteTags },
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

	const startEdit = (note: NoteItem & { projectId: string | null }) => {
		setEditingId(note.id);
		setTitle(note.title);
		setContent(note.content);
		setProjectId(note.projectId);
		setNoteTags(JSON.parse(note.tags));
		setNoteTagInput("");
		setPreview(false);
	};

	return (
		<div className="container mx-auto px-4 py-6">
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Notes</h1>
					<p className="text-sm text-muted-foreground">Quick thoughts, ideas, and scratch space</p>
				</div>
				<div className="flex items-center gap-3">
					<Select
						value={filterProjectId ?? "all"}
						onValueChange={(v) =>
							setFilterProjectId(v === "all" ? undefined : v === "none" ? "" : v)
						}
					>
						<SelectTrigger className="w-[180px]">
							<SelectValue placeholder="All notes" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All notes</SelectItem>
							<SelectItem value="none">General (no project)</SelectItem>
							{projects?.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<NoteSearchInput value={search} onChange={setSearch} />
					<NoteViewToggle view={viewMode} setView={setViewMode} />
					<Button
						onClick={() => {
							resetForm();
							setCreateOpen(true);
						}}
					>
						<Plus className="mr-2 h-4 w-4" />
						New Note
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 6 }).map((_, i) => (
						<div key={i} className="rounded-lg border bg-card p-4">
							<Skeleton className="h-5 w-3/4" />
							<Skeleton className="mt-2 h-4 w-full" />
							<Skeleton className="mt-1 h-4 w-2/3" />
						</div>
					))}
				</div>
			) : !notes || notes.length === 0 ? (
				<EmptyState
					icon={NotebookPen}
					title="No notes yet."
					description="Jot down ideas, questions, or thoughts. Promote them to cards when they're ready."
					className="py-16"
				/>
			) : (
				<div className="space-y-3">
					<NoteTagFilter notes={notes} selectedTags={filterTags} setSelectedTags={setFilterTags} />
					<NoteCollection
						notes={filterNotes(notes, { search, tags: filterTags })}
						view={viewMode}
						showProject
						actions={{
							onView: (id) => setViewingId(id),
							onEdit: (note) => startEdit(note as NoteItem & { projectId: string | null }),
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
								<div className="flex items-start justify-between pr-8">
									<div>
										<DialogTitle className="text-xl">{viewNote.title}</DialogTitle>
										<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
											{viewNote.project && <span>{viewNote.project.name}</span>}
											<span>{formatDate(viewNote.updatedAt, { includeTime: true })}</span>
										</div>
									</div>
								</div>
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
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto">
					<form onSubmit={handleCreate}>
						<DialogHeader>
							<DialogTitle>New Note</DialogTitle>
							<DialogDescription>Jot down a quick thought or idea.</DialogDescription>
						</DialogHeader>
						<div className="mt-4 space-y-4">
							<div className="flex gap-4">
								<div className="flex-1 space-y-2">
									<Label htmlFor="note-title">Title</Label>
									<Input
										id="note-title"
										value={title}
										onChange={(e) => setTitle(e.target.value)}
										placeholder="What's on your mind?"
										autoFocus
									/>
								</div>
								<div className="w-[180px] space-y-2">
									<Label>Project (optional)</Label>
									<Select
										value={projectId ?? "none"}
										onValueChange={(v) => setProjectId(v === "none" ? null : v)}
									>
										<SelectTrigger>
											<SelectValue placeholder="General" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="none">General</SelectItem>
											{projects?.map((p) => (
												<SelectItem key={p.id} value={p.id}>
													{p.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							<NoteTagInput
								tags={noteTags}
								setTags={setNoteTags}
								tagInput={noteTagInput}
								setTagInput={setNoteTagInput}
							/>
							<div className="space-y-2">
								<Label>Content (markdown)</Label>
								<MarkdownEditor
									content={content}
									setContent={setContent}
									preview={preview}
									setPreview={setPreview}
									previewMinHeight="min-h-[600px]"
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button type="submit" disabled={createNote.isPending || !title.trim()}>
								{createNote.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
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
							<div className="flex gap-4">
								<div className="flex-1 space-y-2">
									<Label htmlFor="edit-title">Title</Label>
									<Input
										id="edit-title"
										value={title}
										onChange={(e) => setTitle(e.target.value)}
										autoFocus
									/>
								</div>
								<div className="w-[180px] space-y-2">
									<Label>Project</Label>
									<Select
										value={projectId ?? "none"}
										onValueChange={(v) => setProjectId(v === "none" ? null : v)}
									>
										<SelectTrigger>
											<SelectValue placeholder="General" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="none">General</SelectItem>
											{projects?.map((p) => (
												<SelectItem key={p.id} value={p.id}>
													{p.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							<NoteTagInput
								tags={noteTags}
								setTags={setNoteTags}
								tagInput={noteTagInput}
								setTagInput={setNoteTagInput}
							/>
							<div className="space-y-2">
								<Label>Content (markdown)</Label>
								<MarkdownEditor
									content={content}
									setContent={setContent}
									preview={preview}
									setPreview={setPreview}
									previewMinHeight="min-h-[600px]"
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button type="submit" disabled={updateNote.isPending || !title.trim()}>
								{updateNote.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Promote to card dialog */}
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
							<Label>Project</Label>
							<Select
								value={promoteProjectId}
								onValueChange={(v) => {
									setPromoteProjectId(v);
									setPromoteBoardId("");
									setPromoteColumnId("");
								}}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select project" />
								</SelectTrigger>
								<SelectContent>
									{projects?.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{promoteProjectId && boards && (
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
										{boards.map((b) => (
											<SelectItem key={b.id} value={b.id}>
												{b.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						{promoteBoardId && board && (
							<div className="space-y-2">
								<Label>Column</Label>
								<Select value={promoteColumnId} onValueChange={setPromoteColumnId}>
									<SelectTrigger>
										<SelectValue placeholder="Select column" />
									</SelectTrigger>
									<SelectContent>
										{board.columns.map((c) => (
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
		</div>
	);
}
