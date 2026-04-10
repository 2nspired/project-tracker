import type { SessionHandoff } from "prisma/generated/client";
import type { CreateHandoffInput } from "@/lib/schemas/handoff-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type ParsedHandoff = Omit<SessionHandoff, "workingOn" | "findings" | "nextSteps" | "blockers"> & {
	workingOn: string[];
	findings: string[];
	nextSteps: string[];
	blockers: string[];
};

type BoardDiff = {
	cardsMoved: Array<{ ref: string; title: string; from: string; to: string }>;
	cardsCreated: Array<{ ref: string; title: string; column: string }>;
	checklistProgress: Array<{ ref: string; title: string; completed: string }>;
	newComments: number;
	since: Date;
};

function parseHandoff(handoff: SessionHandoff): ParsedHandoff {
	return {
		...handoff,
		workingOn: JSON.parse(handoff.workingOn) as string[],
		findings: JSON.parse(handoff.findings) as string[],
		nextSteps: JSON.parse(handoff.nextSteps) as string[],
		blockers: JSON.parse(handoff.blockers) as string[],
	};
}

async function save(input: CreateHandoffInput): Promise<ServiceResult<SessionHandoff>> {
	try {
		const handoff = await db.sessionHandoff.create({
			data: {
				boardId: input.boardId,
				agentName: input.agentName,
				workingOn: JSON.stringify(input.workingOn),
				findings: JSON.stringify(input.findings),
				nextSteps: JSON.stringify(input.nextSteps),
				blockers: JSON.stringify(input.blockers),
				summary: input.summary,
			},
		});
		return { success: true, data: handoff };
	} catch (error) {
		console.error("[HANDOFF_SERVICE] save error:", error);
		return { success: false, error: { code: "SAVE_FAILED", message: "Failed to save handoff." } };
	}
}

async function getLatest(boardId: string): Promise<ServiceResult<ParsedHandoff | null>> {
	try {
		const handoff = await db.sessionHandoff.findFirst({
			where: { boardId },
			orderBy: { createdAt: "desc" },
		});
		return { success: true, data: handoff ? parseHandoff(handoff) : null };
	} catch (error) {
		console.error("[HANDOFF_SERVICE] getLatest error:", error);
		return { success: false, error: { code: "FETCH_FAILED", message: "Failed to fetch latest handoff." } };
	}
}

async function list(boardId: string, limit = 10): Promise<ServiceResult<ParsedHandoff[]>> {
	try {
		const handoffs = await db.sessionHandoff.findMany({
			where: { boardId },
			orderBy: { createdAt: "desc" },
			take: limit,
		});
		return { success: true, data: handoffs.map(parseHandoff) };
	} catch (error) {
		console.error("[HANDOFF_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to list handoffs." } };
	}
}

async function getBoardDiff(boardId: string, since: Date): Promise<ServiceResult<BoardDiff>> {
	try {
		// Get all card IDs for the board via Column join
		const columns = await db.column.findMany({
			where: { boardId },
			include: {
				cards: {
					select: { id: true, number: true, title: true },
				},
			},
		});

		const cardMap = new Map<string, { number: number; title: string }>();
		for (const col of columns) {
			for (const card of col.cards) {
				cardMap.set(card.id, { number: card.number, title: card.title });
			}
		}

		const cardIds = Array.from(cardMap.keys());

		// Get activities since the given time
		const activities = await db.activity.findMany({
			where: {
				cardId: { in: cardIds },
				createdAt: { gt: since },
			},
			orderBy: { createdAt: "desc" },
		});

		const cardsMoved: BoardDiff["cardsMoved"] = [];
		const cardsCreated: BoardDiff["cardsCreated"] = [];
		const checklistProgress: BoardDiff["checklistProgress"] = [];

		for (const activity of activities) {
			const card = cardMap.get(activity.cardId);
			if (!card) continue;

			const ref = `#${card.number}`;

			if (activity.action === "moved" && activity.details) {
				// Parse: Moved from "X" to "Y"
				const match = activity.details.match(/Moved from "(.+?)" to "(.+?)"/);
				if (match) {
					cardsMoved.push({ ref, title: card.title, from: match[1], to: match[2] });
				}
			} else if (activity.action === "created" && activity.details) {
				// Parse: Card #N "title" created in ColumnName
				const match = activity.details.match(/created in (.+?)$/);
				const column = match ? match[1] : "Unknown";
				cardsCreated.push({ ref, title: card.title, column });
			} else if (activity.action === "checklist_completed" && activity.details) {
				checklistProgress.push({ ref, title: card.title, completed: activity.details });
			}
		}

		// Count new comments since the given time
		const newComments = await db.comment.count({
			where: {
				cardId: { in: cardIds },
				createdAt: { gt: since },
			},
		});

		return {
			success: true,
			data: { cardsMoved, cardsCreated, checklistProgress, newComments, since },
		};
	} catch (error) {
		console.error("[HANDOFF_SERVICE] getBoardDiff error:", error);
		return { success: false, error: { code: "DIFF_FAILED", message: "Failed to compute board diff." } };
	}
}

export const handoffService = {
	save,
	getLatest,
	list,
	getBoardDiff,
};
