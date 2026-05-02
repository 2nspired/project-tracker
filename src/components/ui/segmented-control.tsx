"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

/**
 * SegmentedControl — single-density (h-8) toggle group for "pick one of N
 * equivalent options" (view modes, period filters, density toggles, filter
 * chips).
 *
 * Wraps Radix `ToggleGroup` for built-in roving-tabindex keyboard nav,
 * `aria-pressed`, and single/multiple semantics; the named export is
 * `<SegmentedControl>` because that's the term designers reach for first
 * (Apple HIG, GitHub Primer). #242 — replaces 6 ad-hoc implementations
 * audited under design C3 + C14.
 *
 * Two corner-radius rules:
 * - `rounded-md` (default) — "single-select among equals" (view toggles,
 *   period selectors). Connected pill with hairline border around the group.
 * - `rounded-full` — "filter chips where the data tag is round" (e.g.
 *   activity-sheet actor filters). No outer border; each item is its own
 *   capsule, mirroring the round chip aesthetic.
 *
 * Sizes:
 * - `default` — h-8 px-2.5 (standard density used by all six migrated sites).
 * - `icon` — h-8 w-8 (icon-only items, e.g. board kanban/list view toggle).
 */

type SegmentedControlSize = "default" | "icon";
type SegmentedControlShape = "md" | "full";

interface SegmentedControlContextValue {
	size: SegmentedControlSize;
	shape: SegmentedControlShape;
}

const SegmentedControlContext = createContext<SegmentedControlContextValue>({
	size: "default",
	shape: "md",
});

const rootVariants = cva("inline-flex items-center", {
	variants: {
		shape: {
			md: "gap-0 rounded-md border bg-background p-0 [&>[data-slot=segmented-control-item]]:rounded-none [&>[data-slot=segmented-control-item]]:border-0 [&>[data-slot=segmented-control-item]:first-child]:rounded-l-md [&>[data-slot=segmented-control-item]:last-child]:rounded-r-md",
			full: "gap-1 rounded-full",
		},
	},
	defaultVariants: { shape: "md" },
});

const itemVariants = cva(
	"inline-flex items-center justify-center whitespace-nowrap text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			size: {
				default: "h-8 gap-1.5 px-2.5",
				icon: "h-8 w-8",
			},
			shape: {
				md: "text-muted-foreground hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground",
				full: "rounded-full px-2.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground data-[state=on]:bg-foreground data-[state=on]:text-background",
			},
		},
		defaultVariants: { size: "default", shape: "md" },
	}
);

type SegmentedControlBaseProps = Omit<
	React.ComponentPropsWithoutRef<"div">,
	"defaultValue" | "dir"
> &
	VariantProps<typeof rootVariants> & {
		size?: SegmentedControlSize;
		disabled?: boolean;
		rovingFocus?: boolean;
		loop?: boolean;
		orientation?: "horizontal" | "vertical";
		dir?: "ltr" | "rtl";
	};

type SegmentedControlSingleProps = SegmentedControlBaseProps & {
	type: "single";
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
};

type SegmentedControlMultipleProps = SegmentedControlBaseProps & {
	type: "multiple";
	value?: string[];
	defaultValue?: string[];
	onValueChange?: (value: string[]) => void;
};

type SegmentedControlRootProps = SegmentedControlSingleProps | SegmentedControlMultipleProps;

function SegmentedControl({
	className,
	shape = "md",
	size = "default",
	children,
	...props
}: SegmentedControlRootProps) {
	return (
		<SegmentedControlContext.Provider value={{ size, shape: shape ?? "md" }}>
			<ToggleGroupPrimitive.Root
				data-slot="segmented-control"
				data-shape={shape}
				className={cn(rootVariants({ shape }), className)}
				{...(props as React.ComponentProps<typeof ToggleGroupPrimitive.Root>)}
			>
				{children}
			</ToggleGroupPrimitive.Root>
		</SegmentedControlContext.Provider>
	);
}

function SegmentedControlItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
	const { size, shape } = useContext(SegmentedControlContext);
	return (
		<ToggleGroupPrimitive.Item
			data-slot="segmented-control-item"
			className={cn(itemVariants({ size, shape }), className)}
			{...props}
		>
			{children}
		</ToggleGroupPrimitive.Item>
	);
}

export { SegmentedControl, SegmentedControlItem };
