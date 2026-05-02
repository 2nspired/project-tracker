"use client";

import { ArrowUpRight, LayoutGrid, List, Pencil, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/ui/markdown";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { formatDate } from "@/lib/format-date";

// ─── Types ────────────────────────────────────────────────────────

export type NoteItem = {
	id: string;
	title: string;
	content: string;
	tags: string;
	updatedAt: Date;
	project?: { id: string; name: string } | null;
};

export type NoteViewMode = "card" | "list";

type NoteActions = {
	onView: (id: string) => void;
	onEdit: (note: NoteItem) => void;
	onPromote: (id: string) => void;
	onDelete: (id: string) => void;
};

// ─── View Toggle ──────────────────────────────────────────────────

export function NoteViewToggle({
	view,
	setView,
}: {
	view: NoteViewMode;
	setView: (v: NoteViewMode) => void;
}) {
	return (
		<SegmentedControl
			type="single"
			size="icon"
			value={view}
			onValueChange={(v) => v && setView(v as NoteViewMode)}
			aria-label="Notes layout"
		>
			<SegmentedControlItem value="card" aria-label="Card view" title="Card view">
				<LayoutGrid />
			</SegmentedControlItem>
			<SegmentedControlItem value="list" aria-label="List view" title="List view">
				<List />
			</SegmentedControlItem>
		</SegmentedControl>
	);
}

// ─── Tag Filter ───────────────────────────────────────────────────

export function NoteTagFilter({
	notes,
	selectedTags,
	setSelectedTags,
}: {
	notes: NoteItem[];
	selectedTags: string[];
	setSelectedTags: (tags: string[]) => void;
}) {
	const allTags = Array.from(new Set(notes.flatMap((n) => parseTags(n.tags)))).sort();

	if (allTags.length === 0) return null;

	const toggle = (tag: string) => {
		setSelectedTags(
			selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag]
		);
	};

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{allTags.map((tag) => {
				const isSelected = selectedTags.includes(tag);
				return (
					<Badge
						key={tag}
						variant={isSelected ? "default" : "outline"}
						className="cursor-pointer text-xs"
						onClick={() => toggle(tag)}
					>
						{tag}
						{isSelected && " \u00d7"}
					</Badge>
				);
			})}
		</div>
	);
}

// ─── Search ───────────────────────────────────────────────────────

export function NoteSearchInput({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className="relative">
			<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Search notes..."
				className="h-8 w-48 pl-8 text-sm"
			/>
		</div>
	);
}

export function filterNotes(
	notes: NoteItem[],
	{ search, tags }: { search: string; tags: string[] }
): NoteItem[] {
	let filtered = notes;

	if (tags.length > 0) {
		filtered = filtered.filter((n) => {
			const noteTags: string[] = JSON.parse(n.tags);
			return tags.some((t) => noteTags.includes(t));
		});
	}

	if (search.trim()) {
		const q = search.toLowerCase();
		filtered = filtered.filter(
			(n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
		);
	}

	return filtered;
}

// ─── Tag Input ────────────────────────────────────────────────────

export function NoteTagInput({
	tags,
	setTags,
	tagInput,
	setTagInput,
}: {
	tags: string[];
	setTags: (tags: string[]) => void;
	tagInput: string;
	setTagInput: (v: string) => void;
}) {
	return (
		<div className="space-y-2">
			<Label>Tags</Label>
			<Input
				value={tagInput}
				onChange={(e) => setTagInput(e.target.value)}
				placeholder="Add tag (e.g. improvement, idea)"
				className="h-8 w-48 text-sm"
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						const val = tagInput.trim();
						if (val && !tags.includes(val)) {
							setTags([...tags, val]);
						}
						setTagInput("");
					}
				}}
			/>
			{tags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{tags.map((tag) => (
						<Badge
							key={tag}
							variant="secondary"
							className="cursor-pointer"
							onClick={() => setTags(tags.filter((t) => t !== tag))}
						>
							{tag} &times;
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}

// ─── Shared helpers ───────────────────────────────────────────────

function parseTags(tags: string): string[] {
	try {
		const parsed = JSON.parse(tags);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function NoteActionButtons({
	note,
	actions,
	className,
}: {
	note: NoteItem;
	actions: NoteActions;
	className?: string;
}) {
	return (
		<div className={`flex shrink-0 gap-1 ${className ?? ""}`}>
			<Button
				variant="ghost"
				size="sm"
				className="h-8 w-8 p-0"
				title="Promote to card"
				onClick={(e) => {
					e.stopPropagation();
					actions.onPromote(note.id);
				}}
			>
				<ArrowUpRight className="h-3.5 w-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="h-8 w-8 p-0"
				onClick={(e) => {
					e.stopPropagation();
					actions.onEdit(note);
				}}
			>
				<Pencil className="h-3.5 w-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="h-8 w-8 p-0 text-destructive"
				onClick={(e) => {
					e.stopPropagation();
					if (confirm("Delete this note?")) actions.onDelete(note.id);
				}}
			>
				<Trash2 className="h-3.5 w-3.5" />
			</Button>
		</div>
	);
}

function NoteTags({ tags }: { tags: string[] }) {
	if (tags.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1">
			{tags.map((tag) => (
				<Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">
					{tag}
				</Badge>
			))}
		</div>
	);
}

// ─── Card View ────────────────────────────────────────────────────

function NoteCard({
	note,
	actions,
	showProject,
}: {
	note: NoteItem;
	actions: NoteActions;
	showProject?: boolean;
}) {
	const tags = parseTags(note.tags);

	return (
		// biome-ignore lint/a11y/useSemanticElements: nested action buttons forbid converting outer to <button>
		<div
			role="button"
			tabIndex={0}
			onClick={() => actions.onView(note.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") actions.onView(note.id);
			}}
			className="group flex cursor-pointer flex-col rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
		>
			<div className="mb-2 flex w-full items-start justify-between">
				<div className="min-w-0 flex-1">
					<h3 className="font-medium">{note.title}</h3>
					{showProject && note.project && (
						<span className="text-xs text-muted-foreground">{note.project.name}</span>
					)}
				</div>
				<NoteActionButtons
					note={note}
					actions={actions}
					className="opacity-0 transition-opacity group-hover:opacity-100"
				/>
			</div>
			{tags.length > 0 && (
				<div className="mb-2">
					<NoteTags tags={tags} />
				</div>
			)}
			{note.content && (
				<div className="flex-1 text-sm text-muted-foreground">
					<div className="line-clamp-6">
						<Markdown>{note.content}</Markdown>
					</div>
				</div>
			)}
			<p className="mt-2 text-2xs text-muted-foreground/60">
				{formatDate(note.updatedAt, { includeTime: true })}
			</p>
		</div>
	);
}

// ─── List View ────────────────────────────────────────────────────

function NoteListItem({
	note,
	actions,
	showProject,
}: {
	note: NoteItem;
	actions: NoteActions;
	showProject?: boolean;
}) {
	const tags = parseTags(note.tags);

	return (
		// biome-ignore lint/a11y/useSemanticElements: nested action buttons forbid converting outer to <button>
		<div
			role="button"
			tabIndex={0}
			onClick={() => actions.onView(note.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") actions.onView(note.id);
			}}
			className="group flex cursor-pointer items-center gap-4 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<h3 className="truncate font-medium">{note.title}</h3>
					{showProject && note.project && (
						<span className="shrink-0 text-xs text-muted-foreground">{note.project.name}</span>
					)}
				</div>
				{note.content && (
					<p className="mt-0.5 truncate text-sm text-muted-foreground">
						{note.content.replace(/[#*_`>\-[\]()]/g, "").slice(0, 120)}
					</p>
				)}
				{tags.length > 0 && (
					<div className="mt-1.5">
						<NoteTags tags={tags} />
					</div>
				)}
			</div>
			<span className="shrink-0 text-2xs text-muted-foreground/60">
				{formatDate(note.updatedAt, { includeTime: true })}
			</span>
			<NoteActionButtons
				note={note}
				actions={actions}
				className="opacity-0 transition-opacity group-hover:opacity-100"
			/>
		</div>
	);
}

// ─── Combined View ────────────────────────────────────────────────

export function NoteCollection({
	notes,
	view,
	actions,
	showProject,
}: {
	notes: NoteItem[];
	view: NoteViewMode;
	actions: NoteActions;
	showProject?: boolean;
}) {
	if (view === "list") {
		return (
			<div className="flex flex-col gap-2">
				{notes.map((note) => (
					<NoteListItem key={note.id} note={note} actions={actions} showProject={showProject} />
				))}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
			{notes.map((note) => (
				<NoteCard key={note.id} note={note} actions={actions} showProject={showProject} />
			))}
		</div>
	);
}
