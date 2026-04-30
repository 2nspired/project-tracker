/**
 * Rolling briefMe history. Each call to the briefMe MCP tool persists its
 * payload here so the Session View can show the human what the agent saw
 * when it picked up. Stored as Note(kind="brief") — same pattern as handoffs.
 */

import type { Note, PrismaClient } from "prisma/generated/client";
import type { BoardDiff } from "@/lib/services/board-diff";
import type { PolicyError, TrackerPolicy } from "@/lib/services/tracker-policy";

const SNAPSHOT_KIND = "brief";
const DEFAULT_RETENTION = 20;

// Mirrors the briefPayload built in src/mcp/server.ts (briefMe handler).
// Optional fields are conditionally spread there, so they may be absent on
// any given snapshot. Older persisted snapshots predate fields added here —
// consumers must defend against missing keys.

export type BriefHandoff = {
	agentName: string;
	createdAt: string | Date;
	summary: string;
	nextSteps: string[];
	blockers: string[];
};

export type BriefTopWorkItem = {
	ref: string;
	title: string;
	column: string;
	priority: string;
	score: number;
	source: "active" | "pinned" | "scored";
};

export type BriefBlocker = {
	ref: string;
	title: string;
	blockedBy: string[];
};

export type BriefDecision = {
	id: string;
	title: string;
	card: string | null;
};

export type BriefTokenPulse = {
	totalCostUsd: number;
	sessionCount: number;
	trackingSince: string;
};

export type BriefStaleInProgress = {
	ref: string;
	title: string;
	days: number;
	lastSignalAt: string;
};

export type BriefResolvedFromCwd = {
	projectName: string;
	boardName: string;
	boardId: string;
};

export type BriefSnapshotPayload = {
	_serverVersion?: string;
	_brandDeprecation?: string;
	_versionMismatch?: string;
	_warnings?: string[];
	pulse: string;
	resolvedFromCwd?: BriefResolvedFromCwd;
	policy: TrackerPolicy | null;
	policy_error?: PolicyError;
	handoff: BriefHandoff | null;
	diff: BoardDiff | null;
	topWork: BriefTopWorkItem[];
	blockers: BriefBlocker[];
	recentDecisions: BriefDecision[];
	tokenPulse?: BriefTokenPulse;
	stale: string | null;
	staleInProgress?: BriefStaleInProgress[];
	intentReminder?: string;
	_hint?: string;
};

export type ParsedBriefSnapshot = {
	id: string;
	boardId: string | null;
	agentName: string;
	pulse: string;
	payload: BriefSnapshotPayload;
	createdAt: Date;
};

export function parseBriefSnapshot(note: Note): ParsedBriefSnapshot {
	let payload: BriefSnapshotPayload;
	try {
		payload = JSON.parse(note.metadata || "{}") as BriefSnapshotPayload;
	} catch {
		payload = {
			pulse: note.content,
			policy: null,
			handoff: null,
			diff: null,
			topWork: [],
			blockers: [],
			recentDecisions: [],
			stale: null,
		};
	}
	return {
		id: note.id,
		boardId: note.boardId,
		agentName: note.author,
		pulse: note.content,
		payload,
		createdAt: note.createdAt,
	};
}

export async function saveBriefSnapshot(
	db: PrismaClient,
	input: {
		boardId: string;
		agentName: string;
		pulse: string;
		payload: unknown;
	},
	retention = DEFAULT_RETENTION
): Promise<Note> {
	const board = await db.board.findUnique({
		where: { id: input.boardId },
		select: { projectId: true },
	});
	const note = await db.note.create({
		data: {
			kind: SNAPSHOT_KIND,
			title: `Brief by ${input.agentName}`,
			content: input.pulse,
			author: input.agentName,
			boardId: input.boardId,
			projectId: board?.projectId ?? null,
			tags: "[]",
			metadata: JSON.stringify(input.payload),
		},
	});

	// GC: keep the most recent `retention` per (board, kind="brief"). Any
	// older rows for this board are removed in one delete. Cheap because of
	// the [boardId, kind] index already on Note.
	const keep = await db.note.findMany({
		where: { boardId: input.boardId, kind: SNAPSHOT_KIND },
		orderBy: { createdAt: "desc" },
		take: retention,
		select: { id: true },
	});
	if (keep.length === retention) {
		await db.note.deleteMany({
			where: {
				boardId: input.boardId,
				kind: SNAPSHOT_KIND,
				id: { notIn: keep.map((k) => k.id) },
			},
		});
	}

	return note;
}

export async function listBriefSnapshots(
	db: PrismaClient,
	boardId: string,
	limit = DEFAULT_RETENTION
): Promise<Note[]> {
	return db.note.findMany({
		where: { kind: SNAPSHOT_KIND, boardId },
		orderBy: { createdAt: "desc" },
		take: limit,
	});
}
