/**
 * Per-agent color assignment for activity surfaces.
 *
 * Palette maps to the five OKLCH chart tokens in globals.css, which are
 * re-defined under `.dark` — using `var(--chart-N)` at runtime (inline
 * style) lets the browser flip colors with the theme automatically.
 */
export const CHART_PALETTE = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
] as const;

/**
 * djb2-XOR hash. Stable across sessions: the same actor name always
 * lands on the same palette slot.
 */
export function hashAgentColor(name: string | null | undefined): string {
	const key = (name ?? "Agent").toLowerCase();
	let h = 5381;
	for (let i = 0; i < key.length; i++) {
		h = ((h << 5) + h) ^ key.charCodeAt(i);
		h = h >>> 0;
	}
	return CHART_PALETTE[h % CHART_PALETTE.length];
}

/** 1-2 uppercase letters from an actor name (e.g. "Claude" → "CL"). */
export function getInitials(name: string | null | undefined): string {
	if (!name) return "A";
	const parts = name
		.trim()
		.split(/[\s\-_]+/)
		.filter(Boolean);
	if (parts.length === 0) return "A";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Resolve an actor's visual identity: whether they're an agent, what color
 * represents them, and what name to display. Used by ActorChip, ActorDot, and
 * anywhere the activity feed needs to render an actor.
 */
export function getActorIdentity(
	actorType: "AGENT" | "HUMAN" | string,
	actorName?: string | null
): { isAgent: boolean; color: string; label: string } {
	const isAgent = actorType === "AGENT";
	const color = isAgent ? hashAgentColor(actorName) : "var(--muted-foreground)";
	const label = actorName ?? (isAgent ? "Agent" : "Human");
	return { isAgent, color, label };
}

/**
 * Left-border accent style used across activity surfaces (sheet entries,
 * card-detail activity log, board-card intent banner). Thicker + fully
 * opaque when an intent is attached; thinner + tinted otherwise.
 */
export function getAccentBorderStyle(
	color: string,
	options: { hasIntent?: boolean; withBackground?: boolean } = {}
): { borderLeft: string; backgroundColor?: string } {
	const { hasIntent = false, withBackground = false } = options;
	const style: { borderLeft: string; backgroundColor?: string } = {
		borderLeft: `${hasIntent ? 2 : 1}px solid ${
			hasIntent ? color : `color-mix(in oklch, ${color} 35%, transparent)`
		}`,
	};
	if (withBackground) {
		style.backgroundColor = `color-mix(in oklch, ${color} 8%, transparent)`;
	}
	return style;
}
