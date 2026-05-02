import type { Priority } from "@/lib/schemas/card-schemas";

/** Dot indicators (small colored circles) */
export const PRIORITY_DOT: Record<Priority, string> = {
	NONE: "bg-muted-foreground/30",
	LOW: "bg-blue-400",
	MEDIUM: "bg-amber-400",
	HIGH: "bg-orange-500",
	URGENT: "bg-red-500",
};

/** Left-border accent on cards */
export const PRIORITY_BORDER: Record<Priority, string> = {
	NONE: "border-l-transparent",
	LOW: "border-l-blue-400",
	MEDIUM: "border-l-amber-400",
	HIGH: "border-l-orange-500",
	URGENT: "border-l-red-500",
};

/** Full badge styling (border + bg + text, light/dark) */
export const PRIORITY_BADGE: Record<Priority, string> = {
	NONE: "border-border text-muted-foreground",
	LOW: "border-blue-400/50 bg-blue-400/10 text-blue-600 dark:text-blue-400",
	MEDIUM: "border-amber-400/50 bg-amber-400/10 text-amber-600 dark:text-amber-400",
	HIGH: "border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400",
	URGENT: "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-500",
};

/**
 * Semantic status colors used across board, roadmap, and detail views.
 *
 * Reference: GitHub Primer's `success.fg / attention.fg / danger.fg / accent.fg`
 * pattern (#241). `--success / --warning / --danger / --info` are defined in
 * `src/app/globals.css` (`:root` and `.dark`) and registered as Tailwind v4
 * utilities via `@theme inline` so `text-success`, `bg-warning/10`, etc.
 * resolve like any other color utility.
 */
export const STATUS_DOT: Record<string, string> = {
	blocked: "bg-danger",
	done: "bg-success",
	warning: "bg-warning",
};

export const STATUS_TEXT: Record<string, string> = {
	blocked: "text-danger",
	done: "text-success",
	warning: "text-warning",
};

export const STATUS_BG: Record<string, string> = {
	blocked: "bg-danger/5",
	done: "bg-success/5",
	warning: "bg-warning/5",
};

export const STATUS_BORDER: Record<string, string> = {
	blocked: "border-danger/30",
	done: "border-success/20",
	warning: "border-warning/30",
};

/** Roadmap horizon colors */
export const HORIZON_DOT: Record<string, string> = {
	now: "bg-info",
	later: "bg-muted-foreground/30",
	done: "bg-success",
};

// Semantic color for AI agent indicators (cost surface accent).
// `--accent-violet` is defined in globals.css and auto-flips in dark mode.
export const AGENT_COLOR = "text-accent-violet";
export const AGENT_DOT = "bg-accent-violet";
