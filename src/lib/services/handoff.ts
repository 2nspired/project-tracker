/**
 * Shared handoff (session continuity) logic.
 *
 * Post-cutover (commits 5–6 of docs/IMPL-NOTE-CLAIM-CUTOVER.md)
 * handoffs round-trip through Note(kind="handoff"). The legacy
 * SessionHandoff table is left in place until commit 8 drops it.
 */

import type { Note, PrismaClient } from "prisma/generated/client";

export type ParsedHandoff = {
	id: string;
	boardId: string | null;
	agentName: string;
	summary: string;
	workingOn: string[];
	findings: string[];
	nextSteps: string[];
	blockers: string[];
	createdAt: Date;
	updatedAt: Date;
};

type HandoffMetadata = {
	workingOn?: string[];
	findings?: string[];
	nextSteps?: string[];
	blockers?: string[];
};

export function parseHandoff(note: Note): ParsedHandoff {
	const metadata = JSON.parse(note.metadata || "{}") as HandoffMetadata;
	return {
		id: note.id,
		boardId: note.boardId,
		agentName: note.author,
		summary: note.content,
		workingOn: metadata.workingOn ?? [],
		findings: metadata.findings ?? [],
		nextSteps: metadata.nextSteps ?? [],
		blockers: metadata.blockers ?? [],
		createdAt: note.createdAt,
		updatedAt: note.updatedAt,
	};
}

export async function saveHandoff(
	db: PrismaClient,
	input: {
		boardId: string;
		agentName: string;
		workingOn: string[];
		findings: string[];
		nextSteps: string[];
		blockers: string[];
		summary: string;
	}
): Promise<Note> {
	const board = await db.board.findUnique({
		where: { id: input.boardId },
		select: { projectId: true },
	});
	return db.note.create({
		data: {
			kind: "handoff",
			title: `Handoff by ${input.agentName}`,
			content: input.summary,
			author: input.agentName,
			boardId: input.boardId,
			projectId: board?.projectId ?? null,
			tags: "[]",
			metadata: JSON.stringify({
				workingOn: input.workingOn,
				findings: input.findings,
				nextSteps: input.nextSteps,
				blockers: input.blockers,
			}),
		},
	});
}

export async function getLatestHandoff(db: PrismaClient, boardId: string): Promise<Note | null> {
	return db.note.findFirst({
		where: { kind: "handoff", boardId },
		orderBy: { createdAt: "desc" },
	});
}

export async function listHandoffs(db: PrismaClient, boardId: string, limit = 10): Promise<Note[]> {
	return db.note.findMany({
		where: { kind: "handoff", boardId },
		orderBy: { createdAt: "desc" },
		take: limit,
	});
}
