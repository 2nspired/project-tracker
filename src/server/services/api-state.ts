/**
 * State snapshot for the read-only /api/state endpoint (#110).
 *
 * Builds a single JSON document describing every project + board in the
 * tracker — counts by horizon, in-flight cards, recent activity, last
 * handoff, stale signals — for external observability consumers
 * (statuslines, dashboards, IDE plugins).
 */

import { hasRole } from "@/lib/column-roles";
import { getLatestHandoff } from "@/lib/services/handoff";
import { db } from "@/server/db";
import { findStaleInProgress } from "@/server/services/stale-cards";

export const API_STATE_SCHEMA_VERSION = "1.0";

const DEFAULT_GLOBAL_ACTIVITY_LIMIT = 10;
const DEFAULT_BOARD_ACTIVITY_LIMIT = 50;

export type ApiState = {
	generated_at: string;
	schema_version: string;
	projects: ApiStateProject[];
};

export type ApiStateProject = {
	id: string;
	slug: string;
	name: string;
	boards: ApiStateBoard[];
};

export type ApiStateBoard = {
	id: string;
	name: string;
	counts: {
		in_progress: number;
		review: number;
		up_next: number;
		backlog: number;
		blocked: number;
		stale_in_progress: number;
	};
	in_progress: ApiStateInProgressCard[];
	recent_activity: ApiStateActivity[];
	last_handoff_at: string | null;
};

export type ApiStateInProgressCard = {
	ref: string;
	title: string;
	priority: string;
	lastSignalAt: string | null;
	lastEditedBy: string | null;
};

export type ApiStateActivity = {
	at: string;
	actor: string | null;
	ref: string | null;
	action: string;
	intent: string | null;
};

async function buildBoardState(
	boardId: string,
	activityLimit: number
): Promise<ApiStateBoard | null> {
	const board = await db.board.findUnique({
		where: { id: boardId },
		select: {
			id: true,
			name: true,
			columns: {
				orderBy: { position: "asc" },
				select: {
					id: true,
					name: true,
					role: true,
					cards: {
						select: {
							id: true,
							number: true,
							title: true,
							priority: true,
							updatedAt: true,
							lastEditedBy: true,
							relationsTo: { where: { type: "blocks" }, select: { id: true } },
						},
					},
				},
			},
		},
	});
	if (!board) return null;

	const allCards = board.columns.flatMap((col) => col.cards.map((card) => ({ card, column: col })));

	const counts = {
		in_progress: 0,
		review: 0,
		up_next: 0,
		backlog: 0,
		blocked: 0,
		stale_in_progress: 0,
	};
	const inProgressCards: ApiStateInProgressCard[] = [];

	for (const { card, column } of allCards) {
		if (hasRole(column, "active")) {
			counts.in_progress++;
			inProgressCards.push({
				ref: `#${card.number}`,
				title: card.title,
				priority: card.priority,
				lastSignalAt: card.updatedAt.toISOString(),
				lastEditedBy: card.lastEditedBy,
			});
		} else if (hasRole(column, "review")) counts.review++;
		else if (hasRole(column, "todo")) counts.up_next++;
		else if (hasRole(column, "backlog")) counts.backlog++;
		if (card.relationsTo.length > 0 && !hasRole(column, "done")) counts.blocked++;
	}

	const [staleMap, recentActivity, lastHandoff] = await Promise.all([
		findStaleInProgress(db, boardId),
		db.activity.findMany({
			where: { card: { column: { boardId } } },
			orderBy: { createdAt: "desc" },
			take: activityLimit,
			select: {
				createdAt: true,
				actorName: true,
				action: true,
				intent: true,
				card: { select: { number: true } },
			},
		}),
		getLatestHandoff(db, boardId),
	]);

	counts.stale_in_progress = staleMap.size;

	return {
		id: board.id,
		name: board.name,
		counts,
		in_progress: inProgressCards,
		recent_activity: recentActivity.map((a) => ({
			at: a.createdAt.toISOString(),
			actor: a.actorName,
			ref: a.card ? `#${a.card.number}` : null,
			action: a.action,
			intent: a.intent,
		})),
		last_handoff_at: lastHandoff?.createdAt.toISOString() ?? null,
	};
}

export async function buildApiState(
	activityLimit = DEFAULT_GLOBAL_ACTIVITY_LIMIT
): Promise<ApiState> {
	const projects = await db.project.findMany({
		select: { id: true, slug: true, name: true, boards: { select: { id: true } } },
		orderBy: [{ favorite: "desc" }, { name: "asc" }],
	});

	const projectStates: ApiStateProject[] = await Promise.all(
		projects.map(async (project) => {
			const boards = await Promise.all(
				project.boards.map((b) => buildBoardState(b.id, activityLimit))
			);
			return {
				id: project.id,
				slug: project.slug,
				name: project.name,
				boards: boards.filter((b): b is ApiStateBoard => b !== null),
			};
		})
	);

	return {
		generated_at: new Date().toISOString(),
		schema_version: API_STATE_SCHEMA_VERSION,
		projects: projectStates,
	};
}

export async function buildApiStateForBoard(
	boardId: string,
	activityLimit = DEFAULT_BOARD_ACTIVITY_LIMIT
): Promise<ApiState | null> {
	const board = await buildBoardState(boardId, activityLimit);
	if (!board) return null;

	const project = await db.project.findFirst({
		where: { boards: { some: { id: boardId } } },
		select: { id: true, slug: true, name: true },
	});
	if (!project) return null;

	return {
		generated_at: new Date().toISOString(),
		schema_version: API_STATE_SCHEMA_VERSION,
		projects: [
			{
				id: project.id,
				slug: project.slug,
				name: project.name,
				boards: [board],
			},
		],
	};
}
