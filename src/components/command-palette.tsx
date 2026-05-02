"use client";

import { FolderKanban, Hash, LayoutDashboard, Plus, StickyNote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { McpToolRow } from "@/components/header/mcp-tool-row";
import { SlashCommandRow } from "@/components/header/slash-command-row";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { docUrl, slashCommandDocUrl } from "@/lib/doc-url";
import { PRIORITY_DOT } from "@/lib/priority-colors";
import type { Priority } from "@/lib/schemas/card-schemas";
import { api } from "@/trpc/react";

export function CommandPalette() {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const router = useRouter();

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search);
		}, 300);
		return () => clearTimeout(timer);
	}, [search]);

	// Listen for Cmd+K / Ctrl+K
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, []);

	// Reset search when closing
	const handleOpenChange = useCallback((value: boolean) => {
		setOpen(value);
		if (!value) {
			setSearch("");
			setDebouncedSearch("");
		}
	}, []);

	// Search cards only when palette is open and there's a search term
	const { data: cards, isLoading: cardsLoading } = api.card.listAll.useQuery(
		{ search: debouncedSearch },
		{
			enabled: open && debouncedSearch.length > 0,
		}
	);

	// MCP tool catalog — fetched lazily on first open. Only the Essentials
	// shortlist surfaces here; full catalog lives in the dedicated header
	// popover. One source (system.toolCatalog), two surfaces.
	const { data: mcpCatalog } = api.system.toolCatalog.useQuery(undefined, {
		enabled: open,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const runCommand = useCallback(
		(command: () => void) => {
			handleOpenChange(false);
			command();
		},
		[handleOpenChange]
	);

	return (
		<CommandDialog
			open={open}
			onOpenChange={handleOpenChange}
			title="Command Palette"
			description="Search cards, navigate, or run actions"
			showCloseButton={false}
		>
			<CommandInput
				placeholder="Search cards, pages, actions…"
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList>
				<CommandEmpty>{cardsLoading ? "Searching…" : "No results found."}</CommandEmpty>

				{/* Slash Commands — Claude Code slash commands users actually
				    type at session boundaries. Surfaced above MCP tools
				    because they're the real entry points; the underlying
				    MCP tools are an implementation detail. Common-only
				    here; the full list lives in the header catalog. */}
				{mcpCatalog?.slashCommands?.some((c) => c.common) && (
					<CommandGroup heading="Slash Commands">
						{mcpCatalog.slashCommands
							.filter((cmd) => cmd.common)
							.map((cmd) => (
								<SlashCommandRow
									key={cmd.name}
									name={cmd.name}
									description={cmd.description}
									tools={cmd.tools}
									href={slashCommandDocUrl(cmd.name)}
									filterValue={`slash-${cmd.name}-${cmd.description}-${cmd.tools.join(" ")}`}
									onSelect={() =>
										runCommand(() => {
											window.open(slashCommandDocUrl(cmd.name), "_blank", "noopener,noreferrer");
										})
									}
								/>
							))}
					</CommandGroup>
				)}

				{/* MCP Essentials — pinned shortlist of the 10 core MCP tools.
				    Reuses the same row component as the dedicated catalog
				    popover so the surfaces stay visually identical. */}
				{mcpCatalog && mcpCatalog.essentials.length > 0 && (
					<CommandGroup heading="MCP Tools — Essentials">
						{mcpCatalog.essentials.map((tool) => (
							<McpToolRow
								key={tool.name}
								name={tool.name}
								description={tool.description}
								filterValue={`mcp-${tool.name}-${tool.description}`}
								onSelect={() =>
									runCommand(() => {
										window.open(docUrl(tool.name), "_blank", "noopener,noreferrer");
									})
								}
							/>
						))}
					</CommandGroup>
				)}

				{/* Card search results */}
				{debouncedSearch.length > 0 && cards && cards.length > 0 && (
					<CommandGroup heading="Cards">
						{cards.map((card) => (
							<CommandItem
								key={card.id}
								value={`card-${card.number}-${card.title}`}
								onSelect={() =>
									runCommand(() => {
										const url = `/projects/${card.column.board.project.id}/boards/${card.column.board.id}`;
										router.push(url as Parameters<typeof router.push>[0]);
									})
								}
							>
								<Hash className="size-4 text-muted-foreground" />
								<span className="flex-1 truncate">
									<span className="text-muted-foreground">#{card.number}</span> {card.title}
								</span>
								<span className="flex items-center gap-2">
									<span
										className={`size-2 rounded-full ${PRIORITY_DOT[card.priority as Priority] ?? PRIORITY_DOT.NONE}`}
									/>
									<span className="max-w-[120px] truncate text-xs text-muted-foreground">
										{card.column.name}
									</span>
								</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}

				{/* Navigation */}
				<CommandGroup heading="Navigation">
					<CommandItem value="projects" onSelect={() => runCommand(() => router.push("/projects"))}>
						<FolderKanban className="size-4" />
						Projects
					</CommandItem>
					<CommandItem
						value="dashboard"
						onSelect={() => runCommand(() => router.push("/dashboard"))}
					>
						<LayoutDashboard className="size-4" />
						Dashboard
					</CommandItem>
					<CommandItem value="notes" onSelect={() => runCommand(() => router.push("/notes"))}>
						<StickyNote className="size-4" />
						Notes
					</CommandItem>
				</CommandGroup>

				<CommandSeparator />

				{/* Actions */}
				<CommandGroup heading="Actions">
					<CommandItem
						value="create new project"
						onSelect={() => runCommand(() => router.push("/projects"))}
					>
						<Plus className="size-4" />
						Create new project
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
