"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

// ─── Card-ref linkification ───────────────────────────────────────

const CARD_REF_RE = /(#\d+)/g;

export function CardRefText({
	text,
	resolveCardRef,
	onCardClick,
}: {
	text: string;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	// Split on `#N` tokens. Refs that resolve to a card on this board become
	// clickable; refs to other boards / typos stay as plain text so they're
	// not deceptive.
	const parts = text.split(CARD_REF_RE);
	return (
		<>
			{parts.map((part, i) => {
				if (!/^#\d+$/.test(part)) {
					return <span key={i}>{part}</span>;
				}
				const number = Number.parseInt(part.slice(1), 10);
				const cardId = resolveCardRef(number);
				if (!cardId) {
					return (
						<span key={i} className="font-mono text-2xs text-muted-foreground">
							{part}
						</span>
					);
				}
				return (
					<button
						key={i}
						type="button"
						onClick={() => onCardClick(cardId)}
						className="font-mono text-2xs font-medium text-primary underline-offset-2 hover:underline"
					>
						{part}
					</button>
				);
			})}
		</>
	);
}

// ─── Accent palette ───────────────────────────────────────────────

export const ACCENT_STYLES = {
	muted: { border: "", text: "text-muted-foreground", bg: "" },
	violet: {
		border: "border-l-4 border-l-accent-violet/40",
		text: "text-accent-violet",
		bg: "",
	},
	red: {
		border: "border-l-4 border-l-danger/60",
		text: "text-danger",
		bg: "bg-danger/5",
	},
} as const;

export type Accent = keyof typeof ACCENT_STYLES;

// ─── Collapsible section ──────────────────────────────────────────

export function CollapsibleSection({
	title,
	count,
	accent,
	initiallyOpen,
	children,
}: {
	title: string;
	count: number;
	accent: Accent;
	initiallyOpen: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(initiallyOpen);
	if (count === 0) return null;

	const styles = ACCENT_STYLES[accent];

	return (
		<details
			open={open}
			onToggle={(e) => setOpen(e.currentTarget.open)}
			className={`group ${styles.border} ${styles.bg}`}
		>
			<summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors hover:bg-muted/40">
				{open ? (
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3 w-3 text-muted-foreground" />
				)}
				<span className={styles.text}>{title}</span>
				<span className="font-mono text-2xs text-muted-foreground/50">{count}</span>
			</summary>
			<div className="px-6 pb-2 pt-0.5">{children}</div>
		</details>
	);
}

// ─── Filter chip ──────────────────────────────────────────────────

export function FilterChip({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-full px-2 py-0.5 text-2xs transition-colors ${
				active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/60"
			}`}
		>
			{children}
		</button>
	);
}
