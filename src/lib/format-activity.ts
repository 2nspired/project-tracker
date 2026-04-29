const ACTION_VERBS: Record<string, string> = {
	created: "created",
	updated: "edited",
	moved: "moved",
	commented: "commented on",
	linked: "linked",
	unlinked: "unlinked",
	checklist_completed: "completed item on",
	checklist_unchecked: "unchecked item on",
};

export function formatActionVerb(action: string): string {
	return ACTION_VERBS[action] ?? action;
}

export function formatActivityDescription(action: string, details: string | null): string {
	switch (action) {
		case "created":
			return "created this card";
		case "moved":
			return details ?? "moved this card";
		case "commented":
			return "added a comment";
		case "checklist_completed":
			return `completed ${details?.replace("Completed: ", "") ?? "a checklist item"}`;
		case "checklist_unchecked":
			return `unchecked ${details?.replace("Unchecked: ", "") ?? "a checklist item"}`;
		default:
			return details ?? action;
	}
}
