"use client";

import { ArrowDown, ArrowUp, Calendar, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format-date";
import { api } from "@/trpc/react";

export function MilestoneManager({
	projectId,
	open,
	onClose,
}: {
	projectId: string;
	open: boolean;
	onClose: () => void;
}) {
	const utils = api.useUtils();

	const { data: milestones } = api.milestone.list.useQuery({ projectId }, { enabled: open });

	const createMilestone = api.milestone.create.useMutation({
		onSuccess: () => {
			utils.milestone.list.invalidate({ projectId });
			toast.success("Milestone created");
		},
		onError: (e) => toast.error(e.message),
	});

	const updateMilestone = api.milestone.update.useMutation({
		onSuccess: () => {
			utils.milestone.list.invalidate({ projectId });
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteMilestone = api.milestone.delete.useMutation({
		onSuccess: () => {
			utils.milestone.list.invalidate({ projectId });
			utils.board.getFull.invalidate();
			toast.success("Milestone deleted");
		},
		onError: (e) => toast.error(e.message),
	});

	const reorderMilestones = api.milestone.reorder.useMutation({
		onSuccess: () => {
			utils.milestone.list.invalidate({ projectId });
		},
	});

	const [newName, setNewName] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);

	const handleCreate = () => {
		if (!newName.trim()) return;
		createMilestone.mutate({ projectId, name: newName.trim() });
		setNewName("");
	};

	const handleMove = (index: number, direction: -1 | 1) => {
		if (!milestones) return;
		const newOrder = [...milestones];
		const target = index + direction;
		if (target < 0 || target >= newOrder.length) return;
		[newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
		reorderMilestones.mutate({
			projectId,
			orderedIds: newOrder.map((m) => m.id),
		});
	};

	return (
		<Sheet open={open} onOpenChange={() => onClose()}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-lg">
				<SheetHeader>
					<SheetTitle>Manage Milestones</SheetTitle>
					<SheetDescription>Create and organize milestones for your roadmap.</SheetDescription>
				</SheetHeader>

				<div className="space-y-4 px-4 pb-6">
					{/* Create new */}
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							handleCreate();
						}}
					>
						<Input
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="New milestone name..."
						/>
						<Button type="submit" variant="outline" size="sm" disabled={!newName.trim()}>
							<Plus className="mr-1 h-4 w-4" />
							Add
						</Button>
					</form>

					{/* List */}
					<div className="space-y-2">
						{milestones?.map((ms, i) => (
							<div key={ms.id} className="rounded-lg border bg-card p-3">
								{editingId === ms.id ? (
									<MilestoneEditForm
										milestone={ms}
										onSave={(data) => {
											updateMilestone.mutate({ id: ms.id, data });
											setEditingId(null);
										}}
										onCancel={() => setEditingId(null)}
									/>
								) : (
									<div className="flex items-center gap-2">
										<div className="flex flex-col gap-0.5">
											<Button
												variant="ghost"
												size="icon"
												className="h-5 w-5"
												onClick={() => handleMove(i, -1)}
												disabled={i === 0}
											>
												<ArrowUp className="h-3 w-3" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												className="h-5 w-5"
												onClick={() => handleMove(i, 1)}
												disabled={i === milestones.length - 1}
											>
												<ArrowDown className="h-3 w-3" />
											</Button>
										</div>
										<div className="flex-1">
											<p className="text-sm font-medium">{ms.name}</p>
											<div className="flex items-center gap-2 text-xs text-muted-foreground">
												<span>{ms._count.cards} cards</span>
												{ms.targetDate && (
													<span className="flex items-center gap-1">
														<Calendar className="h-3 w-3" />
														{formatDate(ms.targetDate)}
													</span>
												)}
											</div>
											{ms.description && (
												<p className="mt-1 text-xs text-muted-foreground">{ms.description}</p>
											)}
										</div>
										<div className="flex items-center gap-1">
											<Badge variant="outline" className="text-2xs">
												{ms.cardsByStatus.done}/{ms._count.cards} done
											</Badge>
											<Button
												variant="ghost"
												size="icon"
												className="h-7 w-7"
												onClick={() => setEditingId(ms.id)}
											>
												<Pencil className="h-3 w-3" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												className="h-7 w-7 text-destructive"
												onClick={() => {
													if (confirm(`Delete milestone "${ms.name}"? Cards will be unassigned.`)) {
														deleteMilestone.mutate({ id: ms.id });
													}
												}}
											>
												<Trash2 className="h-3 w-3" />
											</Button>
										</div>
									</div>
								)}
							</div>
						))}

						{milestones?.length === 0 && (
							<EmptyState
								icon={Calendar}
								title="No milestones yet"
								description="Create one above to organize your roadmap."
								className="py-6"
							/>
						)}
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function MilestoneEditForm({
	milestone,
	onSave,
	onCancel,
}: {
	milestone: { name: string; description: string | null; targetDate: Date | string | null };
	onSave: (data: {
		name?: string;
		description?: string | null;
		targetDate?: string | null;
	}) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(milestone.name);
	const [description, setDescription] = useState(milestone.description ?? "");
	const [targetDate, setTargetDate] = useState(
		milestone.targetDate ? new Date(milestone.targetDate).toISOString().split("T")[0] : ""
	);

	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<Label className="text-xs">Name</Label>
				<Input value={name} onChange={(e) => setName(e.target.value)} />
			</div>
			<div className="space-y-1">
				<Label className="text-xs">Description</Label>
				<Textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					rows={2}
					placeholder="Optional description..."
				/>
			</div>
			<div className="space-y-1">
				<Label className="text-xs">Target Date</Label>
				<Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
			</div>
			<div className="flex gap-2">
				<Button
					size="sm"
					onClick={() =>
						onSave({
							name: name.trim() || undefined,
							description: description.trim() || null,
							targetDate: targetDate ? new Date(targetDate).toISOString() : null,
						})
					}
				>
					Save
				</Button>
				<Button variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
