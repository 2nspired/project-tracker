/**
 * In-memory event bus for real-time board updates via SSE.
 * Bridges tRPC mutations (instant) and MCP changes (detected via polling).
 */

import "server-only";
import { EventEmitter } from "node:events";
import { db } from "@/server/db";

// ── Event Types ─────────────────────────────────────────────────────

export interface BoardEvent {
	boardId: string;
	type: "board:changed" | "card:changed" | "activity:new" | "tag:changed" | "milestone:changed";
	entityId?: string;
	// Project-scoped events (tag, milestone) carry projectId so listeners
	// can scope their invalidations correctly. Tags/milestones are
	// project-scoped, not board-scoped, so a single project mutation fans
	// out as one BoardEvent per board in that project.
	projectId?: string;
}

// ── Event Bus Singleton (survives HMR) ──────────────────────────────

const g = globalThis as unknown as { __boardEventBus?: EventEmitter };
if (!g.__boardEventBus) {
	g.__boardEventBus = new EventEmitter();
}
export const eventBus = g.__boardEventBus;
eventBus.setMaxListeners(100);

export function emitBoardEvent(boardId: string, type: BoardEvent["type"], entityId?: string) {
	eventBus.emit("board-event", { boardId, type, entityId } satisfies BoardEvent);
}

// ── BoardId Resolution Helpers ──────────────────────────────────────

async function boardIdForColumn(columnId: string): Promise<string | null> {
	try {
		const col = await db.column.findUnique({
			where: { id: columnId },
			select: { boardId: true },
		});
		return col?.boardId ?? null;
	} catch {
		return null;
	}
}

async function boardIdForCard(cardId: string): Promise<string | null> {
	try {
		const card = await db.card.findUnique({
			where: { id: cardId },
			select: { column: { select: { boardId: true } } },
		});
		return card?.column.boardId ?? null;
	} catch {
		return null;
	}
}

// ── Fire-and-Forget Emit Helpers ────────────────────────────────────

/** Emit card:changed — resolves boardId from card's column */
export function emitCardChanged(cardId: string) {
	void boardIdForCard(cardId).then((bid) => {
		if (bid) emitBoardEvent(bid, "card:changed", cardId);
	});
}

/** Emit card:changed — resolves boardId from columnId (use when cardId unavailable) */
export function emitCardChangedViaColumn(columnId: string) {
	void boardIdForColumn(columnId).then((bid) => {
		if (bid) emitBoardEvent(bid, "card:changed");
	});
}

/** Emit board:changed — resolves boardId from column */
export function emitColumnChanged(columnId: string) {
	void boardIdForColumn(columnId).then((bid) => {
		if (bid) emitBoardEvent(bid, "board:changed", columnId);
	});
}

async function boardsForProject(projectId: string): Promise<string[]> {
	try {
		const boards = await db.board.findMany({ where: { projectId }, select: { id: true } });
		return boards.map((b) => b.id);
	} catch {
		return [];
	}
}

// Project-scoped fan-out: tags and milestones live on Project, not Board, so
// a single mutation needs to notify every board in the project. Emits one
// BoardEvent per board with the projectId attached so listeners can
// invalidate `tag.list({ projectId })` / `milestone.list({ projectId })`.
function emitProjectEvent(
	projectId: string,
	type: "tag:changed" | "milestone:changed",
	entityId?: string
) {
	void boardsForProject(projectId).then((boardIds) => {
		for (const boardId of boardIds) {
			eventBus.emit("board-event", { boardId, type, entityId, projectId } satisfies BoardEvent);
		}
	});
}

export function emitTagChanged(projectId: string, tagId?: string) {
	emitProjectEvent(projectId, "tag:changed", tagId);
}

export function emitMilestoneChanged(projectId: string, milestoneId?: string) {
	emitProjectEvent(projectId, "milestone:changed", milestoneId);
}
