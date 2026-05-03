import { cn } from "@/lib/utils";

/**
 * Tiny semantic status dot. Resolves a `tone` to a token-backed background
 * utility (`bg-success`, `bg-accent-violet`, …) and a `size` to the standard
 * 6px / 8px circle. Replaces the inline `<span size-2 rounded-full bg-…>`
 * pattern that had grown three+ ad-hoc copies (most notably `<ViolaDot>` in
 * the Costs scope switcher) prior to #280.
 *
 * Mirrors the tone-map convention in `src/lib/priority-colors.ts` — `tone`
 * maps to a Tailwind utility, never to a hex/oklch literal, so dark mode
 * flips for free via the `--success` / `--warning` / … CSS vars defined in
 * `globals.css`.
 *
 * The `agent` tone is the AI-actor signal (cost surface accent) — pairs
 * with `<Sparkline tone="cost">` so violet stays consistent across the
 * Costs page, board scope switcher, and any agent-attributed surface.
 *
 * @example
 *   <Dot tone="agent" size="sm" aria-label="AI agent" />
 */

export type DotSize = "sm" | "md";
export type DotTone = "agent" | "success" | "warning" | "danger" | "info" | "neutral";

const SIZE_CLASS: Record<DotSize, string> = {
	sm: "size-1.5",
	md: "size-2",
};

const TONE_CLASS: Record<DotTone, string> = {
	agent: "bg-accent-violet",
	success: "bg-success",
	warning: "bg-warning",
	danger: "bg-danger",
	info: "bg-info",
	neutral: "bg-muted-foreground/30",
};

type DotProps = {
	tone: DotTone;
	size?: DotSize;
	className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "className">;

export function Dot({ tone, size = "md", className, ...rest }: DotProps) {
	// Decorative by default — callers that want a spoken label pass
	// `aria-label`/`role` via `...rest` and we drop `aria-hidden` so the
	// label survives. Mirrors the lucide icon convention.
	const isLabelled = "aria-label" in rest || "role" in rest;
	return (
		<span
			aria-hidden={isLabelled ? undefined : true}
			className={cn("inline-block rounded-full", SIZE_CLASS[size], TONE_CLASS[tone], className)}
			{...rest}
		/>
	);
}
