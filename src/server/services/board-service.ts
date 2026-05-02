import type { Board } from "prisma/generated/client";
import type { CreateBoardInput, UpdateBoardInput } from "@/lib/schemas/board-schemas";
import { db } from "@/server/db";
import { findStaleInProgress } from "@/server/services/stale-cards";
import type { ServiceResult } from "@/server/services/types/service-result";

const DEFAULT_COLUMNS = [
	{
		name: "Backlog",
		description:
			"Known work. Drag the most important to the top — top 3 surface as 'pinned' in briefMe.",
		position: 0,
		role: "backlog",
		isParking: false,
	},
	{
		name: "In Progress",
		description: "This is actively being worked on",
		position: 1,
		role: "active",
		isParking: false,
	},
	{
		name: "Done",
		description: "This has been completed",
		position: 2,
		role: "done",
		isParking: false,
	},
	{
		name: "Parking Lot",
		description: "Ideas and items to revisit later",
		position: 3,
		role: "parking",
		isParking: true,
	},
];

type BoardListItem = Board & {
	columns: Array<{
		id: string;
		name: string;
		role: string | null;
		isParking: boolean;
		_count: { cards: number };
	}>;
	_count: { columns: number };
};

async function list(projectId: string): Promise<ServiceResult<BoardListItem[]>> {
	try {
		const boards = await db.board.findMany({
			where: { projectId },
			orderBy: { createdAt: "desc" },
			include: {
				columns: {
					orderBy: { position: "asc" },
					select: {
						id: true,
						name: true,
						role: true,
						isParking: true,
						_count: { select: { cards: true } },
					},
				},
				_count: { select: { columns: true } },
			},
		});
		return { success: true, data: boards };
	} catch (error) {
		console.error("[BOARD_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to fetch boards." } };
	}
}

async function getById(boardId: string): Promise<ServiceResult<Board>> {
	try {
		const board = await db.board.findUnique({ where: { id: boardId } });
		if (!board) {
			return { success: false, error: { code: "NOT_FOUND", message: "Board not found." } };
		}
		return { success: true, data: board };
	} catch (error) {
		console.error("[BOARD_SERVICE] getById error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch board." } };
	}
}

async function getFullBoardData(boardId: string) {
	return db.board.findUnique({
		where: { id: boardId },
		include: {
			project: true,
			columns: {
				orderBy: { position: "asc" },
				include: {
					cards: {
						orderBy: { position: "asc" },
						include: {
							checklists: { orderBy: { position: "asc" } },
							milestone: { select: { id: true, name: true, targetDate: true } },
							relationsTo: { where: { type: "blocks" }, select: { id: true } },
							cardTags: { include: { tag: { select: { label: true } } } },
							_count: { select: { comments: true } },
						},
					},
				},
			},
		},
	});
}

type FullBoardRaw = NonNullable<Awaited<ReturnType<typeof getFullBoardData>>>;
type FullBoardRawCard = FullBoardRaw["columns"][number]["cards"][number];
// `tags` is projected from the CardTag join into a plain string[] on the API
// surface; consumers don't see the junction rows directly. The cardTags
// property is dropped from the output to keep the shape lean.
type FullBoardCard = Omit<FullBoardRawCard, "cardTags"> & {
	tags: string[];
	stale?: { days: number; lastSignalAt: string };
};
type FullBoardWithStale = Omit<FullBoardRaw, "columns"> & {
	columns: Array<
		Omit<FullBoardRaw["columns"][number], "cards"> & {
			cards: FullBoardCard[];
		}
	>;
};

async function getFull(boardId: string): Promise<ServiceResult<FullBoardWithStale>> {
	try {
		const board = await getFullBoardData(boardId);
		if (!board) {
			return { success: false, error: { code: "NOT_FOUND", message: "Board not found." } };
		}

		const staleMap = await findStaleInProgress(db, boardId);
		const enriched: FullBoardWithStale = {
			...board,
			columns: board.columns.map((col) => ({
				...col,
				cards: col.cards.map(({ cardTags, ...card }) => {
					const tags = cardTags.map((ct) => ct.tag.label);
					const info = staleMap.get(card.id);
					return info
						? {
								...card,
								tags,
								stale: { days: info.days, lastSignalAt: info.lastSignalAt.toISOString() },
							}
						: { ...card, tags };
				}),
			})),
		};
		return { success: true, data: enriched };
	} catch (error) {
		console.error("[BOARD_SERVICE] getFull error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch board." } };
	}
}

async function create(data: CreateBoardInput): Promise<ServiceResult<Board>> {
	try {
		const board = await db.board.create({
			data: {
				projectId: data.projectId,
				name: data.name,
				description: data.description,
				columns: {
					create: DEFAULT_COLUMNS,
				},
			},
		});
		return { success: true, data: board };
	} catch (error) {
		console.error("[BOARD_SERVICE] create error:", error);
		return { success: false, error: { code: "CREATE_FAILED", message: "Failed to create board." } };
	}
}

async function update(boardId: string, data: UpdateBoardInput): Promise<ServiceResult<Board>> {
	try {
		const existing = await db.board.findUnique({ where: { id: boardId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Board not found." } };
		}

		const board = await db.board.update({
			where: { id: boardId },
			data,
		});
		return { success: true, data: board };
	} catch (error) {
		console.error("[BOARD_SERVICE] update error:", error);
		return { success: false, error: { code: "UPDATE_FAILED", message: "Failed to update board." } };
	}
}

async function deleteBoard(boardId: string): Promise<ServiceResult<Board>> {
	try {
		const existing = await db.board.findUnique({ where: { id: boardId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Board not found." } };
		}

		const board = await db.board.delete({ where: { id: boardId } });
		return { success: true, data: board };
	} catch (error) {
		console.error("[BOARD_SERVICE] delete error:", error);
		return { success: false, error: { code: "DELETE_FAILED", message: "Failed to delete board." } };
	}
}

export const boardService = {
	list,
	getById,
	getFull,
	create,
	update,
	delete: deleteBoard,
};
