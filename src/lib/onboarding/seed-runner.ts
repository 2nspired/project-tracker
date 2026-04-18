/**
 * Seed runner for the tutorial project.
 * Takes a PrismaClient instance — can be called from CLI (prisma/seed.ts)
 * or from the MCP server (seedTutorial tool).
 *
 * Idempotent: checks for slug "learn-project-tracker" before creating.
 */

import type { PrismaClient } from "prisma/generated/client";
import { TUTORIAL_SLUG, teachingProject } from "./teaching-project";

export interface SeedResult {
	projectId: string;
	boardId: string;
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
		{ name: "Up Next", position: 1, role: "todo", isParking: false },
		{ name: "In Progress", position: 2, role: "active", isParking: false },
		{ name: "Done", position: 3, role: "done", isParking: false },
		{ name: "Parking Lot", position: 4, role: "parking", isParking: true },
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

	// Create milestone
	const milestone = await db.milestone.create({
		data: {
			projectId: project.id,
			name: teachingProject.milestone.name,
			description: teachingProject.milestone.description,
		},
	});

	// Create cards with proper numbering and per-column positioning
	const numberToId = new Map<number, string>();
	const positionCounters = new Map<string, number>();

	for (let i = 0; i < teachingProject.cards.length; i++) {
		const def = teachingProject.cards[i];
		const cardNumber = i + 1;
		const columnId = columnMap.get(def.column)!;
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
				tags: JSON.stringify(def.tags),
				createdBy: def.createdBy,
				milestoneId: teachingProject.milestoneCards.includes(cardNumber) ? milestone.id : null,
			},
		});

		numberToId.set(cardNumber, card.id);
	}

	// Create card relations (#8 blocks #7)
	for (const rel of teachingProject.relations) {
		await db.cardRelation.create({
			data: {
				fromCardId: numberToId.get(rel.fromCardNumber)!,
				toCardId: numberToId.get(rel.toCardNumber)!,
				type: rel.type,
			},
		});
	}

	// Create checklists (partial checklist on card #6)
	for (const checklist of teachingProject.checklists) {
		const cardId = numberToId.get(checklist.cardNumber)!;
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

	// Create comments
	for (const comment of teachingProject.comments) {
		await db.comment.create({
			data: {
				cardId: numberToId.get(comment.cardNumber)!,
				content: comment.content,
				authorType: comment.authorType,
				authorName: comment.authorName,
			},
		});
	}

	// Create decision claim (attached to card #13)
	const dec = teachingProject.decision;
	const decisionStatusMap: Record<string, string> = {
		proposed: "active",
		accepted: "active",
		superseded: "superseded",
		rejected: "retired",
	};
	await db.claim.create({
		data: {
			projectId: project.id,
			cardId: numberToId.get(dec.cardNumber)!,
			kind: "decision",
			statement: dec.title,
			body: dec.rationale ? `${dec.decision}\n\n${dec.rationale}` : dec.decision,
			evidence: JSON.stringify({}),
			payload: JSON.stringify({ alternatives: dec.alternatives }),
			author: dec.author,
			status: decisionStatusMap[dec.status] ?? "active",
		},
	});

	// Create session handoff as a Note(kind="handoff")
	const hoff = teachingProject.handoff;
	await db.note.create({
		data: {
			boardId: board.id,
			projectId: project.id,
			kind: "handoff",
			title: `Handoff by ${hoff.agentName}`,
			content: hoff.summary,
			author: hoff.agentName,
			tags: "[]",
			metadata: JSON.stringify({
				workingOn: hoff.workingOn,
				findings: hoff.findings,
				nextSteps: hoff.nextSteps,
				blockers: hoff.blockers,
			}),
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
