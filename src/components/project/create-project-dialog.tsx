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
import { COLOR_CLASSES } from "@/lib/project-colors";
import { PROJECT_COLORS, type ProjectColor } from "@/lib/schemas/project-schemas";
import { api } from "@/trpc/react";

export function CreateProjectDialog() {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [color, setColor] = useState<ProjectColor>("slate");

	const utils = api.useUtils();

	const createProject = api.project.create.useMutation({
		onSuccess: () => {
			utils.project.list.invalidate();
			setOpen(false);
			setName("");
			setDescription("");
			setColor("slate");
			toast.success("Project created");
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		createProject.mutate({
			name: name.trim(),
			description: description.trim() || undefined,
			color,
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<Plus className="mr-2 h-4 w-4" />
					New Project
				</Button>
			</DialogTrigger>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Create Project</DialogTitle>
						<DialogDescription>Create a new project to organize your work.</DialogDescription>
					</DialogHeader>
					<div className="mt-4 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">Name</Label>
							<Input
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="My Project"
								autoFocus
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="description">Description (optional)</Label>
							<Textarea
								id="description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="What is this project about?"
								rows={3}
							/>
						</div>
						<div className="space-y-2">
							<Label>Color</Label>
							<div className="flex flex-wrap gap-1.5">
								{PROJECT_COLORS.map((c) => (
									<button
										key={c}
										type="button"
										onClick={() => setColor(c)}
										className={`h-6 w-6 rounded-full ${COLOR_CLASSES[c].bg} transition-[transform,box-shadow] ${
											color === c
												? "ring-2 ring-ring ring-offset-2 ring-offset-background"
												: "hover:scale-110"
										}`}
										title={c}
									/>
								))}
							</div>
						</div>
					</div>
					<DialogFooter className="mt-6">
						<Button type="submit" disabled={createProject.isPending || !name.trim()}>
							{createProject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
