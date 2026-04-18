/**
 * One-shot backfill: legacy knowledge tables → Note + Claim.
 *
 * Maps:
 *   SessionHandoff         → Note(kind="handoff") with metadata.{workingOn, findings, nextSteps, blockers}
 *   Decision               → Claim(kind="decision"); status rewrites proposed/accepted→active, rejected/deprecated→retired
 *   PersistentContextEntry → Claim(kind="context")
 *   CodeFact               → Claim(kind="code")
 *   MeasurementFact        → Claim(kind="measurement")
 *
 * Idempotency: new rows reuse the legacy UUID as their id. Reruns detect
 * already-migrated rows by checking the target table for that id, so the
 * script is safe to run repeatedly.
 *
 * The script does NOT delete legacy tables. That happens in commit 8 of
 * the cutover (docs/IMPL-NOTE-CLAIM-CUTOVER.md).
 *
 * Usage:  npx tsx scripts/migrate-notes-claims.mts
 */

const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
const { PrismaClient } = await import("prisma/generated/client");

const adapter = new PrismaBetterSqlite3({ url: "file:./data/tracker.db" });
const db = new PrismaClient({ adapter });

type Counts = { inserted: number; skipped: number };

function j(v: unknown): string {
	return JSON.stringify(v);
}

async function migrateHandoffs(): Promise<Counts> {
	const legacy = await db.sessionHandoff.findMany();
	const existingIds = new Set(
		(await db.note.findMany({ where: { kind: "handoff" }, select: { id: true } })).map((n) => n.id)
	);

	let inserted = 0;
	let skipped = 0;
	for (const sh of legacy) {
		if (existingIds.has(sh.id)) {
			skipped++;
			continue;
		}
		const board = await db.board.findUnique({ where: { id: sh.boardId } });

		await db.note.create({
			data: {
				id: sh.id,
				kind: "handoff",
				title: `Handoff by ${sh.agentName}`,
				content: sh.summary ?? "",
				author: sh.agentName,
				boardId: sh.boardId,
				projectId: board?.projectId ?? null,
				tags: "[]",
				metadata: j({
					workingOn: JSON.parse(sh.workingOn) as string[],
					findings: JSON.parse(sh.findings) as string[],
					nextSteps: JSON.parse(sh.nextSteps) as string[],
					blockers: JSON.parse(sh.blockers) as string[],
				}),
				createdAt: sh.createdAt,
				updatedAt: sh.createdAt,
			},
		});
		inserted++;
	}
	return { inserted, skipped };
}

async function migrateDecisions(): Promise<Counts> {
	const legacy = await db.decision.findMany({ orderBy: { createdAt: "asc" } });
	const existingIds = new Set(
		(await db.claim.findMany({ where: { kind: "decision" }, select: { id: true } })).map(
			(c) => c.id
		)
	);

	const statusMap: Record<string, string> = {
		proposed: "active",
		accepted: "active",
		superseded: "superseded",
		rejected: "retired",
		deprecated: "retired",
	};

	let inserted = 0;
	let skipped = 0;

	// First pass: insert without supersession links.
	for (const d of legacy) {
		if (existingIds.has(d.id)) {
			skipped++;
			continue;
		}

		const body = d.rationale ? `${d.decision}\n\n${d.rationale}` : d.decision;

		await db.claim.create({
			data: {
				id: d.id,
				projectId: d.projectId,
				kind: "decision",
				statement: d.title,
				body,
				evidence: "{}",
				payload: j({
					alternatives: JSON.parse(d.alternatives) as string[],
				}),
				author: d.author,
				cardId: d.cardId,
				status: statusMap[d.status] ?? "active",
				createdAt: d.createdAt,
				updatedAt: d.updatedAt,
			},
		});
		inserted++;
	}

	// Second pass: restore supersession cross-links. Safe because new
	// Claim ids match legacy Decision ids, so existing FK-less pointers
	// just carry over.
	for (const d of legacy) {
		if (!d.supersedes && !d.supersededBy) continue;
		// Only touch rows whose target exists — avoids orphan links from
		// pre-migration data integrity issues.
		const target = await db.claim.findUnique({ where: { id: d.id } });
		if (!target) continue;
		if (target.supersedesId === d.supersedes && target.supersededById === d.supersededBy) continue;
		await db.claim.update({
			where: { id: d.id },
			data: {
				supersedesId: d.supersedes,
				supersededById: d.supersededBy,
			},
		});
	}

	return { inserted, skipped };
}

async function migrateContext(): Promise<Counts> {
	const legacy = await db.persistentContextEntry.findMany();
	const existingIds = new Set(
		(await db.claim.findMany({ where: { kind: "context" }, select: { id: true } })).map((c) => c.id)
	);

	let inserted = 0;
	let skipped = 0;
	for (const p of legacy) {
		if (existingIds.has(p.id)) {
			skipped++;
			continue;
		}

		const details = JSON.parse(p.details) as string[];
		const body = [p.rationale, details.length > 0 ? details.join("\n") : ""]
			.filter(Boolean)
			.join("\n\n");
		const citedFiles = JSON.parse(p.citedFiles) as string[];

		await db.claim.create({
			data: {
				id: p.id,
				projectId: p.projectId,
				kind: "context",
				statement: p.claim,
				body,
				evidence: j(citedFiles.length > 0 ? { files: citedFiles } : {}),
				payload: j({
					...(p.application && { application: p.application }),
					audience: p.audience,
					surface: p.surface,
				}),
				author: p.author,
				recordedAtSha: p.recordedAtSha,
				createdAt: p.createdAt,
				updatedAt: p.updatedAt,
			},
		});
		inserted++;
	}
	return { inserted, skipped };
}

async function migrateCodeFacts(): Promise<Counts> {
	const legacy = await db.codeFact.findMany();
	const existingIds = new Set(
		(await db.claim.findMany({ where: { kind: "code" }, select: { id: true } })).map((c) => c.id)
	);

	let inserted = 0;
	let skipped = 0;
	for (const c of legacy) {
		if (existingIds.has(c.id)) {
			skipped++;
			continue;
		}

		await db.claim.create({
			data: {
				id: c.id,
				projectId: c.projectId,
				kind: "code",
				statement: c.fact,
				body: "",
				evidence: j({
					files: [c.path],
					...(c.symbol && { symbols: [c.symbol] }),
				}),
				payload: "{}",
				author: c.author,
				recordedAtSha: c.recordedAtSha,
				verifiedAt: c.lastVerifiedAt,
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
			},
		});
		inserted++;
	}
	return { inserted, skipped };
}

async function migrateMeasurements(): Promise<Counts> {
	const legacy = await db.measurementFact.findMany();
	const existingIds = new Set(
		(await db.claim.findMany({ where: { kind: "measurement" }, select: { id: true } })).map(
			(c) => c.id
		)
	);

	let inserted = 0;
	let skipped = 0;
	for (const m of legacy) {
		if (existingIds.has(m.id)) {
			skipped++;
			continue;
		}

		const env = JSON.parse(m.env) as Record<string, string>;
		const evidence: Record<string, unknown> = {};
		if (m.path) evidence.files = [m.path];
		if (m.symbol) evidence.symbols = [m.symbol];

		const expiresAt =
			m.ttl != null ? new Date(m.recordedAt.getTime() + m.ttl * 24 * 60 * 60 * 1000) : null;

		await db.claim.create({
			data: {
				id: m.id,
				projectId: m.projectId,
				kind: "measurement",
				statement: m.description,
				body: "",
				evidence: j(evidence),
				payload: j({
					value: m.value,
					unit: m.unit,
					env,
				}),
				author: m.author,
				expiresAt,
				createdAt: m.createdAt,
				updatedAt: m.updatedAt,
			},
		});
		inserted++;
	}
	return { inserted, skipped };
}

function fmt(label: string, c: Counts): string {
	const padded = label.padEnd(13);
	return `  ${padded} +${c.inserted} inserted, ${c.skipped} already migrated`;
}

async function main() {
	console.log("Note+Claim backfill");
	console.log("────────────────────");

	const handoffs = await migrateHandoffs();
	console.log(fmt("handoffs:", handoffs));

	const decisions = await migrateDecisions();
	console.log(fmt("decisions:", decisions));

	const context = await migrateContext();
	console.log(fmt("context:", context));

	const code = await migrateCodeFacts();
	console.log(fmt("code:", code));

	const measurements = await migrateMeasurements();
	console.log(fmt("measurements:", measurements));

	console.log("");
	console.log("Verification — legacy vs target counts by kind:");

	const legacyCounts = {
		handoff: await db.sessionHandoff.count(),
		decision: await db.decision.count(),
		context: await db.persistentContextEntry.count(),
		code: await db.codeFact.count(),
		measurement: await db.measurementFact.count(),
	};
	const newCounts = {
		handoff: await db.note.count({ where: { kind: "handoff" } }),
		decision: await db.claim.count({ where: { kind: "decision" } }),
		context: await db.claim.count({ where: { kind: "context" } }),
		code: await db.claim.count({ where: { kind: "code" } }),
		measurement: await db.claim.count({ where: { kind: "measurement" } }),
	};

	let ok = true;
	for (const kind of Object.keys(legacyCounts) as Array<keyof typeof legacyCounts>) {
		const legacyN = legacyCounts[kind];
		const newN = newCounts[kind];
		const icon = legacyN === newN ? "✓" : "✗";
		if (legacyN !== newN) ok = false;
		console.log(`  ${icon} ${kind.padEnd(12)} legacy=${legacyN} new=${newN}`);
	}

	console.log("");
	if (!ok) {
		console.error("Counts don't match — investigate before dropping legacy tables.");
		process.exit(1);
	}
	console.log("Backfill complete. Legacy tables untouched; drop in commit 8.");
}

main()
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
	.finally(() => db.$disconnect());
