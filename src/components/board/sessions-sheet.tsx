"use client";

import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TokenCostChip } from "@/components/ui/token-cost-chip";
import { formatRelativeCompact } from "@/lib/format-date";
import { api } from "@/trpc/react";

type SessionsSheetProps = {
	boardId: string;
	projectId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Resolves a card number to a card UUID (typically from the board state)
	// and opens the card detail sheet. Returns null when the number doesn't
	// match a card on this board — typed-out refs that go nowhere stay as
	// inert text.
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
};

type ParsedHandoff = {
	id: string;
	agentName: string;
	summary: string;
	workingOn: string[];
	findings: string[];
	nextSteps: string[];
	blockers: string[];
	createdAt: Date;
};

type Filter = "all" | "blockers";

export function SessionsSheet({
	boardId,
	projectId,
	open,
	onOpenChange,
	resolveCardRef,
	onCardClick,
}: SessionsSheetProps) {
	const [filter, setFilter] = useState<Filter>("all");
	const [agentFilter, setAgentFilter] = useState<string | null>(null);

	const { data: handoffs } = api.handoff.list.useQuery(
		{ boardId, limit: 30 },
		{ enabled: open, refetchOnMount: "always" }
	);

	const { data: tokenSummary } = api.tokenUsage.getProjectSummary.useQuery(
		{ projectId },
		{ enabled: open, retry: false }
	);

	const agents = useMemo(() => {
		if (!handoffs) return [];
		return Array.from(new Set(handoffs.map((h) => h.agentName))).sort();
	}, [handoffs]);

	const filtered = useMemo(() => {
		if (!handoffs) return [];
		return handoffs.filter((h: ParsedHandoff) => {
			if (filter === "blockers" && h.blockers.length === 0) return false;
			if (agentFilter && h.agentName !== agentFilter) return false;
			return true;
		});
	}, [handoffs, filter, agentFilter]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
				<SheetHeader className="border-b px-5 py-4">
					<SheetTitle className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
						Sessions
						<span className="font-mono text-2xs tabular-nums text-muted-foreground/60">
							{handoffs?.length ?? 0}
						</span>
						{tokenSummary && tokenSummary.totalCostUsd > 0 && (
							<TokenCostChip
								costUsd={tokenSummary.totalCostUsd}
								sessionCount={tokenSummary.sessionCount}
								className="ml-auto"
							/>
						)}
					</SheetTitle>
					<div className="mt-2 flex items-center gap-1">
						<FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
							All
						</FilterChip>
						<FilterChip active={filter === "blockers"} onClick={() => setFilter("blockers")}>
							Has blockers
						</FilterChip>
						{agents.length > 1 && (
							<>
								<span className="mx-1 h-3 w-px bg-border" />
								<FilterChip
									active={agentFilter === null}
									onClick={() => setAgentFilter(null)}
								>
									All agents
								</FilterChip>
								{agents.map((a) => (
									<FilterChip
										key={a}
										active={agentFilter === a}
										onClick={() => setAgentFilter(agentFilter === a ? null : a)}
									>
										{a}
									</FilterChip>
								))}
							</>
						)}
					</div>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{!handoffs ? (
						<SessionsSkeleton />
					) : filtered.length === 0 ? (
						<EmptyState hasAny={handoffs.length > 0} />
					) : (
						<ol className="space-y-3">
							{filtered.map((h: ParsedHandoff) => (
								<SessionRow
									key={h.id}
									handoff={h}
									resolveCardRef={resolveCardRef}
									onCardClick={onCardClick}
								/>
							))}
						</ol>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

// ─── Per-session row ──────────────────────────────────────────────

function SessionRow({
	handoff,
	resolveCardRef,
	onCardClick,
}: {
	handoff: ParsedHandoff;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	const hasBlockers = handoff.blockers.length > 0;
	const hasNextSteps = handoff.nextSteps.length > 0;

	return (
		<li className="overflow-hidden rounded-lg border bg-card">
			<header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
				<Bot className="h-3.5 w-3.5 text-violet-500" />
				<span className="text-xs font-medium">{handoff.agentName}</span>
				<span className="font-mono text-2xs text-muted-foreground/60">
					{formatRelativeCompact(new Date(handoff.createdAt))}
				</span>
				<span className="ml-auto font-mono text-2xs text-muted-foreground/40">
					{new Date(handoff.createdAt).toLocaleString(undefined, {
						month: "short",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					})}
				</span>
			</header>

			{handoff.summary && (
				<div className="px-3 py-3">
					<div className="prose prose-sm max-w-prose text-xs leading-relaxed text-foreground/90 dark:prose-invert">
						<Markdown>{handoff.summary}</Markdown>
					</div>
				</div>
			)}

			<div className="space-y-px border-t border-border/50 bg-muted/10">
				<HandoffSection
					title="Working on"
					items={handoff.workingOn}
					accent="muted"
					initiallyOpen={false}
					resolveCardRef={resolveCardRef}
					onCardClick={onCardClick}
				/>
				<HandoffSection
					title="Findings"
					items={handoff.findings}
					accent="muted"
					initiallyOpen={false}
					resolveCardRef={resolveCardRef}
					onCardClick={onCardClick}
				/>
				<HandoffSection
					title="Next steps"
					items={handoff.nextSteps}
					accent="violet"
					initiallyOpen={hasNextSteps && !hasBlockers}
					resolveCardRef={resolveCardRef}
					onCardClick={onCardClick}
				/>
				<HandoffSection
					title="Blockers"
					items={handoff.blockers}
					accent="red"
					initiallyOpen={hasBlockers}
					resolveCardRef={resolveCardRef}
					onCardClick={onCardClick}
				/>
			</div>
		</li>
	);
}

// ─── Collapsible section ──────────────────────────────────────────

const ACCENT_STYLES = {
	muted: { border: "", text: "text-muted-foreground", bg: "" },
	violet: {
		border: "border-l-4 border-l-violet-500/40",
		text: "text-violet-700 dark:text-violet-300",
		bg: "",
	},
	red: {
		border: "border-l-4 border-l-red-500/60",
		text: "text-red-700 dark:text-red-400",
		bg: "bg-red-500/5",
	},
} as const;

function HandoffSection({
	title,
	items,
	accent,
	initiallyOpen,
	resolveCardRef,
	onCardClick,
}: {
	title: string;
	items: string[];
	accent: keyof typeof ACCENT_STYLES;
	initiallyOpen: boolean;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	const [open, setOpen] = useState(initiallyOpen);
	if (items.length === 0) return null;

	const styles = ACCENT_STYLES[accent];

	return (
		<details open={open} className={`group ${styles.border} ${styles.bg}`}>
			<summary
				className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors hover:bg-muted/40"
				onClick={(e) => {
					e.preventDefault();
					setOpen(!open);
				}}
			>
				{open ? (
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3 w-3 text-muted-foreground" />
				)}
				<span className={styles.text}>{title}</span>
				<span className="font-mono text-2xs text-muted-foreground/50">{items.length}</span>
			</summary>
			<ul className="space-y-1 px-6 pb-2 pt-0.5 text-xs leading-snug">
				{items.map((item, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: handoff arrays are immutable post-write
					<li key={i} className="text-foreground/80">
						<HandoffItemBody
							text={item}
							resolveCardRef={resolveCardRef}
							onCardClick={onCardClick}
						/>
					</li>
				))}
			</ul>
		</details>
	);
}

// ─── Card-ref linkification ───────────────────────────────────────

const CARD_REF_RE = /(#\d+)/g;

function HandoffItemBody({
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
					// biome-ignore lint/suspicious/noArrayIndexKey: positional split
					return <span key={i}>{part}</span>;
				}
				const number = Number.parseInt(part.slice(1), 10);
				const cardId = resolveCardRef(number);
				if (!cardId) {
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: positional split
						<span key={i} className="font-mono text-2xs text-muted-foreground">
							{part}
						</span>
					);
				}
				return (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: positional split
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

// ─── States ───────────────────────────────────────────────────────

function EmptyState({ hasAny }: { hasAny: boolean }) {
	return (
		<div className="rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
			{hasAny ? (
				<p>No sessions match this filter.</p>
			) : (
				<>
					<p className="font-medium">No sessions yet.</p>
					<p className="mt-1">
						Sessions are saved when an agent runs <code>/handoff</code> or calls{" "}
						<code>endSession</code>.
					</p>
				</>
			)}
		</div>
	);
}

function SessionsSkeleton() {
	return (
		<div className="space-y-3">
			{[0, 1, 2].map((i) => (
				<div key={i} className="rounded-lg border bg-muted/20 p-3">
					<div className="h-3 w-32 animate-pulse rounded bg-muted" />
					<div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
					<div className="mt-1 h-3 w-3/4 animate-pulse rounded bg-muted" />
				</div>
			))}
		</div>
	);
}

// ─── Filter chip (parallels ActivitySheet) ────────────────────────

function FilterChip({
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
