"use client";

import { Bot, Search, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type SortMode = "manual" | "smart";

export type BoardFilters = {
	search: string;
	priority: string;
	assignee: string;
	tag: string;
};

const emptyFilters: BoardFilters = {
	search: "",
	priority: "ALL",
	assignee: "ALL",
	tag: "ALL",
};

type BoardToolbarProps = {
	filters: BoardFilters;
	onFiltersChange: (filters: BoardFilters) => void;
	sortMode: SortMode;
	onSortModeChange: (mode: SortMode) => void;
	availableTags: string[];
	totalCards: number;
	visibleCards: number;
};

export function BoardToolbar({
	filters,
	onFiltersChange,
	sortMode,
	onSortModeChange,
	availableTags,
	totalCards,
	visibleCards,
}: BoardToolbarProps) {
	const hasActiveFilters =
		filters.search !== "" ||
		filters.priority !== "ALL" ||
		filters.assignee !== "ALL" ||
		filters.tag !== "ALL";

	const isFiltered = hasActiveFilters && visibleCards !== totalCards;

	return (
		<div className="flex items-center gap-3 border-b px-4 py-2">
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

			{/* Assignee filter */}
			<Select
				value={filters.assignee}
				onValueChange={(value) => onFiltersChange({ ...filters, assignee: value })}
			>
				<SelectTrigger className="h-8 w-32 text-xs">
					<SelectValue placeholder="Assignee" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="ALL">All assignees</SelectItem>
					<SelectItem value="HUMAN">
						<span className="flex items-center gap-1.5">
							<User className="h-3 w-3" /> Human
						</span>
					</SelectItem>
					<SelectItem value="AGENT">
						<span className="flex items-center gap-1.5">
							<Bot className="h-3.5 w-3.5 text-violet-500" /> Agent
						</span>
					</SelectItem>
					<SelectItem value="UNASSIGNED">Unassigned</SelectItem>
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
			{hasActiveFilters && (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-8 px-2 text-xs"
								onClick={() => onFiltersChange(emptyFilters)}
							>
								<X className="mr-1 h-3 w-3" />
								Clear
							</Button>
						</TooltipTrigger>
						<TooltipContent>Clear all filters</TooltipContent>
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

export { emptyFilters };
