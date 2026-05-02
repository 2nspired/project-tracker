#!/usr/bin/env tsx
// Compare TOON vs JSON payload sizes on real board payloads.

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { encode } from "@toon-format/toon";
import { PrismaClient } from "../prisma/generated/client.js";

const adapter = new PrismaBetterSqlite3({ url: "file:./data/tracker.db" });
const db = new PrismaClient({ adapter });

type Row = { label: string; json: number; toon: number };

async function main() {
	const rows: Row[] = [];

	const boards = await db.board.findMany({
		include: {
			project: true,
			columns: {
				orderBy: { position: "asc" },
				include: {
					cards: {
						orderBy: { position: "asc" },
						include: {
							checklists: { orderBy: { position: "asc" } },
							milestone: { select: { id: true, name: true } },
							cardTags: { include: { tag: { select: { label: true } } } },
							_count: { select: { comments: true } },
						},
					},
				},
			},
		},
	});

	for (const board of boards) {
		if (!board.project) continue;
		const totalCards = board.columns.reduce((sum, c) => sum + c.cards.length, 0);

		const fullShape = {
			id: board.id,
			name: board.name,
			project: { id: board.project.id, name: board.project.name },
			columns: board.columns.map((col) => ({
				id: col.id,
				name: col.name,
				description: col.description,
				isParking: col.isParking,
				cards: col.cards.map((card) => ({
					id: card.id,
					number: card.number,
					ref: `#${card.number}`,
					title: card.title,
					description: card.description,
					priority: card.priority,
					tags: card.cardTags.map((ct) => ct.tag.label),
					createdBy: card.createdBy,
					lastEditedBy: card.lastEditedBy,
					milestone: card.milestone,
					checklist: {
						total: card.checklists.length,
						done: card.checklists.filter((c) => c.completed).length,
						items: card.checklists.map((c) => ({
							id: c.id,
							text: c.text,
							completed: c.completed,
						})),
					},
					commentCount: card._count.comments,
				})),
			})),
		};

		const summaryShape = {
			id: board.id,
			name: board.name,
			project: { id: board.project.id, name: board.project.name },
			columns: board.columns.map((col) => ({
				id: col.id,
				name: col.name,
				cards: col.cards.map((card) => ({
					number: card.number,
					ref: `#${card.number}`,
					title: card.title,
					priority: card.priority,
					tags: card.cardTags.map((ct) => ct.tag.label),
					milestone: card.milestone?.name ?? null,
					checklist: {
						total: card.checklists.length,
						done: card.checklists.filter((c) => c.completed).length,
					},
				})),
			})),
		};

		rows.push({
			label: `${board.project.name}/${board.name} full (${totalCards} cards)`,
			json: JSON.stringify(fullShape).length,
			toon: encode(fullShape).length,
		});
		rows.push({
			label: `${board.project.name}/${board.name} summary`,
			json: JSON.stringify(summaryShape).length,
			toon: encode(summaryShape).length,
		});
	}

	// Flat/tabular shapes — arrays of uniform objects, TOON's best case
	const projects = await db.project.findMany({
		select: { id: true, name: true, description: true, createdAt: true },
	});
	const cardList = await db.card.findMany({
		select: { number: true, title: true, priority: true },
		take: 50,
	});
	const cardListFlat = cardList.map((c) => ({
		number: c.number,
		title: c.title,
		priority: c.priority,
	}));

	rows.push({
		label: `listProjects (${projects.length} projects)`,
		json: JSON.stringify(projects).length,
		toon: encode(projects).length,
	});
	rows.push({
		label: `flat card list (${cardListFlat.length} rows)`,
		json: JSON.stringify(cardListFlat).length,
		toon: encode(cardListFlat).length,
	});

	console.log("Payload size comparison (chars — ~4 chars/token)\n");
	console.log("label".padEnd(55), "json".padStart(10), "toon".padStart(10), "Δ".padStart(10), "savings".padStart(10));
	console.log("-".repeat(97));

	let jsonTotal = 0;
	let toonTotal = 0;

	for (const r of rows) {
		jsonTotal += r.json;
		toonTotal += r.toon;
		const delta = r.toon - r.json;
		const savings = ((r.json - r.toon) / r.json) * 100;
		console.log(
			r.label.padEnd(55),
			r.json.toString().padStart(10),
			r.toon.toString().padStart(10),
			(delta >= 0 ? `+${delta}` : `${delta}`).padStart(10),
			`${savings.toFixed(1)}%`.padStart(10),
		);
	}

	console.log("-".repeat(97));
	const totalSavings = ((jsonTotal - toonTotal) / jsonTotal) * 100;
	console.log(
		"TOTAL".padEnd(55),
		jsonTotal.toString().padStart(10),
		toonTotal.toString().padStart(10),
		(toonTotal - jsonTotal).toString().padStart(10),
		`${totalSavings.toFixed(1)}%`.padStart(10),
	);

	await db.$disconnect();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
