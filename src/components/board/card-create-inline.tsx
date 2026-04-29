"use client";

import { FileText, Info, Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { findSimilarCards } from "@/lib/card-similarity";
import { type CardTemplate, cardTemplates } from "@/lib/card-templates";
import { api } from "@/trpc/react";

export function CardCreateInline({ columnId, boardId }: { columnId: string; boardId: string }) {
	const [isCreating, setIsCreating] = useState(false);
	const [title, setTitle] = useState("");
	const [template, setTemplate] = useState<CardTemplate | null>(null);

	const utils = api.useUtils();

	// Get existing cards from the board cache for similarity detection
	const { data: board } = api.board.getFull.useQuery(
		{ id: boardId },
		{ enabled: isCreating } // only fetch when creating
	);

	const allBoardCards = useMemo(() => {
		if (!board) return [];
		return board.columns.flatMap((col) =>
			col.cards.map((c) => ({ id: c.id, number: c.number, title: c.title }))
		);
	}, [board]);

	const similarCards = useMemo(
		() => findSimilarCards(title, allBoardCards),
		[title, allBoardCards]
	);

	const createCard = api.card.create.useMutation({
		onSuccess: (card) => {
			utils.board.getFull.invalidate({ id: boardId });
			// If template has checklist items, create them
			if (template?.checklist.length) {
				for (const text of template.checklist) {
					createChecklist.mutate({ cardId: card.id, text });
				}
			}
			setTitle("");
			setTemplate(null);
			setIsCreating(false);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const createChecklist = api.checklist.create.useMutation({
		onSuccess: () => {
			utils.board.getFull.invalidate({ id: boardId });
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!title.trim()) return;
		createCard.mutate({
			columnId,
			title: title.trim(),
			description: template?.description,
			priority: template?.priority,
			tags: template?.tags,
		});
	};

	const handleTemplate = (t: CardTemplate) => {
		setTemplate(t);
		setTitle(t.title);
		setIsCreating(true);
	};

	if (!isCreating) {
		return (
			<div className="flex gap-1">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="flex-1 justify-start text-muted-foreground"
							onClick={() => setIsCreating(true)}
						>
							<Plus className="mr-2 h-4 w-4" />
							Add card
						</Button>
					</TooltipTrigger>
					<TooltipContent>Add a new card</TooltipContent>
				</Tooltip>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="text-muted-foreground">
									<FileText className="h-3.5 w-3.5" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent>Create from template</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end">
						{cardTemplates.map((t) => (
							<DropdownMenuItem key={t.name} onClick={() => handleTemplate(t)}>
								{t.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-2">
			{template && (
				<div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<FileText className="h-3 w-3" />
					{template.name} template
				</div>
			)}
			<Input
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="Card title..."
				autoFocus
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						setIsCreating(false);
						setTitle("");
						setTemplate(null);
					}
				}}
			/>
			{similarCards.length > 0 && (
				<div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
					<div className="flex items-center gap-1 text-2xs font-medium text-amber-600 dark:text-amber-400">
						<Info className="h-3 w-3" />
						Similar card{similarCards.length > 1 ? "s" : ""} found
					</div>
					{similarCards.map((match) => (
						<div key={match.id} className="mt-0.5 text-2xs text-muted-foreground">
							<span className="font-mono">#{match.number}</span> <span>{match.title}</span>
							<span className="ml-1 opacity-50">({Math.round(match.score * 100)}%)</span>
						</div>
					))}
				</div>
			)}
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={createCard.isPending || !title.trim()}>
					{createCard.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
					Add
				</Button>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setIsCreating(false);
								setTitle("");
								setTemplate(null);
							}}
						>
							<X className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Cancel</TooltipContent>
				</Tooltip>
			</div>
		</form>
	);
}
