/**
 * Shared handoff (session continuity) logic.
 * Both the tRPC service and MCP tool delegate here.
 */

import type { PrismaClient, SessionHandoff } from "prisma/generated/client";

export type ParsedHandoff = Omit<SessionHandoff, "workingOn" | "findings" | "nextSteps" | "blockers"> & {
	workingOn: string[];
	findings: string[];
	nextSteps: string[];
	blockers: string[];
};

export function parseHandoff(handoff: SessionHandoff): ParsedHandoff {
	return {
		...handoff,
		workingOn: JSON.parse(handoff.workingOn) as string[],
		findings: JSON.parse(handoff.findings) as string[],
		nextSteps: JSON.parse(handoff.nextSteps) as string[],
		blockers: JSON.parse(handoff.blockers) as string[],
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
	},
): Promise<SessionHandoff> {
	return db.sessionHandoff.create({
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
}

export async function getLatestHandoff(
	db: PrismaClient,
	boardId: string,
): Promise<SessionHandoff | null> {
	return db.sessionHandoff.findFirst({
		where: { boardId },
		orderBy: { createdAt: "desc" },
	});
}

export async function listHandoffs(
	db: PrismaClient,
	boardId: string,
	limit = 10,
): Promise<SessionHandoff[]> {
	return db.sessionHandoff.findMany({
		where: { boardId },
		orderBy: { createdAt: "desc" },
		take: limit,
	});
}
