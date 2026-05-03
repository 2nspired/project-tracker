"use client";

/**
 * shadcn-style Accordion primitive (new-york variant).
 *
 * Wraps `radix-ui`'s `Accordion` namespace. Added in #173 for the
 * dashboard hygiene panel (default-collapsed expand to show 5 cleanup
 * signals). Mirrors the existing wrappers in this folder
 * (`popover.tsx`, `dialog.tsx`) — uses the unified `radix-ui` package
 * already pulled in by the rest of the UI primitives.
 */

import { ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Accordion({ ...props }: React.ComponentProps<typeof AccordionPrimitive.Root>) {
	return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({
	className,
	...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
	return (
		<AccordionPrimitive.Item
			data-slot="accordion-item"
			className={cn("border-b last:border-b-0", className)}
			{...props}
		/>
	);
}

function AccordionTrigger({
	className,
	children,
	...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
	return (
		<AccordionPrimitive.Header className="flex">
			<AccordionPrimitive.Trigger
				data-slot="accordion-trigger"
				className={cn(
					"flex flex-1 items-center justify-between gap-4 py-3 text-left text-sm font-medium outline-hidden transition-[color,box-shadow] hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
					className
				)}
				{...props}
			>
				{children}
				<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
			</AccordionPrimitive.Trigger>
		</AccordionPrimitive.Header>
	);
}

function AccordionContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
	return (
		<AccordionPrimitive.Content
			data-slot="accordion-content"
			className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
			{...props}
		>
			<div className={cn("pt-0 pb-4", className)}>{children}</div>
		</AccordionPrimitive.Content>
	);
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
