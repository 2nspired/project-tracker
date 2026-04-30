"use client";

import { History } from "lucide-react";
import { useMemo, useState } from "react";
import { CardRefText, CollapsibleSection, FilterChip } from "@/components/board/session-shell";
import { Markdown } from "@/components/ui/markdown";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { TokenCostChip } from "@/components/ui/token-cost-chip";
import { formatRelativeCompact } from "@/lib/format-date";
import type {
	BriefBlocker,
	BriefDecision,
	BriefSnapshotPayload,
	BriefStaleInProgress,
	BriefTopWorkItem,
	ParsedBriefSnapshot,
} from "@/lib/services/brief-snapshot";
import { api } from "@/trpc/react";

type BriefingsSheetProps = {
	boardId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
};

export function BriefingsSheet({
	boardId,
	open,
	onOpenChange,
	resolveCardRef,
	onCardClick,
}: BriefingsSheetProps) {
	const [agentFilter, setAgentFilter] = useState<string | null>(null);

	const { data: snapshots } = api.briefSnapshot.list.useQuery(
		{ boardId, limit: 30 },
		{ enabled: open, refetchOnMount: "always" }
	);

	const agents = useMemo(() => {
		if (!snapshots) return [];
		return Array.from(new Set(snapshots.map((s) => s.agentName))).sort();
	}, [snapshots]);

	const filtered = useMemo(() => {
		if (!snapshots) return [];
		return snapshots.filter((s) => {
			if (agentFilter && s.agentName !== agentFilter) return false;
			return true;
		});
	}, [snapshots, agentFilter]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
				<SheetHeader className="border-b px-5 py-4">
					<SheetTitle className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
						Briefings
						<span className="font-mono text-2xs tabular-nums text-muted-foreground/60">
							{snapshots?.length ?? 0}
						</span>
					</SheetTitle>
					<SheetDescription className="sr-only">
						Rolling history of briefMe snapshots — what each agent saw at the start of its session.
					</SheetDescription>
					{agents.length > 1 && (
						<div className="mt-2 flex items-center gap-1">
							<FilterChip active={agentFilter === null} onClick={() => setAgentFilter(null)}>
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
						</div>
					)}
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{!snapshots ? (
						<BriefingsSkeleton />
					) : filtered.length === 0 ? (
						<EmptyState hasAny={snapshots.length > 0} />
					) : (
						<ol className="space-y-3">
							{filtered.map((s) => (
								<BriefingRow
									key={s.id}
									snapshot={s}
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

// ─── Per-briefing row ─────────────────────────────────────────────

function BriefingRow({
	snapshot,
	resolveCardRef,
	onCardClick,
}: {
	snapshot: ParsedBriefSnapshot;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	const { payload } = snapshot;
	const topWork = payload.topWork ?? [];
	const blockers = payload.blockers ?? [];
	const decisions = payload.recentDecisions ?? [];
	const diff = payload.diff;
	const stale = payload.stale;
	const staleInProgress = payload.staleInProgress ?? [];
	const handoff = payload.handoff;

	const diffCount = diff
		? diff.cardsMoved.length + diff.cardsCreated.length + (diff.newComments > 0 ? 1 : 0)
		: 0;

	return (
		<li className="overflow-hidden rounded-lg border bg-card">
			<header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
				<History className="h-3.5 w-3.5 text-blue-500" />
				<span className="text-xs font-medium">{snapshot.agentName}</span>
				<span className="font-mono text-2xs text-muted-foreground/60">
					{formatRelativeCompact(new Date(snapshot.createdAt))}
				</span>
				{payload.tokenPulse && (
					<TokenCostChip
						costUsd={payload.tokenPulse.totalCostUsd}
						sessionCount={payload.tokenPulse.sessionCount}
					/>
				)}
				<span className="ml-auto font-mono text-2xs text-muted-foreground/40">
					{new Date(snapshot.createdAt).toLocaleString(undefined, {
						month: "short",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					})}
				</span>
			</header>

			<div className="px-3 py-2 text-xs text-foreground/80">{snapshot.pulse}</div>

			{handoff && (
				<div className="border-t border-border/50 bg-muted/10 px-3 py-2 text-2xs text-muted-foreground">
					<span className="font-medium text-foreground/70">Continued from session</span> by{" "}
					<span className="font-medium">{handoff.agentName}</span> ·{" "}
					{formatRelativeCompact(new Date(handoff.createdAt))}
				</div>
			)}

			{payload.intentReminder && (
				<div className="border-t border-l-4 border-l-amber-500/60 border-border/50 bg-amber-500/5 px-3 py-2 text-2xs text-amber-700 dark:text-amber-400">
					{payload.intentReminder}
				</div>
			)}

			<div className="space-y-px border-t border-border/50 bg-muted/10">
				<CollapsibleSection
					title="Top work"
					count={topWork.length}
					accent="muted"
					initiallyOpen={topWork.length > 0 && blockers.length === 0}
				>
					<TopWorkList items={topWork} resolveCardRef={resolveCardRef} onCardClick={onCardClick} />
				</CollapsibleSection>
				<CollapsibleSection
					title="Blockers"
					count={blockers.length}
					accent="red"
					initiallyOpen={blockers.length > 0}
				>
					<BlockerList items={blockers} resolveCardRef={resolveCardRef} onCardClick={onCardClick} />
				</CollapsibleSection>
				<CollapsibleSection
					title="Recent decisions"
					count={decisions.length}
					accent="muted"
					initiallyOpen={false}
				>
					<DecisionList
						items={decisions}
						resolveCardRef={resolveCardRef}
						onCardClick={onCardClick}
					/>
				</CollapsibleSection>
				<CollapsibleSection
					title="Diff since prior session"
					count={diffCount}
					accent="muted"
					initiallyOpen={false}
				>
					{diff && (
						<DiffBody diff={diff} resolveCardRef={resolveCardRef} onCardClick={onCardClick} />
					)}
				</CollapsibleSection>
				<CollapsibleSection
					title="Stale in progress"
					count={staleInProgress.length}
					accent="red"
					initiallyOpen={false}
				>
					<StaleInProgressList
						items={staleInProgress}
						resolveCardRef={resolveCardRef}
						onCardClick={onCardClick}
					/>
				</CollapsibleSection>
				{stale && <StaleSection stale={stale} />}
			</div>
		</li>
	);
}

// ─── Section bodies ───────────────────────────────────────────────

function TopWorkList({
	items,
	resolveCardRef,
	onCardClick,
}: {
	items: BriefTopWorkItem[];
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	return (
		<ul className="space-y-1 text-xs leading-snug">
			{items.map((item) => (
				<li key={item.ref} className="flex items-baseline gap-1.5 text-foreground/80">
					<CardRefText text={item.ref} resolveCardRef={resolveCardRef} onCardClick={onCardClick} />
					<span className="truncate">{item.title}</span>
					<span className="ml-auto font-mono text-2xs text-muted-foreground/60">{item.column}</span>
					<SourceBadge source={item.source} />
				</li>
			))}
		</ul>
	);
}

function SourceBadge({ source }: { source: BriefTopWorkItem["source"] }) {
	const styles = {
		active: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
		pinned: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
		scored: "bg-muted text-muted-foreground",
	} as const;
	return <span className={`rounded px-1 py-0 font-mono text-2xs ${styles[source]}`}>{source}</span>;
}

function BlockerList({
	items,
	resolveCardRef,
	onCardClick,
}: {
	items: BriefBlocker[];
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	return (
		<ul className="space-y-1 text-xs leading-snug">
			{items.map((item) => (
				<li key={item.ref} className="flex items-baseline gap-1.5 text-foreground/80">
					<CardRefText text={item.ref} resolveCardRef={resolveCardRef} onCardClick={onCardClick} />
					<span className="truncate">{item.title}</span>
					{item.blockedBy.length > 0 && (
						<span className="ml-auto text-2xs text-muted-foreground/70">
							blocked by{" "}
							<CardRefText
								text={item.blockedBy.join(" ")}
								resolveCardRef={resolveCardRef}
								onCardClick={onCardClick}
							/>
						</span>
					)}
				</li>
			))}
		</ul>
	);
}

function DecisionList({
	items,
	resolveCardRef,
	onCardClick,
}: {
	items: BriefDecision[];
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	return (
		<ul className="space-y-1 text-xs leading-snug">
			{items.map((item) => (
				<li key={item.id} className="flex items-baseline gap-1.5 text-foreground/80">
					<span className="truncate">{item.title}</span>
					{item.card && (
						<span className="ml-auto">
							<CardRefText
								text={item.card}
								resolveCardRef={resolveCardRef}
								onCardClick={onCardClick}
							/>
						</span>
					)}
				</li>
			))}
		</ul>
	);
}

function DiffBody({
	diff,
	resolveCardRef,
	onCardClick,
}: {
	diff: NonNullable<BriefSnapshotPayload["diff"]>;
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	return (
		<div className="space-y-2 text-xs leading-snug">
			{diff.cardsMoved.length > 0 && (
				<div>
					<div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
						Moved
					</div>
					<ul className="mt-0.5 space-y-0.5">
						{diff.cardsMoved.map((c) => (
							<li key={c.ref} className="flex items-baseline gap-1.5 text-foreground/80">
								<CardRefText
									text={c.ref}
									resolveCardRef={resolveCardRef}
									onCardClick={onCardClick}
								/>
								<span className="truncate">{c.title}</span>
								<span className="ml-auto font-mono text-2xs text-muted-foreground/60">
									{c.from} → {c.to}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{diff.cardsCreated.length > 0 && (
				<div>
					<div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
						Created
					</div>
					<ul className="mt-0.5 space-y-0.5">
						{diff.cardsCreated.map((c) => (
							<li key={c.ref} className="flex items-baseline gap-1.5 text-foreground/80">
								<CardRefText
									text={c.ref}
									resolveCardRef={resolveCardRef}
									onCardClick={onCardClick}
								/>
								<span className="truncate">{c.title}</span>
								<span className="ml-auto font-mono text-2xs text-muted-foreground/60">
									{c.column}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{diff.newComments > 0 && (
				<div className="text-2xs text-muted-foreground">
					{diff.newComments} new comment{diff.newComments === 1 ? "" : "s"}
				</div>
			)}
		</div>
	);
}

function StaleInProgressList({
	items,
	resolveCardRef,
	onCardClick,
}: {
	items: BriefStaleInProgress[];
	resolveCardRef: (number: number) => string | null;
	onCardClick: (cardId: string) => void;
}) {
	return (
		<ul className="space-y-1 text-xs leading-snug">
			{items.map((item) => (
				<li key={item.ref} className="flex items-baseline gap-1.5 text-foreground/80">
					<CardRefText text={item.ref} resolveCardRef={resolveCardRef} onCardClick={onCardClick} />
					<span className="truncate">{item.title}</span>
					<span className="ml-auto font-mono text-2xs text-muted-foreground/60">
						{item.days}d idle
					</span>
				</li>
			))}
		</ul>
	);
}

function StaleSection({ stale }: { stale: string }) {
	const [open, setOpen] = useState(false);
	return (
		<details open={open} className="group border-l-4 border-l-red-500/60 bg-red-500/5">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: <summary> is intrinsically interactive within <details> */}
			<summary
				className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors hover:bg-muted/40"
				onClick={(e) => {
					e.preventDefault();
					setOpen(!open);
				}}
			>
				<span className="text-red-700 dark:text-red-400">Stale context warnings</span>
			</summary>
			<div className="prose prose-sm max-w-prose px-6 pb-2 pt-0.5 text-2xs leading-snug text-foreground/80 dark:prose-invert">
				<Markdown>{stale}</Markdown>
			</div>
		</details>
	);
}

// ─── States ───────────────────────────────────────────────────────

function EmptyState({ hasAny }: { hasAny: boolean }) {
	return (
		<div className="rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
			{hasAny ? (
				<p>No briefings match this filter.</p>
			) : (
				<>
					<p className="font-medium">No briefings yet.</p>
					<p className="mt-1">
						Briefings are saved when an agent calls <code>briefMe</code> from an MCP client.
					</p>
				</>
			)}
		</div>
	);
}

function BriefingsSkeleton() {
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
