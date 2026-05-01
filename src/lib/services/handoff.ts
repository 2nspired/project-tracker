/**
 * Shared handoff (session continuity) logic.
 *
 * Handoffs live in their own `Handoff` table (#179 Phase 2, v6.0.0).
 * Append-only: saveHandoff inserts; readers query by board ordered by
 * createdAt DESC.
 */

import type { Handoff, PrismaClient } from "prisma/generated/client";

export type ParsedHandoff = {
	id: string;
	boardId: string;
	projectId: string;
	agentName: string;
	summary: string;
	workingOn: string[];
	findings: string[];
	nextSteps: string[];
	blockers: string[];
	createdAt: Date;
};

function parseJsonArray(raw: string): string[] {
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? (v as string[]) : [];
	} catch {
		return [];
	}
}

export function parseHandoff(row: Handoff): ParsedHandoff {
	return {
		id: row.id,
		boardId: row.boardId,
		projectId: row.projectId,
		agentName: row.agentName,
		summary: row.summary,
		workingOn: parseJsonArray(row.workingOn),
		findings: parseJsonArray(row.findings),
		nextSteps: parseJsonArray(row.nextSteps),
		blockers: parseJsonArray(row.blockers),
		createdAt: row.createdAt,
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
): Promise<Handoff> {
	const board = await db.board.findUnique({
		where: { id: input.boardId },
		select: { projectId: true },
	});
	if (!board) {
		throw new Error(`saveHandoff: board ${input.boardId} not found`);
	}
	return db.handoff.create({
		data: {
			boardId: input.boardId,
			projectId: board.projectId,
			agentName: input.agentName,
			summary: input.summary,
			workingOn: JSON.stringify(input.workingOn),
			findings: JSON.stringify(input.findings),
			nextSteps: JSON.stringify(input.nextSteps),
			blockers: JSON.stringify(input.blockers),
		},
	});
}

export async function getLatestHandoff(db: PrismaClient, boardId: string): Promise<Handoff | null> {
	return db.handoff.findFirst({
		where: { boardId },
		orderBy: { createdAt: "desc" },
	});
}

export async function listHandoffs(
	db: PrismaClient,
	boardId: string,
	limit = 10
): Promise<Handoff[]> {
	return db.handoff.findMany({
		where: { boardId },
		orderBy: { createdAt: "desc" },
		take: limit,
	});
}
