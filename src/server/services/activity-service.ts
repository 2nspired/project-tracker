import type { Activity } from "prisma/generated/client";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

async function listByCard(cardId: string): Promise<ServiceResult<Activity[]>> {
	try {
		const activities = await db.activity.findMany({
			where: { cardId },
			orderBy: { createdAt: "desc" },
		});
		return { success: true, data: activities };
	} catch (error) {
		console.error("[ACTIVITY_SERVICE] listByCard error:", error);
		return {
			success: false,
			error: { code: "LIST_FAILED", message: "Failed to fetch activities." },
		};
	}
}

async function listByBoard(
	boardId: string,
	limit = 30
): Promise<
	ServiceResult<Array<Activity & { card: { id: string; number: number; title: string } }>>
> {
	try {
		const activities = await db.activity.findMany({
			where: {
				card: { column: { boardId } },
			},
			include: {
				card: { select: { id: true, number: true, title: true } },
			},
			orderBy: { createdAt: "desc" },
			take: limit,
		});
		return { success: true, data: activities };
	} catch (error) {
		console.error("[ACTIVITY_SERVICE] listByBoard error:", error);
		return {
			success: false,
			error: { code: "LIST_FAILED", message: "Failed to fetch activities." },
		};
	}
}

async function log(data: {
	cardId: string;
	action: string;
	details?: string;
	actorType: string;
	actorName?: string;
}): Promise<void> {
	try {
		await db.activity.create({ data });
	} catch (error) {
		console.error("[ACTIVITY_SERVICE] log error:", error);
	}
}

export type FlowMetrics = {
	/**
	 * Cards completed per day over the last 7 calendar days, bucketed by **UTC**
	 * day. `index 0` = the UTC day starting 6 days before today's UTC day;
	 * `index 6` = today's UTC day (00:00 UTC → 24:00 UTC).
	 *
	 * Buckets are anchored to UTC midnight (not a rolling 168-hour window) so
	 * the rightmost bar always represents a stable calendar day instead of
	 * shifting with the time of page load. UTC is chosen because there is no
	 * project-wide timezone configured; using UTC keeps bucket math identical
	 * across hosts and across server/client renders, and aligns this series
	 * with `tokenUsageService.getDailyCostSeries` so the Pulse strip's two
	 * sparklines render on identical x-axes.
	 */
	throughput: number[];
	/** Cards moved rightward (progress) in the last 7 days */
	forwardMoves: number;
	/** Cards moved leftward (regressions) in the last 7 days */
	backwardMoves: number;
	/** Column with the longest average dwell time */
	bottleneck: { column: string; avgHours: number } | null;
	/** Cards completed in the prior 7-day window (days 8–14 ago) — used for WoW delta */
	previousWeekCompleted: number;
};

async function getFlowMetrics(boardId: string): Promise<ServiceResult<FlowMetrics>> {
	try {
		// Anchor the 7-day throughput window at UTC midnight so buckets line up
		// with calendar days. Mirrors `tokenUsageService.getDailyCostSeries` (#203)
		// so the Pulse strip's cost + throughput sparklines stay on the same
		// x-axis. `Date.UTC` returns ms since epoch for midnight UTC of the
		// given y/m/d, so this is independent of the host's local TZ.
		const now = new Date();
		const todayUtcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
		const sevenDaysAgo = new Date(todayUtcMidnightMs - 6 * 24 * 60 * 60 * 1000);

		// Get column positions for determining forward/backward moves
		const columns = await db.column.findMany({
			where: { boardId },
			select: { name: true, position: true, role: true },
			orderBy: { position: "asc" },
		});
		const columnPositionMap = new Map(columns.map((c) => [c.name, c.position]));

		// Get all activities for this board in the last 7 days
		const activities = await db.activity.findMany({
			where: {
				card: { column: { boardId } },
				createdAt: { gte: sevenDaysAgo },
			},
			orderBy: { createdAt: "asc" },
		});

		// Also get activities for cards that are currently on this board
		// but may have been moved FROM other boards (rare but handles it)
		const cardIds = await db.card.findMany({
			where: { column: { boardId } },
			select: { id: true },
		});
		const _boardCardIds = new Set(cardIds.map((c) => c.id));

		// Throughput: count cards that arrived in "done" columns per day
		const doneColumnNames = new Set(columns.filter((c) => c.role === "done").map((c) => c.name));

		const throughput = new Array<number>(7).fill(0);
		let forwardMoves = 0;
		let backwardMoves = 0;

		// Track column dwell times for bottleneck detection
		// We use move events to compute how long cards spent in source columns
		const dwellTimes = new Map<string, number[]>(); // column name -> durations in ms

		for (const activity of activities) {
			if (activity.action === "moved" && activity.details) {
				const match = activity.details.match(/Moved from "(.+?)" to "(.+?)"/);
				if (match) {
					const fromCol = match[1];
					const toCol = match[2];
					const fromPos = columnPositionMap.get(fromCol);
					const toPos = columnPositionMap.get(toCol);

					if (fromPos !== undefined && toPos !== undefined) {
						if (toPos > fromPos) forwardMoves++;
						else if (toPos < fromPos) backwardMoves++;
					}

					// Count completions per day
					if (doneColumnNames.has(toCol)) {
						const dayIndex = Math.floor(
							(activity.createdAt.getTime() - sevenDaysAgo.getTime()) / (24 * 60 * 60 * 1000)
						);
						if (dayIndex >= 0 && dayIndex < 7) {
							throughput[dayIndex]++;
						}
					}
				}
			}
		}

		// Compute bottleneck from move events:
		// For each "moved from X" event, look at the previous "moved to X" event
		// for the same card to compute dwell time
		const cardLastArrivedAt = new Map<string, { column: string; time: number }>();

		for (const activity of activities) {
			if (activity.action === "moved" && activity.details) {
				const match = activity.details.match(/Moved from "(.+?)" to "(.+?)"/);
				if (match) {
					const fromCol = match[1];
					const toCol = match[2];

					// Record dwell time in the source column
					const lastArrival = cardLastArrivedAt.get(activity.cardId);
					if (lastArrival && lastArrival.column === fromCol) {
						const dwell = activity.createdAt.getTime() - lastArrival.time;
						if (!dwellTimes.has(fromCol)) dwellTimes.set(fromCol, []);
						dwellTimes.get(fromCol)?.push(dwell);
					}

					// Record arrival in the destination column
					cardLastArrivedAt.set(activity.cardId, {
						column: toCol,
						time: activity.createdAt.getTime(),
					});
				}
			}
		}

		// Find bottleneck (exclude done/parking columns)
		let bottleneck: { column: string; avgHours: number } | null = null;
		let maxAvg = 0;

		for (const [col, durations] of dwellTimes) {
			if (doneColumnNames.has(col)) continue;
			const parkingCols = columns.filter((c) => c.role === "parking").map((c) => c.name);
			if (parkingCols.includes(col)) continue;

			const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
			const avgHours = Math.round((avg / (1000 * 60 * 60)) * 10) / 10;
			if (avgHours > maxAvg) {
				maxAvg = avgHours;
				bottleneck = { column: col, avgHours };
			}
		}

		// Previous-week completions for the WoW delta. Separate query to keep the
		// 7-day throughput/dwell logic above unchanged — extending the main
		// `activities` query to 14 days would shift dwell-time calculations by
		// including older arrivals. Anchor `fourteenDaysAgo` off `sevenDaysAgo`
		// so the prior-week window is a clean calendar 7-day span (UTC midnight
		// boundaries on both ends), matching the throughput series above.
		const fourteenDaysAgo = new Date(sevenDaysAgo.getTime() - 7 * 24 * 60 * 60 * 1000);
		const priorWeekActivities = await db.activity.findMany({
			where: {
				card: { column: { boardId } },
				action: "moved",
				createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
			},
			select: { details: true },
		});
		let previousWeekCompleted = 0;
		for (const activity of priorWeekActivities) {
			if (!activity.details) continue;
			const match = activity.details.match(/Moved from "(.+?)" to "(.+?)"/);
			if (match && doneColumnNames.has(match[2])) previousWeekCompleted++;
		}

		return {
			success: true,
			data: { throughput, forwardMoves, backwardMoves, bottleneck, previousWeekCompleted },
		};
	} catch (error) {
		console.error("[ACTIVITY_SERVICE] getFlowMetrics error:", error);
		return {
			success: false,
			error: { code: "METRICS_FAILED", message: "Failed to compute flow metrics." },
		};
	}
}

export const activityService = {
	listByCard,
	listByBoard,
	getFlowMetrics,
	log,
};
