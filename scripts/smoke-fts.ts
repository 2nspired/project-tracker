#!/usr/bin/env tsx
/**
 * Smoke test for FTS5 live sync (card #112) + regression queries (card #100).
 *
 * Imports the same db.ts that production uses, so the Prisma client extension
 * is applied. Creates synthetic Note/Claim/Card/Comment rows in a sentinel
 * project, asserts each appears in queryKnowledge without manual rebuild,
 * verifies update + delete propagate, then cleans up.
 *
 * Also rebuilds the Project Tracker Dev index and prints top-5 results for
 * 10 representative queries — the regression evidence for #100.
 */

import { db } from "../src/server/db.js";
import {
	indexCard,
	indexClaim,
	indexComment,
	indexNote,
	queryKnowledge,
	rebuildIndex,
} from "../src/server/fts/index.js";

const PROJECT_TRACKER_DEV_ID = "48f931ad-b9cb-417d-81ad-1ca4f5c310db";
const SENTINEL_TAG = "fts-smoke-test-2026-04-28";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
let smokeProjectId: string | undefined;
let smokeBoardId: string | undefined;
let smokeColumnId: string | undefined;

function record(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function setupSmokeProject() {
	const stamp = Date.now();
	const project = await db.project.create({
		data: { name: `FTS Smoke ${stamp}`, slug: `fts-smoke-${stamp}` },
	});
	smokeProjectId = project.id;

	const board = await db.board.create({
		data: { projectId: project.id, name: "Smoke Board" },
	});
	smokeBoardId = board.id;

	const column = await db.column.create({
		data: { boardId: board.id, name: "Backlog", position: 0 },
	});
	smokeColumnId = column.id;
}

async function teardownSmokeProject() {
	if (smokeProjectId) {
		await db.project.delete({ where: { id: smokeProjectId } }).catch(() => {});
	}
}

async function searchFor(projectId: string, topic: string) {
	return queryKnowledge(db, projectId, topic, 50);
}

async function smokeNote() {
	const note = await db.note.create({
		data: {
			projectId: smokeProjectId!,
			kind: "general",
			title: `Smoke Note ${SENTINEL_TAG}`,
			content: "Persimmon flamingo zoetrope quasar — should be findable via FTS live sync.",
			author: "smoke-test",
		},
	});

	await sleep(50); // give the fire-and-forget index call a tick

	const found = await searchFor(smokeProjectId!, "persimmon");
	record(
		"Note: live-sync on create",
		found.some((r) => r.sourceId === note.id),
		`hits=${found.length}`,
	);

	await db.note.update({
		where: { id: note.id },
		data: { content: "Mongoose albatross trebuchet — updated via FTS live sync." },
	});
	await sleep(50);

	const oldHit = await searchFor(smokeProjectId!, "persimmon");
	const newHit = await searchFor(smokeProjectId!, "trebuchet");
	record(
		"Note: live-sync on update (old content gone)",
		!oldHit.some((r) => r.sourceId === note.id),
		`old still found=${oldHit.length}`,
	);
	record(
		"Note: live-sync on update (new content found)",
		newHit.some((r) => r.sourceId === note.id),
		`hits=${newHit.length}`,
	);

	await db.note.delete({ where: { id: note.id } });
	await sleep(50);

	const afterDelete = await searchFor(smokeProjectId!, "trebuchet");
	record(
		"Note: live-sync on delete",
		!afterDelete.some((r) => r.sourceId === note.id),
		`hits=${afterDelete.length}`,
	);
}

async function smokeClaim() {
	const claim = await db.claim.create({
		data: {
			projectId: smokeProjectId!,
			kind: "decision",
			statement: "Marmalade kestrel hypothesis governs xylophone cadence",
			body: "Body text for the claim — flotsam jetsam.",
			status: "active",
		},
	});

	await sleep(50);

	const found = await searchFor(smokeProjectId!, "marmalade");
	record(
		"Claim: live-sync on create (statement→title)",
		found.some((r) => r.sourceId === claim.id && r.sourceType === "claim_decision"),
		`hits=${found.length}`,
	);

	await db.claim.update({
		where: { id: claim.id },
		data: { body: "Updated body — saxophone gargoyle." },
	});
	await sleep(50);

	const newHit = await searchFor(smokeProjectId!, "saxophone");
	record(
		"Claim: live-sync on update (body→content)",
		newHit.some((r) => r.sourceId === claim.id),
		`hits=${newHit.length}`,
	);

	await db.claim.delete({ where: { id: claim.id } });
	await sleep(50);

	const afterDelete = await searchFor(smokeProjectId!, "saxophone");
	record(
		"Claim: live-sync on delete",
		!afterDelete.some((r) => r.sourceId === claim.id),
		`hits=${afterDelete.length}`,
	);
}

async function smokeCard() {
	const card = await db.card.create({
		data: {
			projectId: smokeProjectId!,
			columnId: smokeColumnId!,
			number: 9001,
			title: "Tangerine cyclops directive",
			description: "Vermilion ostrich corollary — card description body.",
			position: 0,
		},
	});

	await sleep(50);

	const found = await searchFor(smokeProjectId!, "tangerine");
	record(
		"Card: live-sync on create",
		found.some((r) => r.sourceId === card.id),
		`hits=${found.length}`,
	);

	await db.card.update({
		where: { id: card.id },
		data: { description: "Lemur protocol — updated description." },
	});
	await sleep(50);

	const newHit = await searchFor(smokeProjectId!, "lemur");
	record(
		"Card: live-sync on update",
		newHit.some((r) => r.sourceId === card.id),
		`hits=${newHit.length}`,
	);

	// Comment within the same card
	const comment = await db.comment.create({
		data: { cardId: card.id, content: "Ferret mango parlance — inline comment." },
	});
	await sleep(50);

	const commentHit = await searchFor(smokeProjectId!, "ferret");
	record(
		"Comment: live-sync on create",
		commentHit.some((r) => r.sourceId === comment.id),
		`hits=${commentHit.length}`,
	);

	await db.comment.delete({ where: { id: comment.id } });
	await sleep(50);

	const commentGone = await searchFor(smokeProjectId!, "ferret");
	record(
		"Comment: live-sync on delete",
		!commentGone.some((r) => r.sourceId === comment.id),
		`hits=${commentGone.length}`,
	);

	await db.card.delete({ where: { id: card.id } });
	await sleep(50);

	const afterDelete = await searchFor(smokeProjectId!, "lemur");
	record(
		"Card: live-sync on delete",
		!afterDelete.some((r) => r.sourceId === card.id),
		`hits=${afterDelete.length}`,
	);
}

async function smokeHandoff() {
	const handoff = await db.note.create({
		data: {
			projectId: smokeProjectId!,
			kind: "handoff",
			title: "Smoke handoff",
			content: "Quokka peridot summary content.",
			author: "smoke-test",
			metadata: JSON.stringify({ findings: ["narwhal copperhead finding 1"] }),
		},
	});

	await sleep(50);

	const found = await searchFor(smokeProjectId!, "narwhal");
	const handoffHits = found.filter((r) => r.sourceType === "handoff");
	record(
		"Handoff: live-sync on create (metadata.findings indexed)",
		handoffHits.some((r) => r.sourceId === handoff.id),
		`handoff hits=${handoffHits.length}, total=${found.length}`,
	);

	await db.note.delete({ where: { id: handoff.id } });
}

async function regressionQueries() {
	console.log("\n─── Regression Queries (Project Tracker Dev) ───\n");

	const indexed = await rebuildIndex(db, PROJECT_TRACKER_DEV_ID);
	const total = Object.values(indexed.indexed).reduce((a, b) => a + b, 0);
	console.log(`Rebuilt index: ${total} rows across ${Object.keys(indexed.indexed).length} types`);
	console.log("Breakdown:", JSON.stringify(indexed.indexed));
	console.log("");

	const queries = [
		"FTS5",
		"Note Claim cutover",
		"rebrand",
		"Symphony",
		"handoff",
		"MCP tool",
		"briefMe",
		"adoption",
		"workflow",
		"stale reconciler",
	];

	type RegressionRow = { query: string; topResults: Array<{ rank: string; type: string; title: string }> };
	const regressionLog: RegressionRow[] = [];

	for (const q of queries) {
		const results = await queryKnowledge(db, PROJECT_TRACKER_DEV_ID, q, 5);
		const summary = results.map((r) => ({
			rank: r.rank.toFixed(2),
			type: r.sourceType,
			title: r.title.slice(0, 80),
		}));
		regressionLog.push({ query: q, topResults: summary });
		console.log(`Query: "${q}" — ${results.length} hits`);
		for (const s of summary) {
			console.log(`  [${s.rank}] (${s.type}) ${s.title}`);
		}
		console.log("");
	}

	return regressionLog;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	console.log("─── FTS5 Smoke Test ───\n");

	try {
		await setupSmokeProject();
		console.log(`Smoke project: ${smokeProjectId}\n`);

		await smokeNote();
		await smokeClaim();
		await smokeCard();
		await smokeHandoff();
	} finally {
		await teardownSmokeProject();
	}

	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} live-sync checks passed`);

	if (failed.length > 0) {
		console.log("\nFAILURES:");
		for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
	}

	const regressionLog = await regressionQueries();

	const summary = {
		liveSyncChecks: {
			passed: results.length - failed.length,
			total: results.length,
			failures: failed,
		},
		regressionQueries: regressionLog,
	};

	console.log("\n─── JSON Summary ───\n");
	console.log(JSON.stringify(summary, null, 2));

	process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error("Smoke test crashed:", err);
	process.exit(2);
});
