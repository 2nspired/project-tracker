/**
 * Shared scratch (ephemeral agent working memory) logic.
 * Both the tRPC service and MCP tool delegate here.
 */

import type { PrismaClient } from "prisma/generated/client";

export type ScratchEntry = {
	id: string;
	boardId: string;
	agentName: string;
	key: string;
	value: string;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type ScratchListItem = {
	key: string;
	value: string;
	expiresAt: Date | null;
	updatedAt: Date;
};

export async function setScratch(
	db: PrismaClient,
	input: { boardId: string; agentName: string; key: string; value: string; ttlDays: number },
): Promise<ScratchEntry> {
	const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);

	const entry = await db.agentScratch.upsert({
		where: {
			boardId_agentName_key: {
				boardId: input.boardId,
				agentName: input.agentName,
				key: input.key,
			},
		},
		update: {
			value: input.value,
			expiresAt,
		},
		create: {
			boardId: input.boardId,
			agentName: input.agentName,
			key: input.key,
			value: input.value,
			expiresAt,
		},
	});

	return entry;
}

export async function getScratch(
	db: PrismaClient,
	boardId: string,
	agentName: string,
	key: string,
): Promise<ScratchEntry | null> {
	const entry = await db.agentScratch.findUnique({
		where: {
			boardId_agentName_key: { boardId, agentName, key },
		},
	});

	if (!entry) return null;

	// If expired, delete and return null
	if (entry.expiresAt && entry.expiresAt < new Date()) {
		await db.agentScratch.delete({ where: { id: entry.id } });
		return null;
	}

	return entry;
}

export async function listScratch(
	db: PrismaClient,
	boardId: string,
	agentName: string,
): Promise<ScratchListItem[]> {
	// Delete any expired entries first
	await db.agentScratch.deleteMany({
		where: {
			boardId,
			agentName,
			expiresAt: { lt: new Date() },
		},
	});

	return db.agentScratch.findMany({
		where: { boardId, agentName },
		orderBy: { updatedAt: "desc" },
		select: { key: true, value: true, expiresAt: true, updatedAt: true },
	});
}

export async function clearScratch(
	db: PrismaClient,
	boardId: string,
	agentName: string,
	key?: string,
): Promise<{ count: number }> {
	if (key) {
		const existing = await db.agentScratch.findUnique({
			where: { boardId_agentName_key: { boardId, agentName, key } },
		});
		if (!existing) return { count: 0 };
		await db.agentScratch.delete({ where: { id: existing.id } });
		return { count: 1 };
	}

	const result = await db.agentScratch.deleteMany({
		where: { boardId, agentName },
	});

	return { count: result.count };
}

export async function gcExpiredScratch(db: PrismaClient): Promise<{ count: number }> {
	const result = await db.agentScratch.deleteMany({
		where: { expiresAt: { lt: new Date() } },
	});
	return { count: result.count };
}
