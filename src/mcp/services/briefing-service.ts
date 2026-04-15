import { hasRole } from "../../lib/column-roles.js";
import { computeWorkNextScore } from "../../lib/work-next-score.js";
import { db } from "../db.js";
import { checkStaleness, formatStalenessWarnings } from "../staleness.js";
import { computeBoardDiff, type BoardDiff } from "./board-diff.js";

// ─── Types ──────���─────────────────────────────��───────────────────

export type BoardBriefing = {
	board: { id: string; name: string; project: { id: string; name: string } };
	handoff: HandoffSection | null;
	changes: BoardDiff | null;
	workNext: WorkNextCandidate[];
	attention: AttentionSection;
	pulse: PulseSection;
};

type HandoffSection = {
	agentName: string;
	summary: string;
	workingOn: string[];
	nextSteps: string[];
	blockers: string[];
	age: string;
	createdAt: Date;
};

type WorkNextCandidate = {
	ref: string;
	title: string;
	priority: string;
	descriptionPreview: string | null;
	column: string;
	checklistProgress: string | null;
	blockedBy: number;
	blocksOther: number;
	score: number;
};

type AttentionSection = {
	stalenessWarnings: string | null;
	openDecisions: Array<{ id: string; title: string; cardRef: string | null }>;
	blockedCards: Array<{ ref: string; title: string; column: string }>;
};

type PulseSection = {
	columns: Array<{ name: string; count: number }>;
	throughput7d: number;
	bottleneck: { column: string; avgHours: number } | null;
};

// ─── Helpers ──────────────────────────────────────────────────────

function safeParseArray(json: string): string[] {
	try {
		return JSON.parse(json) as string[];
	} catch {
		return [];
	}
}

function formatRelativeAge(date: Date): string {
	const ms = Date.now() - date.getTime();
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	return `${weeks}wk ago`;
}

// ─── Core ─��────────────────��──────────────────────────────────────

export async function computeBriefing(boardId: string): Promise<BoardBriefing | null> {
	const board = await db.board.findUnique({
		where: { id: boardId },
		select: {
			id: true,
			name: true,
			project: { select: { id: true, name: true } },
		},
	});
	if (!board) return null;

	const projectId = board.project.id;

	// Fetch handoff first (changes depend on its timestamp)
	const handoff = await fetchHandoff(boardId);

	// Parallel fetch for everything else
	const [changes, workNext, attention, pulse] = await Promise.all([
		fetchChanges(boardId, handoff?.createdAt ?? null),
		fetchWorkNext(boardId),
		fetchAttention(boardId, projectId),
		fetchPulse(boardId),
	]);

	return {
		board: { id: board.id, name: board.name, project: board.project },
		handoff,
		changes,
		workNext,
		attention,
		pulse,
	};
}

// ─── Handoff ──────────────────────────────────────────────────────

async function fetchHandoff(boardId: string): Promise<HandoffSection | null> {
	const handoff = await db.sessionHandoff.findFirst({
		where: { boardId },
		orderBy: { createdAt: "desc" },
	});
	if (!handoff) return null;

	return {
		agentName: handoff.agentName,
		summary: handoff.summary,
		workingOn: safeParseArray(handoff.workingOn),
		nextSteps: safeParseArray(handoff.nextSteps),
		blockers: safeParseArray(handoff.blockers),
		age: formatRelativeAge(handoff.createdAt),
		createdAt: handoff.createdAt,
	};
}

// ─── Changes ─��────────────────────────────────────────────────��───

async function fetchChanges(boardId: string, handoffTime: Date | null): Promise<BoardDiff | null> {
	// If no handoff, show changes from last 24h as a reasonable default
	const since = handoffTime ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
	return computeBoardDiff(boardId, since);
}

// ─── Work Next ──────────────────────────────��─────────────────────

async function fetchWorkNext(boardId: string): Promise<WorkNextCandidate[]> {
	const columns = await db.column.findMany({
		where: { boardId },
		orderBy: { position: "asc" },
		include: {
			cards: {
				orderBy: { position: "asc" },
				take: 20,
				include: {
					checklists: { select: { completed: true } },
					relationsTo: { where: { type: "blocks" }, select: { id: true } },
					relationsFrom: { where: { type: "blocks" }, select: { id: true } },
				},
			},
		},
	});

	// Only score cards in active columns (not done/parking)
	const activeColumns = columns.filter(
		(col) => !hasRole(col, "done") && !hasRole(col, "parking"),
	);

	const scored = activeColumns
		.flatMap((col) =>
			col.cards.map((card) => {
				const total = card.checklists.length;
				const done = card.checklists.filter((c) => c.completed).length;

				return {
					ref: `#${card.number}`,
					title: card.title,
					priority: card.priority,
					descriptionPreview: card.description ? card.description.slice(0, 200) : null,
					column: col.name,
					checklistProgress: total > 0 ? `${done}/${total}` : null,
					blockedBy: card.relationsTo.length,
					blocksOther: card.relationsFrom.length,
					score: computeWorkNextScore({
						priority: card.priority,
						updatedAt: card.updatedAt,
						dueDate: card.dueDate,
						checklists: card.checklists,
						_blockedByCount: card.relationsTo.length,
						_blocksOtherCount: card.relationsFrom.length,
					}),
				};
			}),
		)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);

	return scored;
}

// ─── Attention ────────────────────────────────────────────────────

async function fetchAttention(boardId: string, projectId: string): Promise<AttentionSection> {
	const [warnings, openDecisions, blockedCards] = await Promise.all([
		checkStaleness(projectId).then(formatStalenessWarnings),

		db.decision.findMany({
			where: { projectId, status: "proposed" },
			select: {
				id: true,
				title: true,
				card: { select: { number: true } },
			},
			orderBy: { createdAt: "desc" },
			take: 5,
		}),

		db.card.findMany({
			where: {
				column: { boardId },
				relationsTo: { some: { type: "blocks" } },
			},
			select: {
				number: true,
				title: true,
				column: { select: { name: true } },
			},
			orderBy: { updatedAt: "desc" },
			take: 10,
		}),
	]);

	return {
		stalenessWarnings: warnings,
		openDecisions: openDecisions.map((d) => ({
			id: d.id,
			title: d.title,
			cardRef: d.card ? `#${d.card.number}` : null,
		})),
		blockedCards: blockedCards.map((c) => ({
			ref: `#${c.number}`,
			title: c.title,
			column: c.column.name,
		})),
	};
}

// ─── Pulse ──────────────��──────────────────────────────��──────────

async function fetchPulse(boardId: string): Promise<PulseSection> {
	const columns = await db.column.findMany({
		where: { boardId },
		orderBy: { position: "asc" },
		select: {
			name: true,
			role: true,
			_count: { select: { cards: true } },
		},
	});

	const columnCounts = columns.map((c) => ({ name: c.name, count: c._count.cards }));

	// Simplified flow metrics: 7-day throughput + bottleneck
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const doneColumnNames = new Set(
		columns.filter((c) => hasRole(c, "done")).map((c) => c.name),
	);
	const parkingColNames = new Set(
		columns.filter((c) => hasRole(c, "parking")).map((c) => c.name),
	);

	// Use nested relation filter to avoid materializing cardIds (avoids SQLite variable limit)
	const recentMoves = await db.activity.findMany({
		where: {
			card: { column: { boardId } },
			action: "moved",
			createdAt: { gte: sevenDaysAgo },
		},
		select: { details: true, cardId: true, createdAt: true },
		orderBy: { createdAt: "asc" },
	});

	let throughput7d = 0;
	const dwellTimes = new Map<string, number[]>();
	const cardLastArrivedAt = new Map<string, { column: string; time: number }>();

	for (const activity of recentMoves) {
		if (!activity.details) continue;
		const match = activity.details.match(/Moved from "(.+?)" to "(.+?)"/);
		if (!match) continue;
		const [, fromCol, toCol] = match;

		if (doneColumnNames.has(toCol)) throughput7d++;

		const lastArrival = cardLastArrivedAt.get(activity.cardId);
		if (lastArrival?.column === fromCol) {
			const dwell = activity.createdAt.getTime() - lastArrival.time;
			if (!dwellTimes.has(fromCol)) dwellTimes.set(fromCol, []);
			dwellTimes.get(fromCol)!.push(dwell);
		}
		cardLastArrivedAt.set(activity.cardId, {
			column: toCol,
			time: activity.createdAt.getTime(),
		});
	}

	let bottleneck: PulseSection["bottleneck"] = null;
	let maxAvg = 0;
	for (const [col, durations] of dwellTimes) {
		if (doneColumnNames.has(col) || parkingColNames.has(col)) continue;

		const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
		const avgHours = Math.round((avg / (1000 * 60 * 60)) * 10) / 10;
		if (avgHours > maxAvg) {
			maxAvg = avgHours;
			bottleneck = { column: col, avgHours };
		}
	}

	return { columns: columnCounts, throughput7d, bottleneck };
}
