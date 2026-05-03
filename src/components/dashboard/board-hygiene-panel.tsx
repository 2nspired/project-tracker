"use client";

/**
 * Dashboard board-hygiene panel (#173).
 *
 * Single recessive panel below Pulse / Focus on `/dashboard`. Surfaces 5
 * cleanup signals that don't belong on Pulse (Pulse v2 = flow + cost; per
 * #167 decision `cdc3262b`, hygiene is a separate weekly-cleanup surface):
 *
 *   1. Cards missing tags             — `card.cardTags = []`
 *   2. Backlog cards with priority NONE
 *   3. Overdue active milestones      — `targetDate < now`
 *   4. Tag taxonomy drift             — single-use + Levenshtein-≤2 pairs
 *   5. Stale decisions                — 30d activity / no decision in 60d
 *
 * Default-collapsed `<Accordion>` with a summary row of pills (one per
 * signal — count badge). Recessive vs. Pulse: lower-opacity heading,
 * smaller pill badges. Each query parallel-fetches via React Query so a
 * slow signal can't block the panel render.
 */

import {
	AlertTriangle,
	CalendarClock,
	ExternalLink,
	GitBranch,
	Lightbulb,
	Tags,
} from "lucide-react";
import Link from "next/link";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { api } from "@/trpc/react";

type SignalKey =
	| "missingTags"
	| "noPriorityInBacklog"
	| "overdueMilestones"
	| "taxonomyDrift"
	| "staleDecisions";

const SIGNAL_LABEL: Record<SignalKey, string> = {
	missingTags: "Untagged cards",
	noPriorityInBacklog: "Untriaged Backlog",
	overdueMilestones: "Overdue milestones",
	taxonomyDrift: "Tag drift",
	staleDecisions: "Stale decisions",
};

const SIGNAL_ICON: Record<SignalKey, React.ComponentType<{ className?: string }>> = {
	missingTags: Tags,
	noPriorityInBacklog: AlertTriangle,
	overdueMilestones: CalendarClock,
	taxonomyDrift: GitBranch,
	staleDecisions: Lightbulb,
};

function cardHref(cardRef: { projectId: string; boardId: string }): string {
	return `/projects/${cardRef.projectId}/boards/${cardRef.boardId}`;
}

function projectHref(projectId: string): string {
	return `/projects/${projectId}`;
}

function projectTagsHref(projectId: string): string {
	// Project page hosts the tag manager — taxonomy drift drills in here.
	return `/projects/${projectId}`;
}

export function BoardHygienePanel() {
	const missingTagsQ = api.boardHealth.missingTags.useQuery({});
	const noPriorityQ = api.boardHealth.noPriorityInBacklog.useQuery({});
	const overdueQ = api.boardHealth.overdueMilestones.useQuery({});
	const driftQ = api.boardHealth.taxonomyDrift.useQuery({});
	const staleDecisionsQ = api.boardHealth.staleDecisions.useQuery({});

	const counts: Record<SignalKey, number> = {
		missingTags: missingTagsQ.data?.count ?? 0,
		noPriorityInBacklog: noPriorityQ.data?.count ?? 0,
		overdueMilestones: overdueQ.data?.count ?? 0,
		taxonomyDrift: driftQ.data?.count ?? 0,
		staleDecisions: staleDecisionsQ.data?.count ?? 0,
	};

	const total =
		counts.missingTags +
		counts.noPriorityInBacklog +
		counts.overdueMilestones +
		counts.taxonomyDrift +
		counts.staleDecisions;

	// Hide the whole panel until at least one signal has loaded; keeps the
	// dashboard from flashing an empty hygiene strip on cold mount.
	const anyLoaded =
		missingTagsQ.isSuccess ||
		noPriorityQ.isSuccess ||
		overdueQ.isSuccess ||
		driftQ.isSuccess ||
		staleDecisionsQ.isSuccess;
	if (!anyLoaded) return null;

	// Zero across the board — clean board, surface positive but quiet.
	if (total === 0) {
		return (
			<div
				data-testid="board-hygiene-panel"
				className="mb-6 rounded-lg border border-muted/40 bg-card/40 px-4 py-3 text-xs text-muted-foreground/80"
			>
				<span className="font-medium text-muted-foreground">Hygiene clean</span> — no missing tags,
				no untriaged Backlog, no overdue milestones, no tag drift, no stale decisions.
			</div>
		);
	}

	const stripIds: SignalKey[] = [
		"missingTags",
		"noPriorityInBacklog",
		"overdueMilestones",
		"taxonomyDrift",
		"staleDecisions",
	];

	return (
		<div data-testid="board-hygiene-panel" className="mb-6">
			<Accordion type="single" collapsible className="rounded-lg border border-muted/50 bg-card/40">
				<AccordionItem value="hygiene" className="border-b-0">
					<AccordionTrigger className="px-4 py-2.5 text-xs font-medium text-muted-foreground/90 hover:no-underline">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-semibold uppercase tracking-wide">Hygiene</span>
							<span className="text-muted-foreground/60">
								{total} issue{total !== 1 ? "s" : ""}
							</span>
							<span className="text-muted-foreground/40">·</span>
							{stripIds.map((id) => {
								const Icon = SIGNAL_ICON[id];
								const count = counts[id];
								if (count === 0) return null;
								return (
									<span
										key={id}
										data-testid={`hygiene-pill-${id}`}
										className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-1.5 py-0.5 text-2xs font-normal text-muted-foreground"
									>
										<Icon className="h-3 w-3" />
										<span>{count}</span>
										<span className="hidden sm:inline">{SIGNAL_LABEL[id]}</span>
									</span>
								);
							})}
						</div>
					</AccordionTrigger>
					<AccordionContent className="px-4">
						<div className="space-y-5 pb-2">
							{/* ─── 1. Missing tags ─────────────────────────────── */}
							<HygieneSection
								id="missingTags"
								title={SIGNAL_LABEL.missingTags}
								description="Cards with zero tags (excludes Done/Parking)."
								count={counts.missingTags}
							>
								{missingTagsQ.data?.cards.length ? (
									<ul className="space-y-1">
										{missingTagsQ.data.cards.slice(0, 8).map((c) => (
											<li
												key={c.cardId}
												className="flex items-center gap-2 text-xs text-muted-foreground"
											>
												<Link
													href={cardHref(c)}
													className="flex flex-1 items-center gap-2 hover:text-foreground"
												>
													<span className="font-mono text-2xs text-muted-foreground/70">
														{c.ref}
													</span>
													<span className="truncate">{c.title}</span>
													<span className="text-muted-foreground/60">· {c.projectName}</span>
													<ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/60" />
												</Link>
											</li>
										))}
										{missingTagsQ.data.cards.length > 8 && (
											<li className="text-2xs text-muted-foreground/60">
												+ {missingTagsQ.data.cards.length - 8} more
											</li>
										)}
									</ul>
								) : null}
							</HygieneSection>

							{/* ─── 2. Untriaged Backlog ────────────────────────── */}
							<HygieneSection
								id="noPriorityInBacklog"
								title={SIGNAL_LABEL.noPriorityInBacklog}
								description="Backlog cards with priority NONE — un-ranked work that hasn't been triaged."
								count={counts.noPriorityInBacklog}
							>
								{noPriorityQ.data?.cards.length ? (
									<ul className="space-y-1">
										{noPriorityQ.data.cards.slice(0, 8).map((c) => (
											<li
												key={c.cardId}
												className="flex items-center gap-2 text-xs text-muted-foreground"
											>
												<Link
													href={cardHref(c)}
													className="flex flex-1 items-center gap-2 hover:text-foreground"
												>
													<span className="font-mono text-2xs text-muted-foreground/70">
														{c.ref}
													</span>
													<span className="truncate">{c.title}</span>
													<span className="text-muted-foreground/60">· {c.projectName}</span>
													<ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/60" />
												</Link>
											</li>
										))}
										{noPriorityQ.data.cards.length > 8 && (
											<li className="text-2xs text-muted-foreground/60">
												+ {noPriorityQ.data.cards.length - 8} more
											</li>
										)}
									</ul>
								) : null}
							</HygieneSection>

							{/* ─── 3. Overdue milestones ───────────────────────── */}
							<HygieneSection
								id="overdueMilestones"
								title={SIGNAL_LABEL.overdueMilestones}
								description="Active milestones with a target date in the past."
								count={counts.overdueMilestones}
							>
								{overdueQ.data?.milestones.length ? (
									<ul className="space-y-1">
										{overdueQ.data.milestones.slice(0, 8).map((m) => (
											<li
												key={m.milestoneId}
												className="flex items-center gap-2 text-xs text-muted-foreground"
											>
												<Link
													href={projectHref(m.projectId)}
													className="flex flex-1 items-center gap-2 hover:text-foreground"
												>
													<span className="truncate font-medium text-foreground/80">{m.name}</span>
													<Badge variant="outline" className="px-1.5 py-0 text-2xs">
														{m.overdueDays}d overdue
													</Badge>
													<span className="text-muted-foreground/60">
														{m.openCardCount} open · {m.projectName}
													</span>
													<ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/60" />
												</Link>
											</li>
										))}
										{overdueQ.data.milestones.length > 8 && (
											<li className="text-2xs text-muted-foreground/60">
												+ {overdueQ.data.milestones.length - 8} more
											</li>
										)}
									</ul>
								) : null}
							</HygieneSection>

							{/* ─── 4. Taxonomy drift ───────────────────────────── */}
							<HygieneSection
								id="taxonomyDrift"
								title={SIGNAL_LABEL.taxonomyDrift}
								description="Single-use tags and Levenshtein-≤2 near-miss pairs (likely typos)."
								count={counts.taxonomyDrift}
							>
								{driftQ.data ? (
									<div className="space-y-3">
										{driftQ.data.nearMissTagPairs.length > 0 && (
											<div>
												<div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
													Near-miss pairs
												</div>
												<ul className="space-y-1">
													{driftQ.data.nearMissTagPairs.slice(0, 6).map((p, idx) => (
														<li
															key={`${p.a.tagId}-${p.b.tagId}-${idx}`}
															className="flex items-center gap-2 text-xs text-muted-foreground"
														>
															<Link
																href={projectTagsHref(p.projectId)}
																className="flex flex-1 items-center gap-2 hover:text-foreground"
															>
																<code className="rounded bg-muted/50 px-1 text-2xs">
																	{p.a.slug}
																</code>
																<span className="text-muted-foreground/50">↔</span>
																<code className="rounded bg-muted/50 px-1 text-2xs">
																	{p.b.slug}
																</code>
																<span className="text-muted-foreground/60">
																	· dist {p.distance} · {p.projectName}
																</span>
																<ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/60" />
															</Link>
														</li>
													))}
												</ul>
											</div>
										)}
										{driftQ.data.singleUseTags.length > 0 && (
											<div>
												<div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
													Single-use tags
												</div>
												<ul className="space-y-1">
													{driftQ.data.singleUseTags.slice(0, 6).map((t) => (
														<li
															key={t.tagId}
															className="flex items-center gap-2 text-xs text-muted-foreground"
														>
															<Link
																href={projectTagsHref(t.projectId)}
																className="flex flex-1 items-center gap-2 hover:text-foreground"
															>
																<code className="rounded bg-muted/50 px-1 text-2xs">{t.label}</code>
																<span className="text-muted-foreground/60">· {t.projectName}</span>
																<ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/60" />
															</Link>
														</li>
													))}
												</ul>
											</div>
										)}
									</div>
								) : null}
							</HygieneSection>

							{/* ─── 5. Stale decisions ──────────────────────────── */}
							<HygieneSection
								id="staleDecisions"
								title={SIGNAL_LABEL.staleDecisions}
								description="Projects with activity in the last 30 days but no recorded decision in 60 days."
								count={counts.staleDecisions}
							>
								{staleDecisionsQ.data?.projects.length ? (
									<ul className="space-y-1">
										{staleDecisionsQ.data.projects.slice(0, 8).map((p) => (
											<li
												key={p.projectId}
												className="flex items-center gap-2 text-xs text-muted-foreground"
											>
												<Link
													href={projectHref(p.projectId)}
													className="flex flex-1 items-center gap-2 hover:text-foreground"
												>
													<span className="truncate font-medium text-foreground/80">
														{p.projectName}
													</span>
													<span className="text-muted-foreground/60">
														{p.daysSinceLastDecision !== null
															? `last decision ${p.daysSinceLastDecision}d ago`
															: "no decisions on record"}
													</span>
													<ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/60" />
												</Link>
											</li>
										))}
									</ul>
								) : null}
							</HygieneSection>
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
}

function HygieneSection({
	id,
	title,
	description,
	count,
	children,
}: {
	id: SignalKey;
	title: string;
	description: string;
	count: number;
	children: React.ReactNode;
}) {
	const Icon = SIGNAL_ICON[id];
	return (
		<div data-testid={`hygiene-section-${id}`}>
			<div className="mb-1.5 flex items-center gap-2">
				<Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
				<h3 className="text-xs font-semibold text-foreground/80">{title}</h3>
				<Badge variant="outline" className="px-1.5 py-0 text-2xs font-normal">
					{count}
				</Badge>
			</div>
			<p className="mb-2 text-2xs text-muted-foreground/70">{description}</p>
			{count === 0 ? <p className="text-2xs text-muted-foreground/60">Clean.</p> : children}
		</div>
	);
}
