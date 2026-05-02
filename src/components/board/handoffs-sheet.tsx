"use client";

import { Bot } from "lucide-react";
import { cloneElement, Fragment, isValidElement, type ReactNode, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { CardRefText, CollapsibleSection } from "@/components/board/session-shell";
import { Markdown } from "@/components/ui/markdown";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { TokenCostChip } from "@/components/ui/token-cost-chip";
import { formatRelativeCompact } from "@/lib/format-date";
import { api } from "@/trpc/react";

type HandoffsSheetProps = {
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

export function HandoffsSheet({
	boardId,
	projectId,
	open,
	onOpenChange,
	resolveCardRef,
	onCardClick,
}: HandoffsSheetProps) {
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
						Handoffs
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
					<SheetDescription className="sr-only">
						Recent agent handoffs for this project. Filter by agent or blockers.
					</SheetDescription>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<SegmentedControl
							type="single"
							shape="full"
							value={filter}
							onValueChange={(v) => v && setFilter(v as Filter)}
							aria-label="Filter handoffs"
						>
							<SegmentedControlItem value="all">All</SegmentedControlItem>
							<SegmentedControlItem value="blockers">Has blockers</SegmentedControlItem>
						</SegmentedControl>
						{agents.length > 1 && (
							<>
								<span className="h-3 w-px bg-border" />
								<SegmentedControl
									type="single"
									shape="full"
									value={agentFilter ?? "__all__"}
									onValueChange={(v) => setAgentFilter(v === "__all__" || !v ? null : v)}
									aria-label="Filter by agent"
								>
									<SegmentedControlItem value="__all__">All agents</SegmentedControlItem>
									{agents.map((a) => (
										<SegmentedControlItem key={a} value={a}>
											{a}
										</SegmentedControlItem>
									))}
								</SegmentedControl>
							</>
						)}
					</div>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{!handoffs ? (
						<HandoffsSkeleton />
					) : filtered.length === 0 ? (
						<EmptyState hasAny={handoffs.length > 0} />
					) : (
						<ol className="space-y-3">
							{filtered.map((h: ParsedHandoff) => (
								<HandoffRow
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

// ─── Per-handoff row ──────────────────────────────────────────────

function HandoffRow({
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
				<Bot className="h-3.5 w-3.5 text-accent-violet" />
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

// ─── Handoff section (string-list adapter over CollapsibleSection) ────

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
	accent: "muted" | "violet" | "red";
	initiallyOpen: boolean;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	return (
		<CollapsibleSection
			title={title}
			count={items.length}
			accent={accent}
			initiallyOpen={initiallyOpen}
		>
			<ul className="space-y-1 text-xs leading-snug">
				{items.map((item, i) => (
					<li key={i} className="text-foreground/80">
						<HandoffItemContent
							text={item}
							resolveCardRef={resolveCardRef}
							onCardClick={onCardClick}
						/>
					</li>
				))}
			</ul>
		</CollapsibleSection>
	);
}

// Items written by agents routinely contain **bold**, `code`, [links](url),
// and #123 card refs. Render through ReactMarkdown, then walk the rendered
// children to swap plain-text #N occurrences for clickable CardRefText
// buttons (covers strings nested inside strong/em/code/a too).
function HandoffItemContent({
	text,
	resolveCardRef,
	onCardClick,
}: {
	text: string;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	const linkify = (node: ReactNode): ReactNode => {
		if (typeof node === "string") {
			if (!node.includes("#")) return node;
			return <CardRefText text={node} resolveCardRef={resolveCardRef} onCardClick={onCardClick} />;
		}
		if (Array.isArray(node)) {
			return node.map((c, i) => <Fragment key={i}>{linkify(c)}</Fragment>);
		}
		if (isValidElement(node)) {
			const children = (node.props as { children?: ReactNode }).children;
			return cloneElement(node, {}, linkify(children));
		}
		return node;
	};

	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm, remarkBreaks]}
			components={{
				p: ({ children }) => <>{linkify(children)}</>,
				strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
				em: ({ children }) => <em>{children}</em>,
				code: ({ children, className }) => {
					const isBlock = className?.includes("language-");
					if (isBlock) {
						return (
							<code className="block overflow-x-auto rounded bg-muted p-1.5 text-2xs">
								{children}
							</code>
						);
					}
					return <code className="rounded bg-muted px-1 py-0.5 text-2xs">{children}</code>;
				},
				a: ({ children, href }) => (
					<a
						href={href}
						className="text-primary underline"
						target="_blank"
						rel="noopener noreferrer"
					>
						{children}
					</a>
				),
			}}
		>
			{text}
		</ReactMarkdown>
	);
}

// ─── States ───────────────────────────────────────────────────────

function EmptyState({ hasAny }: { hasAny: boolean }) {
	return (
		<div className="rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
			{hasAny ? (
				<p>No handoffs match this filter.</p>
			) : (
				<>
					<p className="font-medium">No handoffs yet.</p>
					<p className="mt-1">
						Handoffs are saved when an agent runs <code>/handoff</code> or calls{" "}
						<code>saveHandoff</code>.
					</p>
				</>
			)}
		</div>
	);
}

function HandoffsSkeleton() {
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
