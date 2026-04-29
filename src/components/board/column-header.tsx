"use client";

import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";

type ColumnHeaderProps = {
	column: {
		id: string;
		name: string;
		description: string | null;
		isParking: boolean;
		cards: Array<unknown>;
	};
	boardId: string;
};

export function ColumnHeader({ column, boardId }: ColumnHeaderProps) {
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [name, setName] = useState(column.name);
	const [description, setDescription] = useState(column.description ?? "");

	const utils = api.useUtils();

	const updateColumn = api.column.update.useMutation({
		onSuccess: () => {
			utils.board.getFull.invalidate({ id: boardId });
			setEditOpen(false);
			toast.success("Column updated");
		},
		onError: (error) => toast.error(error.message),
	});

	const deleteColumn = api.column.delete.useMutation({
		onSuccess: () => {
			utils.board.getFull.invalidate({ id: boardId });
			toast.success("Column deleted");
		},
		onError: (error) => toast.error(error.message),
	});

	const handleSave = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		updateColumn.mutate({
			id: column.id,
			data: {
				name: name.trim(),
				description: description.trim() || null,
			},
		});
	};

	return (
		<>
			<div className="group mb-1 flex items-center justify-between px-1">
				<div className="flex items-center gap-2">
					<h3 className="text-sm font-semibold">{column.name}</h3>
					<Badge variant="secondary" className="text-xs">
						{column.cards.length}
					</Badge>
				</div>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
								>
									<MoreHorizontal className="h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent>Column options</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onClick={() => {
								setName(column.name);
								setDescription(column.description ?? "");
								setEditOpen(true);
							}}
						>
							<Pencil className="mr-2 h-4 w-4" />
							Edit column
						</DropdownMenuItem>
						{!column.isParking && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive focus:text-destructive"
									onClick={() => {
										if (column.cards.length > 0) {
											toast.error("Move or delete all cards first");
											return;
										}
										setDeleteOpen(true);
									}}
								>
									<Trash2 className="mr-2 h-4 w-4" />
									Delete column
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{column.description && (
				<p className="mb-2 px-1 text-xs text-muted-foreground">{column.description}</p>
			)}

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<form onSubmit={handleSave}>
						<DialogHeader>
							<DialogTitle>Edit Column</DialogTitle>
							<DialogDescription>Update the column name and description.</DialogDescription>
						</DialogHeader>
						<div className="mt-4 space-y-4">
							<div className="space-y-2">
								<Label htmlFor="col-name">Name</Label>
								<Input
									id="col-name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									autoFocus
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="col-desc">Description (optional)</Label>
								<Input
									id="col-desc"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="What belongs in this column?"
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button type="submit" disabled={updateColumn.isPending || !name.trim()}>
								{updateColumn.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete column?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete the &ldquo;{column.name}&rdquo; column. This action
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => deleteColumn.mutate({ id: column.id })}>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

export function AddColumnButton({ boardId }: { boardId: string }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const utils = api.useUtils();

	const createColumn = api.column.create.useMutation({
		onSuccess: () => {
			utils.board.getFull.invalidate({ id: boardId });
			setOpen(false);
			setName("");
			setDescription("");
			toast.success("Column added");
		},
		onError: (error) => toast.error(error.message),
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		createColumn.mutate({
			boardId,
			name: name.trim(),
			description: description.trim() || undefined,
		});
	};

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0"
						onClick={() => setOpen(true)}
					>
						<Plus className="h-4 w-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Add column</TooltipContent>
			</Tooltip>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<form onSubmit={handleSubmit}>
						<DialogHeader>
							<DialogTitle>Add Column</DialogTitle>
							<DialogDescription>Add a new column to this board.</DialogDescription>
						</DialogHeader>
						<div className="mt-4 space-y-4">
							<div className="space-y-2">
								<Label htmlFor="new-col-name">Name</Label>
								<Input
									id="new-col-name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="e.g. In Review"
									autoFocus
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="new-col-desc">Description (optional)</Label>
								<Input
									id="new-col-desc"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="What belongs in this column?"
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button type="submit" disabled={createColumn.isPending || !name.trim()}>
								{createColumn.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
								Add
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
