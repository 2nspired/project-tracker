"use client";

import { Check, Eye, Plus, Save, Search, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	addCustomView,
	type BoardView,
	BUILT_IN_VIEWS,
	deleteCustomView,
	loadCustomViews,
} from "@/lib/board-views";

export type SortMode = "manual" | "smart";

export type BoardFilters = {
	search: string;
	priority: string;
	tag: string;
};

const emptyFilters: BoardFilters = {
	search: "",
	priority: "ALL",
	tag: "ALL",
};

type BoardToolbarProps = {
	boardId: string;
	filters: BoardFilters;
	onFiltersChange: (filters: BoardFilters) => void;
	sortMode: SortMode;
	onSortModeChange: (mode: SortMode) => void;
	hiddenRoles: string[];
	onHiddenRolesChange: (roles: string[]) => void;
	activeViewId: string | null;
	onViewChange: (view: BoardView | null) => void;
	availableTags: string[];
	totalCards: number;
	visibleCards: number;
};

export function BoardToolbar({
	boardId,
	filters,
	onFiltersChange,
	sortMode,
	onSortModeChange,
	hiddenRoles,
	onHiddenRolesChange,
	activeViewId,
	onViewChange,
	availableTags,
	totalCards,
	visibleCards,
}: BoardToolbarProps) {
	const hasActiveFilters =
		filters.search !== "" || filters.priority !== "ALL" || filters.tag !== "ALL";

	const hasNonDefaultState = hasActiveFilters || hiddenRoles.length > 0 || sortMode !== "manual";
	const isFiltered = hasNonDefaultState && visibleCards !== totalCards;

	return (
		<div className="flex items-center gap-3 border-b px-4 py-2">
			{/* View Selector */}
			<ViewSelector
				boardId={boardId}
				activeViewId={activeViewId}
				onViewChange={onViewChange}
				currentFilters={filters}
				currentSortMode={sortMode}
				currentHiddenRoles={hiddenRoles}
			/>

			{/* Search */}
			<div className="relative w-56">
				<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={filters.search}
					onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
					placeholder="Search cards..."
					className="h-8 pl-8 text-sm"
				/>
			</div>

			{/* Priority filter */}
			<Select
				value={filters.priority}
				onValueChange={(value) => onFiltersChange({ ...filters, priority: value })}
			>
				<SelectTrigger className="h-8 w-32 text-xs">
					<SelectValue placeholder="Priority" />
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

			{/* Tag filter */}
			{availableTags.length > 0 && (
				<Select
					value={filters.tag}
					onValueChange={(value) => onFiltersChange({ ...filters, tag: value })}
				>
					<SelectTrigger className="h-8 w-36 text-xs">
						<SelectValue placeholder="Tag" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ALL">All tags</SelectItem>
						{availableTags.map((tag) => (
							<SelectItem key={tag} value={tag}>
								{tag}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}

			{/* Sort mode toggle */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant={sortMode === "smart" ? "secondary" : "ghost"}
						size="sm"
						className="h-8 gap-1.5 px-2.5 text-xs"
						onClick={() => onSortModeChange(sortMode === "manual" ? "smart" : "manual")}
					>
						<Sparkles
							className={`h-3.5 w-3.5 ${sortMode === "smart" ? "text-amber-500" : "text-muted-foreground"}`}
						/>
						Smart
					</Button>
				</TooltipTrigger>
				<TooltipContent>Sort cards by work-next score</TooltipContent>
			</Tooltip>

			{/* Clear + count */}
			{hasNonDefaultState && (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-8 px-2 text-xs"
								onClick={() => {
									onFiltersChange(emptyFilters);
									onHiddenRolesChange([]);
									onViewChange(null);
								}}
							>
								<X className="mr-1 h-3 w-3" />
								Clear
							</Button>
						</TooltipTrigger>
						<TooltipContent>Clear all filters and views</TooltipContent>
					</Tooltip>
					{isFiltered && (
						<span className="text-xs text-muted-foreground">
							{visibleCards} of {totalCards} cards
						</span>
					)}
				</>
			)}
		</div>
	);
}

// ─── View Selector ────────────────────────────────────────────────

function ViewSelector({
	boardId,
	activeViewId,
	onViewChange,
	currentFilters,
	currentSortMode,
	currentHiddenRoles,
}: {
	boardId: string;
	activeViewId: string | null;
	onViewChange: (view: BoardView | null) => void;
	currentFilters: BoardFilters;
	currentSortMode: SortMode;
	currentHiddenRoles: string[];
}) {
	const [customViews, setCustomViews] = useState(() => loadCustomViews(boardId));
	const [saving, setSaving] = useState(false);
	const [newName, setNewName] = useState("");

	const activeView = activeViewId
		? (BUILT_IN_VIEWS.find((v) => v.id === activeViewId) ??
			customViews.find((v) => v.id === activeViewId))
		: null;

	const handleSave = () => {
		if (!newName.trim()) return;
		const view = addCustomView(boardId, {
			name: newName.trim(),
			filters: currentFilters,
			sortMode: currentSortMode,
			hiddenRoles: currentHiddenRoles,
		});
		setCustomViews(loadCustomViews(boardId));
		onViewChange(view);
		setSaving(false);
		setNewName("");
		toast.success(`View "${view.name}" saved`);
	};

	const handleDelete = (viewId: string, viewName: string) => {
		deleteCustomView(boardId, viewId);
		setCustomViews(loadCustomViews(boardId));
		if (activeViewId === viewId) onViewChange(null);
		toast.success(`View "${viewName}" deleted`);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant={activeView ? "secondary" : "outline"}
					size="sm"
					className="h-8 gap-1.5 text-xs"
				>
					<Eye className="h-3.5 w-3.5" />
					{activeView ? activeView.name : "Views"}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="w-56"
				onInteractOutside={(e) => {
					if (saving) e.preventDefault();
				}}
				onPointerDownOutside={(e) => {
					if (saving) e.preventDefault();
				}}
			>
				{/* All Cards (reset) */}
				<DropdownMenuItem onClick={() => onViewChange(null)} className="gap-2">
					{!activeViewId && <Check className="h-3.5 w-3.5" />}
					{activeViewId && <span className="w-3.5" />}
					All Cards
				</DropdownMenuItem>

				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-2xs">Built-in</DropdownMenuLabel>

				{BUILT_IN_VIEWS.map((view) => (
					<DropdownMenuItem key={view.id} onClick={() => onViewChange(view)} className="gap-2">
						{activeViewId === view.id && <Check className="h-3.5 w-3.5" />}
						{activeViewId !== view.id && <span className="w-3.5" />}
						{view.name}
					</DropdownMenuItem>
				))}

				{/* Custom views */}
				{customViews.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="text-2xs">Custom</DropdownMenuLabel>
						{customViews.map((view) => (
							<DropdownMenuItem key={view.id} className="gap-2" onClick={() => onViewChange(view)}>
								{activeViewId === view.id && <Check className="h-3.5 w-3.5" />}
								{activeViewId !== view.id && <span className="w-3.5" />}
								<span className="flex-1">{view.name}</span>
								<button
									type="button"
									className="rounded p-0.5 hover:bg-muted"
									onClick={(e) => {
										e.stopPropagation();
										handleDelete(view.id, view.name);
									}}
								>
									<Trash2 className="h-3 w-3 text-muted-foreground" />
								</button>
							</DropdownMenuItem>
						))}
					</>
				)}

				{/* Save current */}
				<DropdownMenuSeparator />
				{saving ? (
					// biome-ignore lint/a11y/useKeyWithClickEvents: onClick stops bubbling to the dropdown; form keyboard is handled by inputs/submit
					<form
						className="flex items-center gap-1.5 px-2 py-1.5"
						onClick={(e) => e.stopPropagation()}
						onSubmit={(e) => {
							e.preventDefault();
							handleSave();
						}}
					>
						<Input
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="View name..."
							className="h-7 text-xs"
							autoFocus
							onKeyDown={(e) => {
								if (e.key === "Escape") setSaving(false);
							}}
						/>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							className="h-7 px-2"
							disabled={!newName.trim()}
						>
							<Save className="h-3 w-3" />
						</Button>
					</form>
				) : (
					<DropdownMenuItem
						onClick={(e) => {
							e.preventDefault();
							setSaving(true);
						}}
						className="gap-2"
					>
						<Plus className="h-3.5 w-3.5" />
						Save current view
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export { emptyFilters };
