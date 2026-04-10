/**
 * Column role → horizon mapping, shared across server, MCP, and UI.
 *
 * Roles: backlog, todo, active, review, done, parking
 * Horizons: now (active work), next (queued), later (backlog/parking), done
 *
 * Falls back to name-based matching for columns without a role (pre-migration).
 */

export type Horizon = "now" | "next" | "later" | "done";

const ROLE_TO_HORIZON: Record<string, Horizon> = {
	active: "now",
	review: "now",
	todo: "next",
	done: "done",
	backlog: "later",
	parking: "later",
};

/** Map a column to a horizon using role (preferred) or name (fallback). */
export function getHorizon(column: { role?: string | null; name: string }): Horizon {
	if (column.role && column.role in ROLE_TO_HORIZON) {
		return ROLE_TO_HORIZON[column.role];
	}
	// Fallback for columns without role (pre-migration or custom columns)
	const lower = column.name.toLowerCase();
	if (lower === "done") return "done";
	if (lower === "in progress" || lower === "review") return "now";
	if (lower === "to do") return "next";
	return "later";
}

/** Check if a column has a specific role, falling back to name matching. */
export function hasRole(column: { role?: string | null; name: string }, role: string): boolean {
	if (column.role) return column.role === role;
	// Name-based fallback
	const lower = column.name.toLowerCase();
	switch (role) {
		case "done": return lower === "done";
		case "active": return lower === "in progress";
		case "review": return lower === "review";
		case "todo": return lower === "to do";
		case "backlog": return lower === "backlog";
		case "parking": return lower === "parking lot" || lower === "parking";
		default: return false;
	}
}
