"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { ScopeSwitcher } from "@/components/costs/scope-switcher";
import { cn } from "@/lib/utils";

type LightBoard = { id: string; name: string };

type Props = {
	projectId: string;
	boards: LightBoard[];
	currentBoardId: string | null;
};

// Three-segment breadcrumb for the Costs page (D1).
//
// Layout: `Project Tracker  /  Costs  [/  Scope ▾]`
//   - Segment 1: link back to the project root (closest thing Pigeon has
//     to a "home" within a project — there's no left nav).
//   - Segment 2: plain text "Costs" (current page).
//   - Segment 3: <ScopeSwitcher> Popover trigger. Hidden entirely when the
//     project has at most one board (D1) — the switcher would have nothing
//     useful to do.
//
// N1 — sticky on scroll. The wrapper carries the sticky positioning + a
// subtle backdrop blur so the breadcrumb stays legible over the scrolled
// content. `z-10` keeps it above the page contents but well below dialog
// portals (which use higher z indices via radix).
export function CostsBreadcrumb({ projectId, boards, currentBoardId }: Props) {
	const showScope = boards.length > 1;

	return (
		<nav
			aria-label="Costs breadcrumb"
			className={cn(
				"sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-1 border-b border-border/50 bg-background/80 px-4 py-2 text-sm backdrop-blur-sm sm:-mx-6 sm:px-6"
			)}
		>
			<Link
				href={`/projects/${projectId}`}
				className="text-muted-foreground transition-colors hover:text-foreground"
			>
				Project Tracker
			</Link>
			<Separator />
			<span className="text-foreground">Costs</span>
			{showScope ? (
				<>
					<Separator />
					<ScopeSwitcher projectId={projectId} boards={boards} currentBoardId={currentBoardId} />
				</>
			) : null}
		</nav>
	);
}

function Separator() {
	return <ChevronRight aria-hidden className="size-3.5 text-muted-foreground/40" />;
}
