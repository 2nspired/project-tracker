"use client";

import { ExternalLink } from "lucide-react";
import { Fragment } from "react";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SlashCommandRowProps = {
	name: string;
	description: string;
	tools: string[];
	// Filter value for cmdk. Defaults to a string built from name +
	// description + tools so a search like "handoff" matches /handoff
	// regardless of whether the user types the slash or the tool name.
	filterValue?: string;
	href: string;
	onSelect?: () => void;
	// "essential" matches McpToolRow's pinned variant — same left rule
	// so the Cmd-K palette stays visually aligned across both groups.
	variant?: "default" | "essential";
};

// Mirrors McpToolRow's shape but adds a "calls X, Y" footer so users
// can see which underlying MCP tool(s) the slash command runs. Keeping
// it as its own component (rather than overloading McpToolRow) avoids
// a footer-conditional that would only ever fire from this surface.
export function SlashCommandRow({
	name,
	description,
	tools,
	filterValue,
	href,
	onSelect,
	variant = "default",
}: SlashCommandRowProps) {
	const handleSelect = () => {
		if (onSelect) onSelect();
		else window.open(href, "_blank", "noopener,noreferrer");
	};

	const stopPointerDown = (e: { stopPropagation: () => void }) => {
		e.stopPropagation();
	};

	return (
		<CommandItem
			value={filterValue ?? `${name} ${description} ${tools.join(" ")}`}
			onSelect={handleSelect}
			className={cn(
				"group flex flex-col items-stretch gap-0.5 px-3 py-2",
				variant === "essential" && "ml-3 border-l-2 border-foreground/20 rounded-l-none pl-3"
			)}
		>
			<div className="flex items-center gap-3">
				<span className="w-4 flex-shrink-0" aria-hidden />
				<span className="font-mono text-sm font-medium tabular-nums text-foreground">{name}</span>
				<span className="line-clamp-1 flex-1 text-xs text-muted-foreground">{description}</span>
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
			</div>
			{tools.length > 0 && (
				<div className="ml-7 truncate text-2xs text-muted-foreground/70">
					calls{" "}
					{tools.map((tool, idx) => (
						<Fragment key={tool}>
							{idx > 0 && ", "}
							<code className="font-mono text-foreground/80">{tool}</code>
						</Fragment>
					))}
				</div>
			)}
		</CommandItem>
	);
}
