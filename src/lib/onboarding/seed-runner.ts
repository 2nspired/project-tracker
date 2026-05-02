/**
 * Seed runner for the tutorial project.
 * Takes a PrismaClient instance — can be called from CLI (prisma/seed.ts)
 * or from the MCP server (seedTutorial tool).
 *
 * Idempotent: checks for slug "learn-project-tracker" before creating.
 */

import type { PrismaClient } from "prisma/generated/client";
import { slugify } from "@/lib/slugify";
import { TUTORIAL_SLUG, teachingProject } from "./teaching-project";

export interface SeedResult {
	projectId: string;
	boardId: string;
}

// Map.get() returns `T | undefined`, but every seed lookup below targets a key
// the seeder has already populated — a miss is a programming error, not a
// runtime condition. Throw with a useful label rather than `!`-asserting.
function expectMapHit<K, V>(map: Map<K, V>, key: K, label: string): V {
	const value = map.get(key);
	if (value === undefined) {
		throw new Error(`Seed integrity error: missing ${label} for key ${String(key)}`);
	}
	return value;
}

export async function seedTutorialProject(db: PrismaClient): Promise<SeedResult | null> {
	// Idempotency: skip if tutorial project already exists
	const existing = await db.project.findUnique({
		where: { slug: TUTORIAL_SLUG },
	});
	if (existing) {
		return null;
	}

	// Create project
	const project = await db.project.create({
		data: {
			name: teachingProject.name,
			slug: teachingProject.slug,
			description: teachingProject.description,
			color: teachingProject.color,
			nextCardNumber: teachingProject.cards.length + 1,
		},
	});

	// Create board
	const board = await db.board.create({
		data: {
			projectId: project.id,
			name: teachingProject.board.name,
			description: teachingProject.board.description,
		},
	});

	// Create columns (board service does this automatically, but we use raw Prisma here)
	const columnDefs = [
		{ name: "Backlog", position: 0, role: "backlog", isParking: false },
		{ name: "In Progress", position: 1, role: "active", isParking: false },
		{ name: "Done", position: 2, role: "done", isParking: false },
		{ name: "Parking Lot", position: 3, role: "parking", isParking: true },
	];

	const columnMap = new Map<string, string>();
	for (const col of columnDefs) {
		const created = await db.column.create({
			data: {
				boardId: board.id,
				name: col.name,
				position: col.position,
				role: col.role,
				isParking: col.isParking,
			},
		});
		columnMap.set(col.name, created.id);
	}

	// Create cards with proper numbering and per-column positioning
	const numberToId = new Map<number, string>();
	const positionCounters = new Map<string, number>();

	// Cache for project-scoped Tag rows so we don't re-upsert the same slug
	// on every card. Tutorial seed defines a small set of canonical labels.
	const tagIdBySlug = new Map<string, string>();

	for (let i = 0; i < teachingProject.cards.length; i++) {
		const def = teachingProject.cards[i];
		const cardNumber = i + 1;
		const columnId = expectMapHit(columnMap, def.column, "column");
		const position = positionCounters.get(def.column) ?? 0;
		positionCounters.set(def.column, position + 1);

		const card = await db.card.create({
			data: {
				projectId: project.id,
				columnId,
				number: cardNumber,
				title: def.title,
				description: def.description,
				position,
				priority: def.priority,
				createdBy: def.createdBy,
			},
		});

		// Resolve tag labels to canonical Tag rows (creating as needed) and
		// link via CardTag. Mirrors the v4.2+ write path now that the legacy
		// Card.tags JSON column has been dropped.
		for (const label of def.tags) {
			const slug = slugify(label);
			if (!slug) continue;
			let tagId = tagIdBySlug.get(slug);
			if (!tagId) {
				const tag = await db.tag.upsert({
					where: { projectId_slug: { projectId: project.id, slug } },
					create: { projectId: project.id, slug, label },
					update: {},
				});
				tagId = tag.id;
				tagIdBySlug.set(slug, tagId);
			}
			await db.cardTag.upsert({
				where: { cardId_tagId: { cardId: card.id, tagId } },
				create: { cardId: card.id, tagId },
				update: {},
			});
		}

		numberToId.set(cardNumber, card.id);
	}

	// Create checklists (partial on card #4 — Cards 101)
	for (const checklist of teachingProject.checklists) {
		const cardId = expectMapHit(numberToId, checklist.cardNumber, "card");
		for (let i = 0; i < checklist.items.length; i++) {
			await db.checklistItem.create({
				data: {
					cardId,
					text: checklist.items[i].text,
					completed: checklist.items[i].completed,
					position: i,
				},
			});
		}
	}

	// Create comments (welcome on #1, human→agent example on #5)
	for (const comment of teachingProject.comments) {
		await db.comment.create({
			data: {
				cardId: expectMapHit(numberToId, comment.cardNumber, "card"),
				content: comment.content,
				authorType: comment.authorType,
				authorName: comment.authorName,
			},
		});
	}

	// Create session handoff in the dedicated Handoff table (#179 Phase 2)
	const hoff = teachingProject.handoff;
	await db.handoff.create({
		data: {
			boardId: board.id,
			projectId: project.id,
			agentName: hoff.agentName,
			summary: hoff.summary,
			workingOn: JSON.stringify(hoff.workingOn),
			findings: JSON.stringify(hoff.findings),
			nextSteps: JSON.stringify(hoff.nextSteps),
			blockers: JSON.stringify(hoff.blockers),
		},
	});

	// Create best-practices note
	const note = teachingProject.note;
	await db.note.create({
		data: {
			projectId: project.id,
			title: note.title,
			content: note.content,
			tags: JSON.stringify(note.tags),
		},
	});

	return { projectId: project.id, boardId: board.id };
}
