"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ColorToken } from "./token-registry";

interface ColorSwatchProps {
	token: ColorToken;
	/** Resolved value in the current theme column (light or dark). */
	value: string;
}

/**
 * A single swatch tile — fills with the token color, shows the token name +
 * resolved value, and supports click-to-copy on either piece.
 *
 * Borrowed structure from GitHub Primer's `primer.style/foundations/color`
 * page: name on top, sample below, resolved value at the bottom. Click the
 * upper half to copy `var(--name)`; click the value row to copy the resolved
 * `oklch(...)` string.
 */
export function ColorSwatch({ token, value }: ColorSwatchProps) {
	const cssVarRef = `var(--${token.name})`;
	const label = token.label ?? humanize(token.name);

	return (
		<div className="overflow-hidden rounded-lg border bg-card text-card-foreground">
			<div
				className="flex h-20 items-end p-3"
				style={{ backgroundColor: cssVarRef }}
				aria-hidden="true"
			>
				{/* Visual contrast probe — a small dot in foreground color so a
				    "should I read text on this?" answer is always one glance away. */}
				<div
					className="size-3 rounded-full border border-border/50"
					style={{ backgroundColor: "var(--foreground)" }}
				/>
			</div>
			<div className="flex flex-col gap-1 p-3">
				<CopyButton
					value={cssVarRef}
					label={`Copy var(--${token.name})`}
					className="justify-between text-left text-sm font-medium"
					aria-label={`Copy CSS variable reference for ${label}`}
				>
					<span className="truncate">{label}</span>
					<span className="ml-2 shrink-0 font-mono text-2xs text-muted-foreground">
						--{token.name}
					</span>
				</CopyButton>
				<CopyButton
					value={value}
					label={`Copy ${value || "value"}`}
					className="justify-start text-left font-mono text-2xs text-muted-foreground"
					aria-label={`Copy resolved value for ${label}`}
				>
					<span className="truncate">{value || "—"}</span>
				</CopyButton>
				{token.description ? (
					<p className="pt-1 text-xs leading-snug text-muted-foreground">{token.description}</p>
				) : null}
			</div>
		</div>
	);
}

interface CopyButtonProps {
	value: string;
	label: string;
	className?: string;
	"aria-label"?: string;
	children: React.ReactNode;
}

function CopyButton({ value, label, className, children, ...rest }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			toast.success(label, { duration: 1500 });
			setTimeout(() => setCopied(false), 1200);
		} catch {
			toast.error("Couldn't copy to clipboard");
		}
	}

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={cn(
				"group/copy -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
				className
			)}
			{...rest}
		>
			{children}
			{copied ? (
				<Check className="ml-auto size-3 shrink-0 text-foreground" aria-hidden="true" />
			) : (
				<Copy
					className="ml-auto size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100"
					aria-hidden="true"
				/>
			)}
		</button>
	);
}

function humanize(name: string): string {
	return name
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}
