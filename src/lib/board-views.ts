import type { BoardFilters, SortMode } from "@/components/board/board-toolbar";

export type BoardView = {
	id: string;
	name: string;
	filters: BoardFilters;
	sortMode: SortMode;
	hiddenRoles: string[];
	builtIn?: boolean;
};

const emptyFilters: BoardFilters = {
	search: "",
	priority: "ALL",
	assignee: "ALL",
	tag: "ALL",
};

export const BUILT_IN_VIEWS: BoardView[] = [
	{
		id: "sprint",
		name: "Sprint View",
		filters: emptyFilters,
		sortMode: "smart",
		hiddenRoles: ["done", "parking", "backlog"],
		builtIn: true,
	},
	{
		id: "review",
		name: "Review Mode",
		filters: emptyFilters,
		sortMode: "manual",
		hiddenRoles: ["backlog", "todo", "parking"],
		builtIn: true,
	},
	{
		id: "agent-standup",
		name: "Agent Standup",
		filters: { ...emptyFilters, assignee: "AGENT" },
		sortMode: "manual",
		hiddenRoles: ["parking"],
		builtIn: true,
	},
	{
		id: "planning",
		name: "Planning",
		filters: emptyFilters,
		sortMode: "manual",
		hiddenRoles: [],
		builtIn: true,
	},
];

function storageKey(boardId: string): string {
	return `saved-views:${boardId}`;
}

export function loadCustomViews(boardId: string): BoardView[] {
	try {
		const raw = localStorage.getItem(storageKey(boardId));
		if (!raw) return [];
		return JSON.parse(raw) as BoardView[];
	} catch {
		return [];
	}
}

export function saveCustomViews(boardId: string, views: BoardView[]): void {
	localStorage.setItem(storageKey(boardId), JSON.stringify(views));
}

export function addCustomView(boardId: string, view: Omit<BoardView, "id">): BoardView {
	const views = loadCustomViews(boardId);
	const newView: BoardView = { ...view, id: `custom-${Date.now()}` };
	views.push(newView);
	saveCustomViews(boardId, views);
	return newView;
}

export function deleteCustomView(boardId: string, viewId: string): void {
	const views = loadCustomViews(boardId).filter((v) => v.id !== viewId);
	saveCustomViews(boardId, views);
}
