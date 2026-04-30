"use client";

import { Boxes } from "lucide-react";
import { useEffect, useState } from "react";
import { McpCatalogPopover } from "@/components/header/mcp-catalog-popover";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/lib/use-media-query";

// Header pill that opens the MCP tool catalog. Desktop renders a Popover
// anchored to the trigger; mobile renders a bottom-anchored Sheet so the
// catalog reaches viewport edges. Tap targets ≥ 44×44 on mobile via
// padding bumps in the trigger button itself.
export function McpCatalogTrigger() {
	const [open, setOpen] = useState(false);
	const isDesktop = useMediaQuery("(min-width: 640px)");

	// Desktop-only `?` hotkey. Mobile soft keyboards have no `?` shortcut
	// convention, and tap-to-open is enough on small screens.
	useEffect(() => {
		if (!isDesktop) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "?") return;
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
			) {
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			// Don't toggle close from `?` — once the catalog is open, focus
			// can land on a CommandItem (a div, not an input), and `?` would
			// otherwise dismiss the catalog mid-navigation. Esc and click-
			// outside (handled by Radix) are the only close affordances.
			setOpen((prev) => {
				if (prev) return prev;
				e.preventDefault();
				return true;
			});
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isDesktop]);

	if (isDesktop) {
		return (
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<TriggerButton open={open} />
				</PopoverTrigger>
				<PopoverContent
					id="mcp-catalog"
					align="end"
					sideOffset={8}
					className="w-auto p-0"
					role="dialog"
					aria-label="MCP tool catalog"
				>
					<McpCatalogPopover enabled={open} />
				</PopoverContent>
			</Popover>
		);
	}

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<TriggerButton open={open} />
			</SheetTrigger>
			<SheetContent id="mcp-catalog" side="bottom" className="max-h-[85vh] gap-0 p-0">
				<SheetHeader className="border-b">
					<SheetTitle className="text-sm">MCP tool catalog</SheetTitle>
					<SheetDescription className="text-xs">
						Tap a tool to open its docs. The Essentials list at the top is what most agents use.
					</SheetDescription>
				</SheetHeader>
				<div className="flex-1 overflow-hidden">
					<McpCatalogPopover enabled={open} fullWidth />
				</div>
			</SheetContent>
		</Sheet>
	);
}

// Trigger lives in its own component so Popover/Sheet's `asChild` ref-
// forwarding works identically in both code paths. On mobile the label
// hides and the button becomes a 44×44 icon-only target.
function TriggerButton({ open, ...props }: { open: boolean } & React.ComponentProps<"button">) {
	return (
		<button
			type="button"
			aria-label="Browse MCP tools"
			aria-expanded={open}
			aria-controls="mcp-catalog"
			className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground sm:h-auto sm:w-auto sm:gap-1.5 sm:px-2 sm:py-1 sm:text-xs"
			{...props}
		>
			<Boxes className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
			<span className="hidden sm:inline">MCP</span>
			<kbd className="hidden rounded bg-muted px-1 py-0.5 font-mono text-[10px] sm:inline">?</kbd>
		</button>
	);
}
