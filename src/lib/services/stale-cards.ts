/**
 * Shared stale-in-progress detection.
 *
 * Both the Next.js web server (`api-state`, `board-service`, `card-service`,
 * `brief-payload-service`) and the MCP process (`src/mcp/tools/query-tools.ts`)
 * need the same staleness sweep over `active`-role columns. Each process owns
 * its own `PrismaClient`, so this module accepts `db: PrismaClient` as a
 * parameter rather than importing a singleton — mirrors the
 * `src/lib/services/staleness.ts` pattern and satisfies the v6.2 decision
 * that `src/server/` and `src/mcp/` never import from each other (a5a4cde6).
 *
 * Detection: cards in `active`-role columns whose last signal is older than
 * the board's `staleInProgressDays` threshold. Signals are taken from
 * card.updatedAt + the latest activity / comment / git-link / checklist
 * mutation, because Prisma's `@updatedAt` only fires on direct Card writes.
 */

import type { PrismaClient } from "prisma/generated/client";
import { hasRole } from "@/lib/column-roles";

export type StaleCardInfo = {
	days: number;
	lastSignalAt: Date;
};

export type StaleCardEntry = StaleCardInfo & {
	cardId: string;
	number: number;
	title: string;
};

/**
 * Detect cards in `active`-role columns whose last signal is older than
 * the board's `staleInProgressDays` threshold (or `thresholdOverride` if
 * passed). Signals: card.updatedAt, latest activity, latest comment, latest
 * git link, latest checklist mutation. Multi-signal coverage matters because
 * Prisma's `@updatedAt` only fires on direct Card updates — comments,
 * checklist toggles, and commits arrive on related rows.
 *
 * Returns an empty map when the threshold is null (check disabled) or no
 * cards qualify. Designed to run on every read (briefMe, getBoard, audit) —
 * no background job, no caching.
 */
export async function findStaleInProgress(
	db: PrismaClient,
	boardId: string,
	thresholdOverride?: number | null
): Promise<Map<string, StaleCardInfo>> {
	const board = await db.board.findUnique({
		where: { id: boardId },
		select: { staleInProgressDays: true },
	});
	if (!board) return new Map();

	const threshold = thresholdOverride !== undefined ? thresholdOverride : board.staleInProgressDays;
	if (threshold === null || threshold <= 0) return new Map();

	const columns = await db.column.findMany({
		where: { boardId },
		select: { id: true, name: true, role: true },
	});
	const activeColumnIds = columns.filter((c) => hasRole(c, "active")).map((c) => c.id);
	if (activeColumnIds.length === 0) return new Map();

	const cards = await db.card.findMany({
		where: { columnId: { in: activeColumnIds } },
		select: { id: true, updatedAt: true },
	});
	if (cards.length === 0) return new Map();

	const cardIds = cards.map((c) => c.id);

	const [activityMax, commentMax, gitLinkMax, checklistMax] = await Promise.all([
		db.activity.groupBy({
			by: ["cardId"],
			where: { cardId: { in: cardIds } },
			_max: { createdAt: true },
		}),
		db.comment.groupBy({
			by: ["cardId"],
			where: { cardId: { in: cardIds } },
			_max: { createdAt: true },
		}),
		db.gitLink.groupBy({
			by: ["cardId"],
			where: { cardId: { in: cardIds } },
			_max: { commitDate: true },
		}),
		db.checklistItem.groupBy({
			by: ["cardId"],
			where: { cardId: { in: cardIds } },
			_max: { updatedAt: true },
		}),
	]);

	const maxByCard = (
		rows: Array<{
			cardId: string;
			_max: { createdAt?: Date | null; updatedAt?: Date | null; commitDate?: Date | null };
		}>,
		field: "createdAt" | "updatedAt" | "commitDate"
	): Map<string, Date> => {
		const m = new Map<string, Date>();
		for (const row of rows) {
			const v = row._max[field];
			if (v) m.set(row.cardId, v);
		}
		return m;
	};

	const activityByCard = maxByCard(activityMax, "createdAt");
	const commentByCard = maxByCard(commentMax, "createdAt");
	const gitByCard = maxByCard(gitLinkMax, "commitDate");
	const checklistByCard = maxByCard(checklistMax, "updatedAt");

	const cutoffMs = Date.now() - threshold * 24 * 60 * 60 * 1000;
	const out = new Map<string, StaleCardInfo>();

	for (const card of cards) {
		const candidates: Date[] = [card.updatedAt];
		const a = activityByCard.get(card.id);
		const c = commentByCard.get(card.id);
		const g = gitByCard.get(card.id);
		const k = checklistByCard.get(card.id);
		if (a) candidates.push(a);
		if (c) candidates.push(c);
		if (g) candidates.push(g);
		if (k) candidates.push(k);

		const lastSignalAt = candidates.reduce((max, d) => (d > max ? d : max));
		if (lastSignalAt.getTime() <= cutoffMs) {
			const days = Math.floor((Date.now() - lastSignalAt.getTime()) / (1000 * 60 * 60 * 24));
			out.set(card.id, { days, lastSignalAt });
		}
	}

	return out;
}
