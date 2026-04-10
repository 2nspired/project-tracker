"use client";

import { ArrowLeft, Settings2 } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";

import { MilestoneManager } from "@/components/roadmap/milestone-manager";
import { RoadmapView } from "@/components/roadmap/roadmap-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoardEvents } from "@/hooks/use-board-events";
import { api } from "@/trpc/react";

export default function RoadmapPage({
	params,
}: {
	params: Promise<{ projectId: string; boardId: string }>;
}) {
	const { projectId, boardId } = use(params);
	const [milestoneManagerOpen, setMilestoneManagerOpen] = useState(false);
	const refetchInterval = useBoardEvents(boardId);

	const { data: board, isLoading } = api.board.getFull.useQuery(
		{ id: boardId },
		{ refetchInterval }
	);

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-6">
				<Skeleton className="mb-6 h-8 w-64" />
				<Skeleton className="mb-4 h-40 w-full" />
				<div className="space-y-4">
					{Array.from({ length: 3 }).map((_, i) => (
						<Skeleton key={i} className="h-32 w-full" />
					))}
				</div>
			</div>
		);
	}

	if (!board) {
		return <p className="p-8 text-center text-muted-foreground">Board not found.</p>;
	}

	return (
		<div className="container mx-auto px-4 py-6">
			<div className="mb-6 flex items-center gap-3">
				<Link href={`/projects/${projectId}/boards/${boardId}`}>
					<Button variant="ghost" size="sm">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Board
					</Button>
				</Link>
				<div className="flex-1">
					<h1 className="text-lg font-semibold">Roadmap</h1>
					<p className="text-xs text-muted-foreground">
						{board.project.name} / {board.name}
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="h-8 gap-1.5 text-xs"
					onClick={() => setMilestoneManagerOpen(true)}
				>
					<Settings2 className="h-3.5 w-3.5" />
					Milestones
				</Button>
			</div>

			<RoadmapView board={board} />

			<MilestoneManager
				projectId={board.project.id}
				open={milestoneManagerOpen}
				onClose={() => setMilestoneManagerOpen(false)}
			/>
		</div>
	);
}
