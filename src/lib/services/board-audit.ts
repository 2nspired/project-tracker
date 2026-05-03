/**
 * Shared board-audit service (#173).
 *
 * Both the Next.js web server (the new `boardHealth` tRPC router that backs
 * the dashboard hygiene panel) and the MCP process (the `auditBoard`
 * extended tool, agent-only since v4.2) need the same hygiene-signal
 * computation. Each process owns its own `PrismaClient`, so this module
 * exports a `createBoardAuditService(prisma)` factory rather than a
 * singleton — mirrors `tag.ts` / `milestone.ts` and satisfies the v6.2
 * decision that `src/server/` and `src/mcp/` never import from each other
 * (see `scripts/lint-boundary.mjs`).
 *
 * The web-side singleton bound to the FTS-extended db lives in the shim
 * at `src/server/services/board-audit-service.ts`. MCP callers construct
 * their own instance via `createBoardAuditService(mcpDb)`.
 *
 * Six entry points:
 *   - `auditBoard(boardId, opts)` — full board audit (preserved MCP API)
 *   - `findMissingTags(opts)` — cards with zero CardTag rows
 *   - `findNoPriorityBacklog(opts)` — Backlog-role cards with priority=NONE
 *   - `findOverdueMilestones(opts)` — active milestones with targetDate < now
 *   - `findTaxonomyDrift(opts)` — single-use tags + Levenshtein-≤2 near-miss pairs
 *   - `findStaleDecisions(opts)` — projects with 30d activity but no decision in 60d
 *
 * Each per-signal helper accepts `{ projectId? }`. Omitting `projectId`
 * yields a cross-project rollup for the dashboard. The dashboard panel
 * (`<DashboardHygienePanel />`) parallel-fetches each via React Query so
 * a slow signal can't block the panel render.
 */

import type { PrismaClient } from "prisma/generated/client";
import { hasRole } from "@/lib/column-roles";
import { findStaleInProgress } from "@/lib/services/stale-cards";
import { editDistance } from "@/lib/slugify";
import type { ServiceResult } from "@/server/services/types/service-result";

// ─── Types ───────────────────────────────────────────────────────────

export type CardRef = {
	cardId: string;
	ref: string;
	title: string;
	column: string;
	projectId: string;
	projectName: string;
	boardId: string;
};

export type MissingTagsResult = {
	count: number;
	cards: CardRef[];
};

export type NoPriorityBacklogResult = {
	count: number;
	cards: CardRef[];
};

export type OverdueMilestoneEntry = {
	milestoneId: string;
	name: string;
	targetDate: Date;
	overdueDays: number;
	projectId: string;
	projectName: string;
	openCardCount: number;
};

export type OverdueMilestonesResult = {
	count: number;
	milestones: OverdueMilestoneEntry[];
};

export type SingleUseTagEntry = {
	tagId: string;
	slug: string;
	label: string;
	projectId: string;
	projectName: string;
};

export type NearMissTagPair = {
	a: { tagId: string; slug: string; label: string };
	b: { tagId: string; slug: string; label: string };
	distance: number;
	projectId: string;
	projectName: string;
};

export type TaxonomyDriftResult = {
	count: number;
	singleUseTags: SingleUseTagEntry[];
	nearMissTagPairs: NearMissTagPair[];
};

export type StaleDecisionEntry = {
	projectId: string;
	projectName: string;
	lastDecisionAt: Date | null;
	lastActivityAt: Date;
	daysSinceLastDecision: number | null;
};

export type StaleDecisionsResult = {
	count: number;
	projects: StaleDecisionEntry[];
};

// ─── Pure helpers (exported for unit tests) ──────────────────────────

/**
 * Detect Levenshtein-≤2 pairs in a slug list. Pure — no DB, no I/O.
 *
 * O(n²) with an early exit per pair via `editDistance`'s threshold. Acceptable
 * up to ~500 tags per project; past that, switch to prefix-bucketed candidate
 * selection (the same comment hangs off `tag.ts:computeGovernanceHints`).
 *
 * Returns each unordered pair exactly once, with `(a, b)` ordered so `a`
 * appears earlier in the input array. Distance is always ≤ 2.
 */
function findNearMissPairs(tags: Array<{ tagId: string; slug: string; label: string }>): Array<{
	a: { tagId: string; slug: string; label: string };
	b: { tagId: string; slug: string; label: string };
	distance: number;
}> {
	const pairs: Array<{
		a: { tagId: string; slug: string; label: string };
		b: { tagId: string; slug: string; label: string };
		distance: number;
	}> = [];
	for (let i = 0; i < tags.length; i++) {
		for (let j = i + 1; j < tags.length; j++) {
			const ti = tags[i];
			const tj = tags[j];
			if (!ti.slug || !tj.slug) continue;
			const d = editDistance(ti.slug, tj.slug, 2);
			if (d <= 2) {
				pairs.push({ a: ti, b: tj, distance: d });
			}
		}
	}
	return pairs;
}

/**
 * Classify a project as "stale-decision" given its activity + decision
 * windows. Pure — no DB.
 *
 * A project is stale-decision when:
 *   - It has any project-touching activity in the last 30 days
 *   - AND it has no `Claim.kind = 'decision'` in the last 60 days
 *
 * The intuition: an active project should ship decisions. Long activity-
 * without-decisions usually means undocumented choices accumulating.
 * Inactive projects don't qualify — they're paused, not drifting.
 *
 * `lastActivityAt` is the most recent of: any card's updatedAt, any
 * activity row, any comment, any handoff, any claim. `lastDecisionAt`
 * is the most recent decision-kind claim's createdAt (null if none).
 */
function isStaleDecisionProject(input: {
	now: Date;
	lastActivityAt: Date;
	lastDecisionAt: Date | null;
	activityWindowDays?: number;
	decisionWindowDays?: number;
}): boolean {
	const activityWindow = input.activityWindowDays ?? 30;
	const decisionWindow = input.decisionWindowDays ?? 60;
	const dayMs = 24 * 60 * 60 * 1000;
	const activityCutoff = input.now.getTime() - activityWindow * dayMs;
	const decisionCutoff = input.now.getTime() - decisionWindow * dayMs;

	// Inactive projects don't qualify — drift requires recent activity.
	if (input.lastActivityAt.getTime() < activityCutoff) return false;

	// No decisions ever ⇒ stale (project has activity but never recorded a decision).
	if (!input.lastDecisionAt) return true;

	// Last decision older than 60d while project has 30d activity ⇒ stale.
	return input.lastDecisionAt.getTime() < decisionCutoff;
}

// ─── Service factory ─────────────────────────────────────────────────

export type BoardAuditOptions = {
	excludeDone?: boolean;
	weights?: {
		priority: number;
		tags: number;
		milestone: number;
		checklist: number;
		staleInProgress: number;
	};
};

export type AuditBoardResult = {
	totalCards: number;
	healthScore: string;
	scoring: {
		weights: {
			priority: number;
			tags: number;
			milestone: number;
			checklist: number;
			staleInProgress: number;
		};
		perDimension: {
			priority: { issues: number; weight: number };
			tags: { issues: number; weight: number };
			milestone: { issues: number; weight: number };
			checklist: { issues: number; weight: number };
			staleInProgress: { issues: number; weight: number };
		};
	};
	missingPriority: { count: number; cards: Array<{ ref: string; title: string; column: string }> };
	missingTags: { count: number; cards: Array<{ ref: string; title: string; column: string }> };
	noMilestone: { count: number; cards: Array<{ ref: string; title: string; column: string }> };
	emptyChecklist: { count: number; cards: Array<{ ref: string; title: string; column: string }> };
	staleInProgress: {
		count: number;
		cards: Array<{ ref: string; title: string; column: string; days: number }>;
	};
	taxonomy: {
		singleUseTags: { count: number; tags: Array<{ slug: string; label: string }> };
		nearMissTags: {
			count: number;
			pairs: Array<{ a: string; b: string; distance: number }>;
		};
		staleActiveMilestones: {
			count: number;
			milestones: Array<{ name: string; cardCount: number }>;
		};
	};
};

export function createBoardAuditService(prisma: PrismaClient) {
	/**
	 * Per-board hygiene audit (preserves the MCP `auditBoard` response shape).
	 *
	 * Combines card-level checks (missing priority/tags/milestone/checklist,
	 * stale-in-progress) with project-scoped taxonomy signals (single-use
	 * tags, Levenshtein-≤2 near-miss tag pairs, stale-active milestones).
	 *
	 * Response keys are FROZEN — the MCP tool exposes this verbatim to
	 * agent callers and any rename is a breaking change.
	 */
	async function auditBoard(
		boardId: string,
		options?: BoardAuditOptions
	): Promise<ServiceResult<AuditBoardResult>> {
		try {
			const excludeDone = options?.excludeDone ?? true;
			const w = options?.weights ?? {
				priority: 1,
				tags: 1,
				milestone: 1,
				checklist: 1,
				staleInProgress: 1,
			};

			const board = await prisma.board.findUnique({
				where: { id: boardId },
				include: {
					columns: {
						orderBy: { position: "asc" },
						include: {
							cards: {
								include: {
									checklists: { select: { id: true } },
									milestone: { select: { name: true } },
									cardTags: { select: { tagId: true } },
								},
							},
						},
					},
				},
			});
			if (!board) {
				return { success: false, error: { code: "NOT_FOUND", message: "Board not found." } };
			}

			let columns = board.columns;
			if (excludeDone) {
				columns = columns.filter((col) => !hasRole(col, "done") && !hasRole(col, "parking"));
			}

			const allCards = columns.flatMap((col) => col.cards.map((c) => ({ ...c, column: col.name })));

			const missingPriority = allCards
				.filter((c) => c.priority === "NONE")
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
			const missingTags = allCards
				.filter((c) => c.cardTags.length === 0)
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
			const noMilestone = allCards
				.filter((c) => !c.milestone)
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));
			const emptyChecklist = allCards
				.filter((c) => c.checklists.length === 0)
				.map((c) => ({ ref: `#${c.number}`, title: c.title, column: c.column }));

			const staleMap = await findStaleInProgress(prisma, boardId);
			const staleInProgress = allCards
				.filter((c) => staleMap.has(c.id))
				.map((c) => {
					const info = staleMap.get(c.id);
					if (!info) return null;
					return { ref: `#${c.number}`, title: c.title, column: c.column, days: info.days };
				})
				.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

			// ─── Taxonomy-level signals ─────────────────────────────────
			const { projectId } = board;

			const tagsWithUsage = await prisma.tag.findMany({
				where: { projectId },
				select: {
					slug: true,
					label: true,
					_count: { select: { cardTags: true } },
				},
			});

			const singleUseTags = tagsWithUsage
				.filter((t) => t._count.cardTags === 1)
				.map((t) => ({ slug: t.slug, label: t.label }));

			const slugs = tagsWithUsage.map((t) => t.slug);
			const nearMissTagPairs: Array<{ a: string; b: string; distance: number }> = [];
			for (let i = 0; i < slugs.length; i++) {
				for (let j = i + 1; j < slugs.length; j++) {
					const d = editDistance(slugs[i], slugs[j], 2);
					if (d <= 2) {
						nearMissTagPairs.push({ a: slugs[i], b: slugs[j], distance: d });
					}
				}
			}

			const activeMilestones = await prisma.milestone.findMany({
				where: { projectId, state: "active" },
				select: {
					name: true,
					cards: {
						select: { column: { select: { role: true, name: true } } },
					},
				},
			});

			const staleActiveMilestones = activeMilestones
				.filter((m) => {
					if (m.cards.length === 0) return false;
					return m.cards.every((c) => hasRole(c.column, "done") || hasRole(c.column, "parking"));
				})
				.map((m) => ({ name: m.name, cardCount: m.cards.length }));

			const totalCards = allCards.length;
			const totalWeight = w.priority + w.tags + w.milestone + w.checklist + w.staleInProgress;
			const weightedIssues =
				missingPriority.length * w.priority +
				missingTags.length * w.tags +
				noMilestone.length * w.milestone +
				emptyChecklist.length * w.checklist +
				staleInProgress.length * w.staleInProgress;
			const maxScore = totalCards * totalWeight;
			const healthScore =
				maxScore > 0 ? `${Math.round(((maxScore - weightedIssues) / maxScore) * 100)}%` : "N/A";

			return {
				success: true,
				data: {
					totalCards,
					healthScore,
					scoring: {
						weights: w,
						perDimension: {
							priority: { issues: missingPriority.length, weight: w.priority },
							tags: { issues: missingTags.length, weight: w.tags },
							milestone: { issues: noMilestone.length, weight: w.milestone },
							checklist: { issues: emptyChecklist.length, weight: w.checklist },
							staleInProgress: { issues: staleInProgress.length, weight: w.staleInProgress },
						},
					},
					missingPriority: { count: missingPriority.length, cards: missingPriority },
					missingTags: { count: missingTags.length, cards: missingTags },
					noMilestone: { count: noMilestone.length, cards: noMilestone },
					emptyChecklist: { count: emptyChecklist.length, cards: emptyChecklist },
					staleInProgress: { count: staleInProgress.length, cards: staleInProgress },
					taxonomy: {
						singleUseTags: { count: singleUseTags.length, tags: singleUseTags },
						nearMissTags: { count: nearMissTagPairs.length, pairs: nearMissTagPairs },
						staleActiveMilestones: {
							count: staleActiveMilestones.length,
							milestones: staleActiveMilestones,
						},
					},
				},
			};
		} catch (error) {
			console.error("[BOARD_AUDIT_SERVICE] auditBoard error:", error);
			return {
				success: false,
				error: { code: "AUDIT_FAILED", message: "Failed to run board audit." },
			};
		}
	}

	/**
	 * Cards with zero tags. Excludes Done/Parking columns by default — done
	 * cards aren't actionable hygiene work. `projectId` is optional; omit
	 * for a cross-project rollup (the dashboard's default scope).
	 */
	async function findMissingTags(options?: {
		projectId?: string;
	}): Promise<ServiceResult<MissingTagsResult>> {
		try {
			const cards = await prisma.card.findMany({
				where: {
					...(options?.projectId ? { projectId: options.projectId } : {}),
					cardTags: { none: {} },
				},
				select: {
					id: true,
					number: true,
					title: true,
					projectId: true,
					project: { select: { name: true } },
					column: {
						select: {
							name: true,
							role: true,
							boardId: true,
						},
					},
				},
				orderBy: { updatedAt: "desc" },
			});

			// Drop Done/Parking — non-actionable.
			const filtered = cards.filter(
				(c) => !hasRole(c.column, "done") && !hasRole(c.column, "parking")
			);

			const items: CardRef[] = filtered.map((c) => ({
				cardId: c.id,
				ref: `#${c.number}`,
				title: c.title,
				column: c.column.name,
				projectId: c.projectId,
				projectName: c.project.name,
				boardId: c.column.boardId,
			}));

			return { success: true, data: { count: items.length, cards: items } };
		} catch (error) {
			console.error("[BOARD_AUDIT_SERVICE] findMissingTags error:", error);
			return {
				success: false,
				error: { code: "AUDIT_FAILED", message: "Failed to find cards missing tags." },
			};
		}
	}

	/**
	 * Backlog-role cards with priority=NONE — un-triaged work that hasn't
	 * been ranked. Backlog is where priority sets direction; we restrict
	 * the signal there rather than firing on every NONE card across the
	 * board (would be too noisy on Active/Review where priority is often
	 * already set during planning).
	 */
	async function findNoPriorityBacklog(options?: {
		projectId?: string;
	}): Promise<ServiceResult<NoPriorityBacklogResult>> {
		try {
			const cards = await prisma.card.findMany({
				where: {
					...(options?.projectId ? { projectId: options.projectId } : {}),
					priority: "NONE",
				},
				select: {
					id: true,
					number: true,
					title: true,
					projectId: true,
					project: { select: { name: true } },
					column: {
						select: {
							name: true,
							role: true,
							boardId: true,
						},
					},
				},
				orderBy: { updatedAt: "desc" },
			});

			const filtered = cards.filter((c) => hasRole(c.column, "backlog"));

			const items: CardRef[] = filtered.map((c) => ({
				cardId: c.id,
				ref: `#${c.number}`,
				title: c.title,
				column: c.column.name,
				projectId: c.projectId,
				projectName: c.project.name,
				boardId: c.column.boardId,
			}));

			return { success: true, data: { count: items.length, cards: items } };
		} catch (error) {
			console.error("[BOARD_AUDIT_SERVICE] findNoPriorityBacklog error:", error);
			return {
				success: false,
				error: {
					code: "AUDIT_FAILED",
					message: "Failed to find Backlog cards with no priority.",
				},
			};
		}
	}

	/**
	 * Active milestones whose `targetDate` is in the past. Excludes
	 * milestones with no targetDate (no commitment to be late on) and
	 * archived milestones (already retired). `openCardCount` is the
	 * number of cards on the milestone not in Done/Parking — the
	 * "what's still on the hook" lens.
	 */
	async function findOverdueMilestones(options?: {
		projectId?: string;
		now?: Date;
	}): Promise<ServiceResult<OverdueMilestonesResult>> {
		try {
			const now = options?.now ?? new Date();
			const milestones = await prisma.milestone.findMany({
				where: {
					...(options?.projectId ? { projectId: options.projectId } : {}),
					state: "active",
					targetDate: { lt: now },
				},
				select: {
					id: true,
					name: true,
					targetDate: true,
					projectId: true,
					project: { select: { name: true } },
					cards: {
						select: { column: { select: { role: true, name: true } } },
					},
				},
				orderBy: { targetDate: "asc" },
			});

			const dayMs = 24 * 60 * 60 * 1000;
			const items: OverdueMilestoneEntry[] = milestones
				.filter((m) => m.targetDate !== null)
				.map((m) => {
					const target = m.targetDate as Date;
					const openCardCount = m.cards.filter(
						(c) => !hasRole(c.column, "done") && !hasRole(c.column, "parking")
					).length;
					return {
						milestoneId: m.id,
						name: m.name,
						targetDate: target,
						overdueDays: Math.floor((now.getTime() - target.getTime()) / dayMs),
						projectId: m.projectId,
						projectName: m.project.name,
						openCardCount,
					};
				});

			return { success: true, data: { count: items.length, milestones: items } };
		} catch (error) {
			console.error("[BOARD_AUDIT_SERVICE] findOverdueMilestones error:", error);
			return {
				success: false,
				error: { code: "AUDIT_FAILED", message: "Failed to find overdue milestones." },
			};
		}
	}

	/**
	 * Tag taxonomy drift — single-use tags + Levenshtein-≤2 near-miss
	 * slug pairs, project-scoped. Single-use tags are likely premature or
	 * one-off; near-miss pairs (e.g. `feature` / `feauture`) signal a typo
	 * that's already split a tag's usage. Both are merge candidates.
	 *
	 * Optimization: when `projectId` is omitted, we still fetch tags
	 * project-scoped and compute pairs within each project — we never
	 * pair tags across projects (slugs collide across project namespaces
	 * by design).
	 */
	async function findTaxonomyDrift(options?: {
		projectId?: string;
	}): Promise<ServiceResult<TaxonomyDriftResult>> {
		try {
			const tags = await prisma.tag.findMany({
				where: {
					...(options?.projectId ? { projectId: options.projectId } : {}),
					state: "active",
				},
				select: {
					id: true,
					slug: true,
					label: true,
					projectId: true,
					project: { select: { name: true } },
					_count: { select: { cardTags: true } },
				},
			});

			const singleUseTags: SingleUseTagEntry[] = tags
				.filter((t) => t._count.cardTags === 1)
				.map((t) => ({
					tagId: t.id,
					slug: t.slug,
					label: t.label,
					projectId: t.projectId,
					projectName: t.project.name,
				}));

			// Pair within-project only — slugs aren't globally unique.
			const byProject = new Map<
				string,
				{
					projectName: string;
					tags: Array<{ tagId: string; slug: string; label: string }>;
				}
			>();
			for (const t of tags) {
				let bucket = byProject.get(t.projectId);
				if (!bucket) {
					bucket = { projectName: t.project.name, tags: [] };
					byProject.set(t.projectId, bucket);
				}
				bucket.tags.push({ tagId: t.id, slug: t.slug, label: t.label });
			}

			const nearMissTagPairs: NearMissTagPair[] = [];
			for (const [pid, bucket] of byProject) {
				for (const pair of findNearMissPairs(bucket.tags)) {
					nearMissTagPairs.push({
						a: pair.a,
						b: pair.b,
						distance: pair.distance,
						projectId: pid,
						projectName: bucket.projectName,
					});
				}
			}

			const count = singleUseTags.length + nearMissTagPairs.length;
			return { success: true, data: { count, singleUseTags, nearMissTagPairs } };
		} catch (error) {
			console.error("[BOARD_AUDIT_SERVICE] findTaxonomyDrift error:", error);
			return {
				success: false,
				error: { code: "AUDIT_FAILED", message: "Failed to compute taxonomy drift." },
			};
		}
	}

	/**
	 * Projects with 30d activity but no decision in 60d. The intuition is
	 * that an active project should ship decisions; long activity-without-
	 * decisions usually means undocumented choices accumulating. Inactive
	 * projects don't qualify — they're paused, not drifting.
	 *
	 * `lastActivityAt` is computed per project as max(latest card update,
	 * latest comment, latest activity row, latest handoff, latest claim).
	 */
	async function findStaleDecisions(options?: {
		projectId?: string;
		now?: Date;
		activityWindowDays?: number;
		decisionWindowDays?: number;
	}): Promise<ServiceResult<StaleDecisionsResult>> {
		try {
			const now = options?.now ?? new Date();
			const activityWindowDays = options?.activityWindowDays ?? 30;
			const decisionWindowDays = options?.decisionWindowDays ?? 60;

			const projects = await prisma.project.findMany({
				where: options?.projectId ? { id: options.projectId } : {},
				select: { id: true, name: true, updatedAt: true },
			});
			if (projects.length === 0) {
				return { success: true, data: { count: 0, projects: [] } };
			}
			const projectIds = projects.map((p) => p.id);

			// Compute "last signal" per project across multiple activity sources.
			// Kept narrow: card updatedAt, comments, activity rows, handoffs,
			// claims. We don't pull every related table — these five cover
			// "human or agent did something here recently."
			const [cardMax, commentMax, activityMax, handoffMax, claimMax, decisionMax] =
				await Promise.all([
					prisma.card.groupBy({
						by: ["projectId"],
						where: { projectId: { in: projectIds } },
						_max: { updatedAt: true },
					}),
					prisma.comment.groupBy({
						by: ["cardId"],
						where: { card: { projectId: { in: projectIds } } },
						_max: { createdAt: true },
					}),
					prisma.activity.groupBy({
						by: ["cardId"],
						where: { card: { projectId: { in: projectIds } } },
						_max: { createdAt: true },
					}),
					prisma.handoff.groupBy({
						by: ["projectId"],
						where: { projectId: { in: projectIds } },
						_max: { createdAt: true },
					}),
					prisma.claim.groupBy({
						by: ["projectId"],
						where: { projectId: { in: projectIds } },
						_max: { updatedAt: true },
					}),
					prisma.claim.groupBy({
						by: ["projectId"],
						where: {
							projectId: { in: projectIds },
							kind: "decision",
							status: "active",
						},
						_max: { createdAt: true },
					}),
				]);

			// Comment / activity rollups need a project-id reverse-lookup since
			// they group by cardId. One pre-pass yields a cardId → projectId
			// map; we then fold their max timestamps into the per-project max.
			const cardOwners = await prisma.card.findMany({
				where: { projectId: { in: projectIds } },
				select: { id: true, projectId: true },
			});
			const cardToProject = new Map(cardOwners.map((c) => [c.id, c.projectId]));

			const lastByProject = new Map<string, Date>();
			const noteOwner = (rows: Array<{ cardId: string; _max: { createdAt: Date | null } }>) => {
				for (const row of rows) {
					if (!row._max.createdAt) continue;
					const pid = cardToProject.get(row.cardId);
					if (!pid) continue;
					const existing = lastByProject.get(pid);
					if (!existing || row._max.createdAt > existing) {
						lastByProject.set(pid, row._max.createdAt);
					}
				}
			};
			const noteProjectRows = (
				rows: Array<{
					projectId: string;
					_max: { updatedAt?: Date | null; createdAt?: Date | null };
				}>,
				field: "updatedAt" | "createdAt"
			) => {
				for (const row of rows) {
					const v = row._max[field];
					if (!v) continue;
					const existing = lastByProject.get(row.projectId);
					if (!existing || v > existing) {
						lastByProject.set(row.projectId, v);
					}
				}
			};

			// Seed each project with its `Project.updatedAt` so a project that
			// has been edited (renamed, repoPath set) but has no related rows
			// still registers as recently active.
			for (const p of projects) {
				lastByProject.set(p.id, p.updatedAt);
			}

			noteProjectRows(cardMax, "updatedAt");
			noteOwner(commentMax);
			noteOwner(activityMax);
			noteProjectRows(handoffMax, "createdAt");
			noteProjectRows(claimMax, "updatedAt");

			// Decision-only rollup keyed by projectId.
			const lastDecisionByProject = new Map<string, Date>();
			for (const row of decisionMax) {
				if (row._max.createdAt) {
					lastDecisionByProject.set(row.projectId, row._max.createdAt);
				}
			}

			const dayMs = 24 * 60 * 60 * 1000;
			const items: StaleDecisionEntry[] = [];
			for (const p of projects) {
				const lastActivity = lastByProject.get(p.id);
				if (!lastActivity) continue; // never had any signal — skip
				const lastDecision = lastDecisionByProject.get(p.id) ?? null;
				const stale = isStaleDecisionProject({
					now,
					lastActivityAt: lastActivity,
					lastDecisionAt: lastDecision,
					activityWindowDays,
					decisionWindowDays,
				});
				if (!stale) continue;
				items.push({
					projectId: p.id,
					projectName: p.name,
					lastDecisionAt: lastDecision,
					lastActivityAt: lastActivity,
					daysSinceLastDecision: lastDecision
						? Math.floor((now.getTime() - lastDecision.getTime()) / dayMs)
						: null,
				});
			}

			return { success: true, data: { count: items.length, projects: items } };
		} catch (error) {
			console.error("[BOARD_AUDIT_SERVICE] findStaleDecisions error:", error);
			return {
				success: false,
				error: { code: "AUDIT_FAILED", message: "Failed to compute stale-decision projects." },
			};
		}
	}

	return {
		auditBoard,
		findMissingTags,
		findNoPriorityBacklog,
		findOverdueMilestones,
		findTaxonomyDrift,
		findStaleDecisions,
	};
}

export type BoardAuditService = ReturnType<typeof createBoardAuditService>;

// Internals exposed for unit tests — not part of the public service API.
export const __testing__ = {
	findNearMissPairs,
	isStaleDecisionProject,
};
