"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/trpc/react";

export function CreateBoardDialog({ projectId }: { projectId: string }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const utils = api.useUtils();

	const createBoard = api.board.create.useMutation({
		onSuccess: () => {
			utils.board.list.invalidate();
			setOpen(false);
			setName("");
			setDescription("");
			toast.success("Board created with default columns");
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		createBoard.mutate({
			projectId,
			name: name.trim(),
			description: description.trim() || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="default" size="sm">
					<Plus className="mr-2 h-4 w-4" />
					New Board
				</Button>
			</DialogTrigger>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Create Board</DialogTitle>
						<DialogDescription>
							A new board with To Do, In Progress, Done, and Parking Lot columns.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="board-name">Name</Label>
							<Input
								id="board-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Sprint 1"
								autoFocus
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="board-description">Description (optional)</Label>
							<Textarea
								id="board-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="What is this board for?"
								rows={2}
							/>
						</div>
					</div>
					<DialogFooter className="mt-6">
						<Button type="submit" disabled={createBoard.isPending || !name.trim()}>
							{createBoard.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
