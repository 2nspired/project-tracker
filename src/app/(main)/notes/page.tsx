"use client";

import {
	ArrowUpRight,
	Bold,
	Code,
	Eye,
	Heading2,
	Italic,
	Link,
	List as ListIcon,
	ListOrdered,
	NotebookPen,
	Pencil,
	Plus,
	Quote,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { NoteCollection, NoteSearchInput, NoteTagFilter, NoteTagInput, NoteViewToggle, filterNotes, type NoteItem, type NoteViewMode } from "@/components/notes/note-views";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/trpc/react";

// ─── Markdown toolbar helpers ──────────────────────────────────────

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
	{ label: "Bullet list", icon: <ListIcon className="h-3.5 w-3.5" />, prefix: "- ", block: true },
	{ label: "Numbered list", icon: <ListOrdered className="h-3.5 w-3.5" />, prefix: "1. ", block: true },
	{ label: "Code", icon: <Code className="h-3.5 w-3.5" />, prefix: "`", suffix: "`" },
	{ label: "Link", icon: <Link className="h-3.5 w-3.5" />, prefix: "[", suffix: "](url)" },
];

function applyToolbarAction(
	textarea: HTMLTextAreaElement,
	action: InsertAction,
	content: string,
	setContent: (v: string) => void,
) {
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const selected = content.slice(start, end);

	let insertion: string;
	let cursorOffset: number;

	if (action.block) {
		// For block actions, insert at start of line
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

// ─── Note Editor ───────────────────────────────────────────────────

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
		[content, setContent],
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

	const utils = api.useUtils();

	const { data: notes, isLoading } = api.note.list.useQuery(
		filterProjectId !== undefined ? { projectId: filterProjectId || null } : undefined,
		{ refetchInterval: 5000 },
	);

	const { data: projects } = api.project.list.useQuery();

	const { data: boards } = api.board.list.useQuery(
		{ projectId: promoteProjectId },
		{ enabled: !!promoteProjectId },
	);

	const { data: board } = api.board.getFull.useQuery(
		{ id: promoteBoardId },
		{ enabled: !!promoteBoardId },
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

	const createCard = api.card.create.useMutation({
		onSuccess: () => {
			if (promoteId) {
				deleteNote.mutate({ id: promoteId });
			}
			setPromoteId(null);
			setPromoteProjectId("");
			setPromoteBoardId("");
			setPromoteColumnId("");
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
		const note = notes?.find((n) => n.id === promoteId);
		if (!note || !promoteColumnId) return;
		createCard.mutate({
			columnId: promoteColumnId,
			title: note.title,
			description: note.content || undefined,
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
					<h1 className="text-2xl font-bold">Notes</h1>
					<p className="text-sm text-muted-foreground">
						Quick thoughts, ideas, and scratch space
					</p>
				</div>
				<div className="flex items-center gap-3">
					<Select
						value={filterProjectId ?? "all"}
						onValueChange={(v) => setFilterProjectId(v === "all" ? undefined : v === "none" ? "" : v)}
					>
						<SelectTrigger className="w-[180px]">
							<SelectValue placeholder="All notes" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All notes</SelectItem>
							<SelectItem value="none">General (no project)</SelectItem>
							{projects?.map((p) => (
								<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
							))}
						</SelectContent>
					</Select>
					<NoteSearchInput value={search} onChange={setSearch} />
					<NoteViewToggle view={viewMode} setView={setViewMode} />
					<Button onClick={() => { resetForm(); setCreateOpen(true); }}>
						<Plus className="mr-2 h-4 w-4" />
						New Note
					</Button>
				</div>
			</div>

			{isLoading ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : !notes || notes.length === 0 ? (
				<div className="flex flex-col items-center gap-3 py-16 text-center">
					<NotebookPen className="h-10 w-10 text-muted-foreground/40" />
					<p className="text-muted-foreground">No notes yet.</p>
					<p className="text-sm text-muted-foreground">
						Jot down ideas, questions, or thoughts. Promote them to cards when they're ready.
					</p>
				</div>
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
							onPromote: (id) => setPromoteId(id),
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
											<span>
												{new Date(viewNote.updatedAt).toLocaleDateString("en-US", {
													month: "short",
													day: "numeric",
													year: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
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
										setPromoteId(viewNote.id);
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
												<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							<NoteTagInput tags={noteTags} setTags={setNoteTags} tagInput={noteTagInput} setTagInput={setNoteTagInput} />
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
												<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							<NoteTagInput tags={noteTags} setTags={setNoteTags} tagInput={noteTagInput} setTagInput={setNoteTagInput} />
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

			{/* Promote to card dialog */}
			<Dialog open={!!promoteId} onOpenChange={() => setPromoteId(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Promote to Card</DialogTitle>
						<DialogDescription>
							Choose where to create the card. The note will be deleted after promotion.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 space-y-4">
						<div className="space-y-2">
							<Label>Project</Label>
							<Select value={promoteProjectId} onValueChange={(v) => { setPromoteProjectId(v); setPromoteBoardId(""); setPromoteColumnId(""); }}>
								<SelectTrigger>
									<SelectValue placeholder="Select project" />
								</SelectTrigger>
								<SelectContent>
									{projects?.map((p) => (
										<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{promoteProjectId && boards && (
							<div className="space-y-2">
								<Label>Board</Label>
								<Select value={promoteBoardId} onValueChange={(v) => { setPromoteBoardId(v); setPromoteColumnId(""); }}>
									<SelectTrigger>
										<SelectValue placeholder="Select board" />
									</SelectTrigger>
									<SelectContent>
										{boards.map((b) => (
											<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
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
											<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
					</div>
					<DialogFooter className="mt-6">
						<Button
							onClick={handlePromote}
							disabled={!promoteColumnId || createCard.isPending}
						>
							Promote to Card
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
