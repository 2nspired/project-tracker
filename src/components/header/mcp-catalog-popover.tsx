"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { McpToolRow } from "@/components/header/mcp-tool-row";
import { SlashCommandRow } from "@/components/header/slash-command-row";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { slashCommandDocUrl } from "@/lib/doc-url";
import type { ToolParamInfo } from "@/lib/mcp-types";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const CATEGORY_LABELS: Record<string, string> = {
	discovery: "Discovery",
	cards: "Cards",
	checklist: "Checklist",
	comments: "Comments",
	milestones: "Milestones",
	tags: "Tags",
	notes: "Notes",
	activity: "Activity",
	setup: "Setup",
	relations: "Relations",
	session: "Sessions",
	decisions: "Decisions",
	git: "Git",
	context: "Context",
	diagnostics: "Diagnostics",
};

const STORAGE_KEY = "mcp-catalog:expanded-categories";
const DEFAULT_EXPANDED = new Set<string>(["cards"]);

function loadExpandedCategories(): Set<string> {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return new Set(DEFAULT_EXPANDED);
		const parsed = JSON.parse(raw);
		return new Set(Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : []);
	} catch {
		return new Set(DEFAULT_EXPANDED);
	}
}

function saveExpandedCategories(set: Set<string>) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
	} catch {
		// localStorage can throw in private browsing — ignore.
	}
}

type ExtendedTool = {
	name: string;
	category: string;
	description: string;
	readOnly: boolean;
	destructive: boolean;
};

export function McpCatalogPopover({
	enabled,
	fullWidth = false,
}: {
	enabled: boolean;
	// In Sheet mode the parent already provides width; drop the fixed
	// 28rem so the catalog spans the viewport.
	fullWidth?: boolean;
}) {
	const { data, isLoading, error } = api.system.toolCatalog.useQuery(undefined, {
		enabled,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const [search, setSearch] = useState("");
	// Defer localStorage to a post-mount effect so SSR/hydration agree on
	// the initial set. The flash-of-collapsed-categories on first paint is
	// imperceptible because the popover itself only mounts on user click.
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
		() => new Set(DEFAULT_EXPANDED)
	);
	useEffect(() => {
		setExpandedCategories(loadExpandedCategories());
	}, []);

	const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

	const handleSearchChange = (next: string) => {
		setSearch((prev) => {
			// Collapse all per-tool param previews when the search changes —
			// they'd otherwise dangle below filtered-out rows.
			if (prev !== next) setExpandedTools(new Set());
			return next;
		});
	};

	const isSearching = search.trim().length > 0;

	const grouped = useMemo(() => {
		const map = new Map<string, ExtendedTool[]>();
		for (const tool of (data?.extended ?? []) as ExtendedTool[]) {
			const list = map.get(tool.category) ?? [];
			list.push(tool);
			map.set(tool.category, list);
		}
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [data]);

	const toggleCategory = (category: string) => {
		setExpandedCategories((prev) => {
			const next = new Set(prev);
			if (next.has(category)) next.delete(category);
			else next.add(category);
			saveExpandedCategories(next);
			return next;
		});
	};

	const toggleTool = (name: string) => {
		setExpandedTools((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	};

	return (
		<Command className={fullWidth ? "h-full w-full" : "w-[28rem] max-h-[min(36rem,75vh)]"}>
			<CommandInput
				placeholder="Search MCP tools…"
				value={search}
				onValueChange={handleSearchChange}
				autoFocus
			/>
			<CommandList className={fullWidth ? "flex-1" : "max-h-[min(32rem,65vh)]"}>
				{isLoading && (
					<div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading tools…</div>
				)}

				{error && (
					<div className="px-4 py-6 text-center text-xs text-muted-foreground">
						Could not load MCP tools — check the dev server.
					</div>
				)}

				{data && (
					<>
						<CommandEmpty>
							No tools match "{search.trim()}". Try a category name like cards or sessions.
						</CommandEmpty>

						{/* Slash commands — the user-facing entry points. Common
						    ones appear first, divided from the rest by a thin
						    separator. Shown above MCP essentials because users
						    type slash commands; MCP tools are downstream. */}
						{data.slashCommands && data.slashCommands.length > 0 && (
							<>
								<CommandGroup heading="Slash Commands" className="py-1">
									{data.slashCommands
										.filter((cmd) => cmd.common)
										.map((cmd) => (
											<SlashCommandRow
												key={cmd.name}
												name={cmd.name}
												description={cmd.description}
												tools={cmd.tools}
												href={slashCommandDocUrl(cmd.name)}
												variant="essential"
											/>
										))}
									{data.slashCommands.some((cmd) => !cmd.common) && (
										<>
											<div className="mx-3 my-1 border-t border-border/60" aria-hidden />
											{data.slashCommands
												.filter((cmd) => !cmd.common)
												.map((cmd) => (
													<SlashCommandRow
														key={cmd.name}
														name={cmd.name}
														description={cmd.description}
														tools={cmd.tools}
														href={slashCommandDocUrl(cmd.name)}
													/>
												))}
										</>
									)}
								</CommandGroup>
								<CommandSeparator />
							</>
						)}

						<CommandGroup className="py-1">
							{data.essentials.map((tool) => {
								const schema = data.schemas[tool.name];
								const hasSchema = !!schema && Object.keys(schema).length > 0;
								const expanded = expandedTools.has(tool.name);
								return (
									<div key={tool.name}>
										<McpToolRow
											name={tool.name}
											description={tool.description}
											variant="essential"
											expanded={hasSchema ? expanded : undefined}
											onToggleExpand={hasSchema ? () => toggleTool(tool.name) : undefined}
										/>
										{expanded && hasSchema && <ParamPreview schema={schema} />}
									</div>
								);
							})}
						</CommandGroup>

						{!isSearching && <CommandSeparator />}

						{grouped.map(([category, tools]) => {
							const isOpen = isSearching || expandedCategories.has(category);
							const label = CATEGORY_LABELS[category] ?? category;
							return (
								<div key={category}>
									{!isSearching && (
										<button
											type="button"
											onClick={() => toggleCategory(category)}
											aria-expanded={isOpen}
											aria-controls={`mcp-cat-${category}`}
											className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
										>
											<ChevronRight
												className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")}
											/>
											<span className="flex-1 font-medium uppercase tracking-[0.14em] text-2xs">
												{label}
											</span>
											<span className="font-mono text-2xs">{tools.length}</span>
										</button>
									)}
									{isOpen && (
										<CommandGroup id={`mcp-cat-${category}`} className="py-0">
											{tools.map((tool) => {
												const schema = data.schemas[tool.name];
												const hasSchema = !!schema && Object.keys(schema).length > 0;
												const expanded = expandedTools.has(tool.name);
												return (
													<div key={tool.name}>
														<McpToolRow
															name={tool.name}
															description={tool.description}
															category={label}
															expanded={hasSchema ? expanded : undefined}
															onToggleExpand={hasSchema ? () => toggleTool(tool.name) : undefined}
														/>
														{expanded && hasSchema && <ParamPreview schema={schema} />}
													</div>
												);
											})}
										</CommandGroup>
									)}
								</div>
							);
						})}
					</>
				)}
			</CommandList>
		</Command>
	);
}

function ParamPreview({ schema }: { schema: Record<string, ToolParamInfo> }) {
	const entries = Object.entries(schema);
	return (
		<section
			aria-label="Parameter schema"
			className="mx-2 mb-1.5 rounded-md bg-muted px-3 py-2.5 text-xs animate-in fade-in-0 slide-in-from-top-1 duration-150"
		>
			<div className="mb-1 text-2xs uppercase tracking-[0.14em] text-muted-foreground">Params</div>
			<div className="space-y-1.5 font-mono">
				{entries.map(([param, info]) => (
					<div key={param} className="leading-snug">
						<span className="text-foreground">{param}</span>
						<span className="text-muted-foreground">
							{info.required ? ": " : "?: "}
							{info.type}
						</span>
						{info.description && (
							<div className="ml-3 mt-0.5 font-sans text-[10px] text-muted-foreground">
								{info.description}
							</div>
						)}
					</div>
				))}
			</div>
		</section>
	);
}
