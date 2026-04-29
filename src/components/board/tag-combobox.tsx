"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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

type TagComboboxProps = {
	projectId: string;
	currentTags: string[];
	onChange: (tags: string[]) => void;
};

// Tag autocomplete combobox (v4.2). Reads the project's existing tags via
// api.tag.list — type to filter, select to attach, "Create new" appears when
// no exact slug match exists. Sends labels through the legacy `tags: string[]`
// shape to api.card.update; the card service handles slug resolution and the
// CardTag junction sync server-side.
export function TagCombobox({ projectId, currentTags, onChange }: TagComboboxProps) {
	const utils = api.useUtils();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const { data: tags = [] } = api.tag.list.useQuery({ projectId }, { enabled: !!projectId });

	const createTag = api.tag.create.useMutation({
		onSuccess: () => {
			void utils.tag.list.invalidate({ projectId });
		},
		onError: (error) => toast.error(error.message),
	});

	const currentSlugs = useMemo(
		() => new Set(currentTags.map((t) => slugify(t)).filter(Boolean)),
		[currentTags]
	);

	// Available = project tags minus those already on this card.
	const available = useMemo(
		() => tags.filter((t) => !currentSlugs.has(t.slug)),
		[tags, currentSlugs]
	);

	const trimmedQuery = query.trim();
	const querySlug = slugify(trimmedQuery);
	const exactMatch = querySlug && tags.find((t) => t.slug === querySlug);
	const showCreate = trimmedQuery.length > 0 && !exactMatch && !currentSlugs.has(querySlug);

	const handleSelectExisting = (label: string) => {
		onChange([...currentTags, label]);
		setQuery("");
		setOpen(false);
	};

	const handleCreate = async () => {
		if (!trimmedQuery || !querySlug) return;
		const created = await createTag.mutateAsync({ projectId, label: trimmedQuery });
		onChange([...currentTags, created.label]);
		setQuery("");
		setOpen(false);
	};

	const handleRemove = (slug: string) => {
		onChange(currentTags.filter((t) => slugify(t) !== slug));
	};

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-1">
				{currentTags.map((label) => {
					const tagSlug = slugify(label);
					return (
						<Badge
							key={tagSlug}
							variant="secondary"
							className="group cursor-pointer gap-1 pr-1"
							onClick={() => handleRemove(tagSlug)}
						>
							{label}
							<X className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
						</Badge>
					);
				})}
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:border-primary/50 hover:text-foreground"
							aria-label="Add tag"
						>
							<Plus className="h-3 w-3" />
							Tag
						</button>
					</PopoverTrigger>
					<PopoverContent className="w-72 p-0" align="start">
						<Command shouldFilter={false}>
							<CommandInput
								placeholder="Search or create tag..."
								value={query}
								onValueChange={setQuery}
								autoFocus
							/>
							<CommandList>
								{available.length === 0 && !showCreate && (
									<CommandEmpty>
										{trimmedQuery ? "No matches." : "All project tags are already on this card."}
									</CommandEmpty>
								)}
								{available.length > 0 && (
									<CommandGroup heading="Existing tags">
										{available
											.filter((t) => {
												if (!querySlug) return true;
												return t.slug.includes(querySlug) || t.label.toLowerCase().includes(trimmedQuery.toLowerCase());
											})
											.slice(0, 30)
											.map((t) => (
												<CommandItem
													key={t.id}
													value={t.slug}
													onSelect={() => handleSelectExisting(t.label)}
												>
													<span className="truncate">{t.label}</span>
													<span className="ml-auto text-xs text-muted-foreground">
														{t._count.cardTags}
													</span>
												</CommandItem>
											))}
									</CommandGroup>
								)}
								{showCreate && (
									<>
										{available.length > 0 && <CommandSeparator />}
										<CommandGroup>
											<CommandItem
												value={`__create__:${querySlug}`}
												onSelect={handleCreate}
												disabled={createTag.isPending}
											>
												<Plus className="mr-2 h-3 w-3" />
												<span className="truncate">
													Create new: <strong>{trimmedQuery}</strong>
													<span className="ml-1 text-xs text-muted-foreground">({querySlug})</span>
												</span>
											</CommandItem>
										</CommandGroup>
									</>
								)}
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
