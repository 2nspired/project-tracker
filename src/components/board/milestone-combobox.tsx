"use client";

import { Archive, Milestone as MilestoneIcon, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { slugify } from "@/lib/slugify";
import { api } from "@/trpc/react";

type MilestoneComboboxProps = {
	cardId: string;
	projectId: string;
	currentMilestoneId: string | null;
	boardId: string;
};

// v4.2 milestone picker. Replaces the Select + sentinel + secondary-form
// pattern with a Popover + Command combobox: type-to-filter existing
// milestones (active by default; "Show archived" toggle reveals the rest),
// pick to assign, "No milestone" to unassign, "Create new" appears when no
// exact name match exists. Selecting "Create new" calls milestone.create
// then the resulting milestoneId attaches to the card in one round-trip.
export function MilestoneCombobox({
	cardId,
	projectId,
	currentMilestoneId,
	boardId,
}: MilestoneComboboxProps) {
	const utils = api.useUtils();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [showArchived, setShowArchived] = useState(false);

	const { data: milestones = [] } = api.milestone.list.useQuery({ projectId });

	const updateCard = api.card.update.useMutation({
		onSuccess: () => {
			void utils.card.getById.invalidate({ id: cardId });
			void utils.board.getFull.invalidate({ id: boardId });
		},
		onError: (error) => toast.error(error.message),
	});

	const createMilestone = api.milestone.create.useMutation({
		onSuccess: (ms) => {
			void utils.milestone.list.invalidate({ projectId });
			updateCard.mutate({ id: cardId, data: { milestoneId: ms.id } });
			setQuery("");
			setOpen(false);
		},
		onError: (error) => toast.error(error.message),
	});

	const current = milestones.find((m) => m.id === currentMilestoneId);

	const trimmedQuery = query.trim();
	const querySlug = slugify(trimmedQuery);

	// Active first; archived hidden by default. Toggle reveals everything.
	const visible = useMemo(() => {
		const list = showArchived ? milestones : milestones.filter((m) => m.state === "active");
		if (!querySlug) return list;
		return list.filter(
			(m) =>
				slugify(m.name).includes(querySlug) ||
				m.name.toLowerCase().includes(trimmedQuery.toLowerCase())
		);
	}, [milestones, showArchived, querySlug, trimmedQuery]);

	// "Create new" only appears when no existing milestone matches by slug
	// (case-insensitive) — the resolveOrCreate semantic. Uses ALL milestones
	// (including archived) for the match check so the user doesn't accidentally
	// re-create an archived one with the same name.
	const exactMatch =
		querySlug && milestones.find((m) => slugify(m.name) === querySlug);
	const showCreate = trimmedQuery.length > 0 && !exactMatch;

	const handleAssign = (milestoneId: string | null) => {
		updateCard.mutate({ id: cardId, data: { milestoneId } });
		setQuery("");
		setOpen(false);
	};

	const handleCreate = () => {
		if (!trimmedQuery) return;
		createMilestone.mutate({ projectId, name: trimmedQuery });
	};

	const triggerLabel = current ? current.name : "No milestone";
	const archivedCount = milestones.filter((m) => m.state === "archived").length;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex h-7 w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-none transition-colors hover:bg-muted/50"
				>
					<MilestoneIcon className="h-3 w-3 text-muted-foreground" />
					<span className={current ? "" : "text-muted-foreground"}>{triggerLabel}</span>
					{current?.state === "archived" && (
						<Archive className="h-3 w-3 text-muted-foreground" aria-label="archived" />
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0" align="start">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search or create milestone..."
						value={query}
						onValueChange={setQuery}
						autoFocus
					/>
					<CommandList>
						{visible.length === 0 && !showCreate && (
							<CommandEmpty>
								{trimmedQuery
									? "No matches."
									: showArchived
										? "No milestones."
										: "No active milestones."}
							</CommandEmpty>
						)}
						<CommandGroup>
							<CommandItem
								value="__none__"
								onSelect={() => handleAssign(null)}
								className="text-muted-foreground"
							>
								No milestone
							</CommandItem>
						</CommandGroup>
						{visible.length > 0 && (
							<>
								<CommandSeparator />
								<CommandGroup heading={showArchived ? "All milestones" : "Active"}>
									{visible.slice(0, 30).map((m) => (
										<CommandItem
											key={m.id}
											value={m.id}
											onSelect={() => handleAssign(m.id)}
										>
											<span className="truncate">{m.name}</span>
											{m.state === "archived" && (
												<Archive className="ml-2 h-3 w-3 text-muted-foreground" />
											)}
											<span className="ml-auto text-xs text-muted-foreground">
												{m._count.cards}
											</span>
										</CommandItem>
									))}
								</CommandGroup>
							</>
						)}
						{showCreate && (
							<>
								<CommandSeparator />
								<CommandGroup>
									<CommandItem
										value={`__create__:${querySlug}`}
										onSelect={handleCreate}
										disabled={createMilestone.isPending || updateCard.isPending}
									>
										<Plus className="mr-2 h-3 w-3" />
										<span className="truncate">
											Create new: <strong>{trimmedQuery}</strong>
										</span>
									</CommandItem>
								</CommandGroup>
							</>
						)}
						{archivedCount > 0 && (
							<>
								<CommandSeparator />
								<CommandGroup>
									<CommandItem
										value="__toggle-archived__"
										onSelect={() => setShowArchived((v) => !v)}
										className="text-xs text-muted-foreground"
									>
										<Archive className="mr-2 h-3 w-3" />
										{showArchived
											? "Hide archived"
											: `Show archived (${archivedCount})`}
									</CommandItem>
								</CommandGroup>
							</>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
