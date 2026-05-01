/**
 * Shared briefMe payload composition (#192 F3 step 0).
 *
 * The MCP `briefMe` handler and the `recalibrateBaseline` measurement path
 * both need *the exact same payload* — briefMe to emit it to the agent,
 * recalibrate to count its tokens against the naive-bootstrap baseline.
 * Reaching from a service into the MCP handler would couple layers in the
 * wrong direction, so this module owns the payload assembly. The MCP
 * handler is now a thin wrapper that resolves the board (or rejects with
 * a structured error) and forwards everything else here.
 *
 * F2's side-effect points (post-topWork, post-touchedCards) live in the
 * handler — this module is read-only and side-effect free, so the
 * recalibrate path can call it without surprises.
 */

import type { PrismaClient } from "prisma/generated/client";
import { hasRole } from "@/lib/column-roles";
import { computeBoardDiff } from "@/lib/services/board-diff";
import { isRecentDecision } from "@/lib/services/decisions";
import { getLatestHandoff, parseHandoff } from "@/lib/services/handoff";
import { getBlockers as getBlockersShared } from "@/lib/services/relations";
import { loadTrackerPolicy } from "@/lib/services/tracker-policy";
// Re-using the staleness shape from the MCP layer would create a circular
// import, so the helpers are duplicated here. Both copies stay in sync via
// the shape: `formatStalenessWarnings` is pure formatting and
// `checkStaleness` is a pure read; lifting them is out of scope.
import type { UpgradeReport } from "@/lib/upgrade-report";
import { computeWorkNextScore } from "@/lib/work-next-score";
import { checkStaleness, formatStalenessWarnings } from "@/mcp/staleness";
import type { VersionCheckResult } from "@/server/api/routers/system";
import { findStaleInProgress } from "@/server/services/stale-cards";
import { tokenUsageService } from "@/server/services/token-usage-service";

// ─── Helpers ───────────────────────────────────────────────────────

function humanizeAge(date: Date): string {
	const ms = Date.now() - date.getTime();
	const minutes = Math.floor(ms / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

// ─── Types ─────────────────────────────────────────────────────────

export type BriefPayloadOptions = {
	/** Agent identifier used to filter recent-activity intent reminders. Defaults to "Agent". */
	agentName?: string;
	/** MCP server version stamped in `_serverVersion`. Optional — omitted from the payload when undefined. */
	serverVersion?: string;
	/** When true, surfaces `_brandDeprecation` in the payload. */
	isLegacyBrand?: boolean;
	/** Deprecation notice rendered when `isLegacyBrand` is true. */
	legacyBrandDeprecation?: string;
	/** Boot-time commit SHA — paired with `headSha` to detect stale-server warnings. */
	bootSha?: string | null;
	/** Current repo HEAD SHA — paired with `bootSha`. */
	headSha?: string | null;
	/** Set when briefMe was auto-resolved from cwd; surfaces `resolvedFromCwd`. */
	autoResolved?: { projectName: string; boardName: string } | null;
	/**
	 * Result of the GitHub Releases version check. When present and outdated,
	 * surfaces `_upgrade` so the agent can prompt the human to upgrade.
	 * @since 6.1.0
	 */
	upgradeInfo?: VersionCheckResult;
	/**
	 * Disk-backed signal from the most recent `npm run service:update`. When
	 * present and the doctor pass had any failure or warning, surfaces a
	 * concise `_upgradeReport` so the agent sees post-upgrade health on the
	 * next session start. The MCP handler is responsible for one-shot
	 * clearing the source file after surfacing.
	 * @since 6.1.0
	 */
	upgradeReport?: UpgradeReport;
};

export type BriefPayload = Record<string, unknown>;

// ─── Composition ───────────────────────────────────────────────────

/**
 * Build the briefMe response payload for `boardId`. Pure composition —
 * no writes, no mutations. The caller is responsible for resolving the
 * board ID and for handling any board-not-found error case before invoking
 * this function.
 *
 * Throws if the board can't be loaded, so callers should validate
 * existence first (the MCP handler does this in `resolveBoardFromCwd`).
 */
export async function buildBriefPayload(
	boardId: string,
	db: PrismaClient,
	options: BriefPayloadOptions = {}
): Promise<BriefPayload> {
	const agentName = options.agentName ?? "Agent";

	const board = await db.board.findUnique({
		where: { id: boardId },
		include: {
			project: {
				select: { id: true, name: true, repoPath: true },
			},
			columns: {
				orderBy: { position: "asc" },
				include: {
					cards: {
						orderBy: { position: "asc" },
						select: {
							id: true,
							number: true,
							title: true,
							position: true,
							priority: true,
							updatedAt: true,
							dueDate: true,
							checklists: { select: { completed: true } },
							relationsTo: { where: { type: "blocks" }, select: { id: true } },
							relationsFrom: { where: { type: "blocks" }, select: { id: true } },
						},
					},
				},
			},
		},
	});

	if (!board) {
		throw new Error(`buildBriefPayload: board ${boardId} not found`);
	}

	const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const [
		lastHandoff,
		decisionClaims,
		stalenessWarnings,
		blockerEntries,
		recentAgentActivity,
		staleInProgressMap,
		policyResult,
		tokenSummary,
	] = await Promise.all([
		getLatestHandoff(db, boardId),
		db.claim.findMany({
			where: { projectId: board.project.id, kind: "decision", status: "active" },
			orderBy: { createdAt: "desc" },
			take: 10,
			select: {
				id: true,
				statement: true,
				card: {
					select: {
						number: true,
						column: { select: { role: true, name: true } },
					},
				},
			},
		}),
		checkStaleness(board.project.id),
		getBlockersShared(db, boardId),
		db.activity.findMany({
			where: {
				actorType: "AGENT",
				actorName: agentName,
				createdAt: { gte: twentyFourHoursAgo },
				card: { column: { boardId } },
			},
			select: { id: true, intent: true },
		}),
		findStaleInProgress(db, boardId),
		loadTrackerPolicy({
			repoPath: board.project.repoPath,
		}),
		tokenUsageService.getProjectSummary(board.project.id),
	]);

	const allCards = board.columns.flatMap((col) => col.cards.map((card) => ({ card, column: col })));
	const openCards = allCards.filter(
		({ column }) => !hasRole(column, "done") && !hasRole(column, "parking")
	);
	const inProgressCount = allCards.filter(({ column }) => hasRole(column, "active")).length;

	const handoffAge = lastHandoff ? humanizeAge(lastHandoff.createdAt) : null;
	const pulseParts = [
		`${openCards.length} open`,
		`${inProgressCount} in progress`,
		`${blockerEntries.length} blocked`,
	];
	if (handoffAge) pulseParts.push(`handoff ${handoffAge} ago`);
	const pulse = `${board.project.name} / ${board.name} · ${pulseParts.join(" · ")}`;

	const diff = lastHandoff ? await computeBoardDiff(db, boardId, lastHandoff.createdAt) : null;

	// Top N positions in Backlog are treated as human-pinned and surface
	// ahead of score-ranked Backlog cards. Replaces the old "Up Next"
	// column tier (#97).
	const PIN_THRESHOLD = 3;
	const scoredCards = openCards
		.map(({ card, column }) => ({
			ref: `#${card.number}`,
			title: card.title,
			column: column.name,
			priority: card.priority,
			score: computeWorkNextScore({
				priority: card.priority,
				updatedAt: card.updatedAt,
				dueDate: card.dueDate,
				checklists: card.checklists,
				_blockedByCount: card.relationsTo.length,
				_blocksOtherCount: card.relationsFrom.length,
			}),
			source: hasRole(column, "active")
				? ("active" as const)
				: hasRole(column, "backlog") && card.position < PIN_THRESHOLD
					? ("pinned" as const)
					: ("scored" as const),
		}))
		.filter((c) => c.score >= 0);
	const tierRank = { active: 0, pinned: 1, scored: 2 } as const;
	const topWork = scoredCards
		.sort((a, b) => tierRank[a.source] - tierRank[b.source] || b.score - a.score)
		.slice(0, 3);

	const parsedHandoff = lastHandoff ? parseHandoff(lastHandoff) : null;
	const handoff = parsedHandoff
		? {
				agentName: parsedHandoff.agentName,
				createdAt: parsedHandoff.createdAt,
				summary: parsedHandoff.summary,
				nextSteps: parsedHandoff.nextSteps,
				blockers: parsedHandoff.blockers,
			}
		: null;

	const blockers = blockerEntries.map((b) => ({
		ref: `#${b.card.number}`,
		title: b.card.title,
		blockedBy: b.blockedBy.map((bb) => `#${bb.number}`),
	}));

	const recentDecisions = decisionClaims.filter(isRecentDecision).map((d) => ({
		id: d.id,
		title: d.statement,
		card: d.card ? `#${d.card.number}` : null,
	}));

	const writesWithIntent = recentAgentActivity.filter((a) => a.intent !== null).length;
	const totalAgentWrites = recentAgentActivity.length;
	const intentReminder =
		totalAgentWrites >= 3 && writesWithIntent === 0
			? `No recent intent observed on ${totalAgentWrites} writes in the last 24h — pass a short \`intent\` on moveCard/updateCard so the human sees *why* live. See AGENTS.md § Intent on Writes.`
			: null;

	const bootSha = options.bootSha ?? null;
	const headSha = options.headSha ?? null;
	const versionMismatch =
		bootSha && headSha && bootSha !== headSha
			? `Server is running commit ${bootSha.slice(0, 7)} but repo HEAD is ${headSha.slice(0, 7)} — restart the MCP server to pick up newer code.`
			: null;

	// Released-version drift signal. Distinct from `_versionMismatch` (which is
	// boot-vs-HEAD inside one checkout): this fires when a *newer release* is
	// published on GitHub. Field absent when in-sync, when offline / opt-out
	// (`latest === null`), or when the caller skipped the version check.
	const upgradeInfo = options.upgradeInfo;
	const upgrade =
		upgradeInfo?.isOutdated && upgradeInfo.latest !== null
			? {
					current: upgradeInfo.current,
					latest: upgradeInfo.latest,
					isOutdated: true as const,
					commands: ["git pull", "npm run service:update"],
				}
			: null;

	// Post-`service:update` doctor signal (#215). Surface only when a check
	// actually failed or warned — clean upgrades produce no field so the
	// agent never sees noise. The handler is responsible for stale-guard
	// (>24h) and one-shot clearing of `data/last-upgrade.json` after
	// briefMe returns.
	const upgradeReport = options.upgradeReport;
	const upgradeReportField =
		upgradeReport &&
		(upgradeReport.doctor.summary.fail > 0 || upgradeReport.doctor.summary.warn > 0)
			? {
					completedAt: upgradeReport.completedAt,
					targetVersion: upgradeReport.targetVersion,
					summary: upgradeReport.doctor.summary,
					failed: upgradeReport.doctor.checks
						.filter((c) => c.status === "fail" || c.status === "warn")
						.map((c) => ({
							name: c.name,
							status: c.status,
							message: c.message,
							...(c.fix ? { fix: c.fix } : {}),
						})),
				}
			: null;

	const staleInProgress = allCards
		.map(({ card }) => {
			const info = staleInProgressMap.get(card.id);
			if (!info) return null;
			return {
				ref: `#${card.number}`,
				title: card.title,
				days: info.days,
				lastSignalAt: info.lastSignalAt.toISOString(),
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
		.sort((a, b) => b.days - a.days);

	// Token usage pulse — omitted when no events recorded so projects
	// without the Stop hook configured don't see noise. (#96)
	const tokenPulse =
		tokenSummary.success && tokenSummary.data.trackingSince
			? {
					totalCostUsd: Number(tokenSummary.data.totalCostUsd.toFixed(6)),
					sessionCount: tokenSummary.data.sessionCount,
					trackingSince: tokenSummary.data.trackingSince.toISOString(),
				}
			: null;

	const briefPayload: BriefPayload = {
		...(options.serverVersion ? { _serverVersion: options.serverVersion } : {}),
		...(options.isLegacyBrand && options.legacyBrandDeprecation
			? { _brandDeprecation: options.legacyBrandDeprecation }
			: {}),
		...(versionMismatch ? { _versionMismatch: versionMismatch } : {}),
		...(upgrade ? { _upgrade: upgrade } : {}),
		...(upgradeReportField ? { _upgradeReport: upgradeReportField } : {}),
		...(policyResult.warnings.length > 0 ? { _warnings: policyResult.warnings } : {}),
		pulse,
		...(options.autoResolved ? { resolvedFromCwd: { ...options.autoResolved, boardId } } : {}),
		policy: policyResult.policy,
		...(policyResult.policy_error ? { policy_error: policyResult.policy_error } : {}),
		handoff,
		diff,
		topWork,
		blockers,
		recentDecisions,
		...(tokenPulse ? { tokenPulse } : {}),
		stale: formatStalenessWarnings(stalenessWarnings),
		...(staleInProgress.length > 0 ? { staleInProgress } : {}),
		...(intentReminder ? { intentReminder } : {}),
		_hint: lastHandoff
			? "Continue via handoff.nextSteps or pick from topWork (cards with source='pinned' are human-prioritized — top of Backlog by drag order — pick those before source='scored'). Use runTool('getCardContext', { cardId }) for deep work. Run `listWorkflows({ boardId })` to see named recipes (sessionStart, sessionEnd, recordDecision, searchKnowledge)."
			: "No prior handoff — pick from topWork (cards with source='pinned' are human-prioritized — top of Backlog by drag order — pick those before source='scored'). Run `listWorkflows({ boardId })` for the full recipe set; call `saveHandoff` before wrapping to save context.",
	};

	return briefPayload;
}
