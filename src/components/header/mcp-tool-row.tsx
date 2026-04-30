"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import type { MouseEvent } from "react";
import { CommandItem } from "@/components/ui/command";
import { docUrl } from "@/lib/doc-url";
import { cn } from "@/lib/utils";

export type McpToolRowProps = {
	name: string;
	description: string;
	category?: string;
	// "essential" adds a left rule that quietly distinguishes pinned rows
	// from the Extended catalog without needing a section heading.
	variant?: "default" | "essential";
	// Filter value for cmdk. Defaults to a string built from name + description
	// + category. Override only when the row is rendered inside a list with
	// custom filtering rules.
	filterValue?: string;
	// When defined, renders an expand chevron. Caller owns expanded state.
	expanded?: boolean;
	onToggleExpand?: () => void;
	// Override the default open-in-new-tab behavior. Useful when the row
	// is rendered inside a CommandDialog that needs to close itself before
	// opening the doc URL.
	onSelect?: () => void;
};

export function McpToolRow({
	name,
	description,
	category,
	variant = "default",
	filterValue,
	expanded,
	onToggleExpand,
	onSelect,
}: McpToolRowProps) {
	const href = docUrl(name);
	const handleSelect = () => {
		if (onSelect) onSelect();
		else window.open(href, "_blank", "noopener,noreferrer");
	};

	const isExpandable = expanded !== undefined && onToggleExpand !== undefined;

	// cmdk fires CommandItem.onSelect on pointerdown, before click bubbles —
	// so stopPropagation on click would be too late. Stop pointerdown to
	// prevent the row's onSelect from firing alongside the chevron toggle
	// or the external-link click.
	const stopPointerDown = (e: { stopPropagation: () => void }) => {
		e.stopPropagation();
	};

	const handleChevronClick = (e: MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		onToggleExpand?.();
	};

	return (
		<CommandItem
			value={filterValue ?? `${name} ${description} ${category ?? ""}`}
			onSelect={handleSelect}
			className={cn(
				"group flex items-center gap-3 px-3 py-2",
				variant === "essential" && "ml-3 border-l-2 border-foreground/20 rounded-l-none pl-3"
			)}
		>
			{isExpandable ? (
				<button
					type="button"
					onClick={handleChevronClick}
					onPointerDown={stopPointerDown}
					aria-expanded={expanded}
					aria-label={expanded ? `Collapse ${name} parameters` : `Expand ${name} parameters`}
					// Touch target ≥ 44px on mobile (Apple HIG), shrinks to a
					// quiet 4px hit on desktop where pointer precision is high.
					className="-my-2 flex h-11 w-11 flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground sm:my-0 sm:h-4 sm:w-4"
				>
					<ChevronRight
						className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
					/>
				</button>
			) : (
				<span className="w-4 flex-shrink-0" aria-hidden />
			)}
			<span className="font-mono text-sm font-medium tabular-nums text-foreground">{name}</span>
			<span className="line-clamp-1 flex-1 text-xs text-muted-foreground">{description}</span>
			{category && variant !== "essential" && (
				<span className="flex-shrink-0 text-2xs uppercase tracking-[0.14em] text-muted-foreground/70">
					{category}
				</span>
			)}
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				onClick={stopPointerDown}
				onPointerDown={stopPointerDown}
				aria-label={`${name} — open docs`}
				className="flex-shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100"
			>
				<ExternalLink className="h-3.5 w-3.5" />
			</a>
		</CommandItem>
	);
}
