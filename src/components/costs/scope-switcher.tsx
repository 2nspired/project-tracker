"use client";

import { Check, ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

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
import { cn } from "@/lib/utils";

type LightBoard = { id: string; name: string };

type Props = {
	projectId: string;
	boards: LightBoard[];
	/** `null` means "All boards" (no `?board=` query param set). */
	currentBoardId: string | null;
};

// Breadcrumb scope switcher (D1). Popover-anchored Command list with a
// filter input + an "All boards" reset row. Active row gets a violet dot
// + a subtle violet pill ("violet = cost" mirrors BoardPulse / Sparkline).
//
// C1 — DOES NOT use `useSearchParams`. A client component calling
// `useSearchParams` requires a Suspense boundary, otherwise `next build`
// errors out. We get the current scope as a prop (resolved server-side)
// and synthesize the query string at click-time from `usePathname()` +
// `URLSearchParams`. `router.replace` keeps the back-button history
// shallow (toggling scope shouldn't litter back-history) and
// `scroll: false` avoids a jump-to-top on every click.
export function ScopeSwitcher({ projectId: _projectId, boards, currentBoardId }: Props) {
	const router = useRouter();
	const pathname = usePathname();
	const [open, setOpen] = useState(false);

	const activeBoard = boards.find((b) => b.id === currentBoardId) ?? null;
	const triggerLabel = activeBoard ? `Board · ${activeBoard.name}` : "All boards";

	function navigate(boardId: string | null) {
		const href = buildScopeHref(pathname, boardId);
		// Next 16 typed routes don't recognize the dynamic href shape — cast
		// matches the convention in `command-palette.tsx`.
		router.replace(href as Parameters<typeof router.replace>[0], { scroll: false });
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm transition-colors",
						activeBoard
							? "border-violet-500/30 bg-violet-500/[0.06] text-foreground"
							: "border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground"
					)}
					aria-label={`Scope: ${triggerLabel}`}
				>
					{activeBoard ? <ViolaDot /> : null}
					<span className="truncate max-w-[12rem]">{triggerLabel}</span>
					<ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-64 p-0" align="start">
				<Command>
					<CommandInput placeholder="Filter boards…" />
					<CommandList>
						<CommandEmpty>No boards match.</CommandEmpty>
						<CommandGroup heading="Scope">
							<CommandItem
								value="__all__"
								onSelect={() => navigate(null)}
								className="cursor-pointer"
							>
								<span className="flex-1">All boards</span>
								{currentBoardId === null ? <Check className="size-4" /> : null}
							</CommandItem>
						</CommandGroup>
						<CommandSeparator />
						<CommandGroup heading="Boards">
							{boards.map((b) => {
								const active = b.id === currentBoardId;
								return (
									<CommandItem
										key={b.id}
										value={b.name}
										onSelect={() => navigate(b.id)}
										className="cursor-pointer"
									>
										{active ? <ViolaDot /> : <span className="size-2" aria-hidden />}
										<span className="flex-1 truncate">{b.name}</span>
										{active ? <Check className="size-4" /> : null}
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function ViolaDot() {
	return <span aria-hidden className="inline-block size-2 rounded-full bg-violet-500" />;
}

// Pure helper — exported for unit testing. Builds the next URL the
// switcher will navigate to. `null` (or empty string) clears the scope by
// dropping the `?board=` query param entirely; a non-null value sets it.
// Builds a fresh URLSearchParams rather than reading window.location so
// the function stays deterministic for tests + SSR-safe.
export function buildScopeHref(pathname: string, boardId: string | null): string {
	const next = new URLSearchParams();
	if (boardId) next.set("board", boardId);
	const qs = next.toString();
	return qs ? `${pathname}?${qs}` : pathname;
}
