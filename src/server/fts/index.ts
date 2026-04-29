/**
 * FTS5 knowledge index — shared between Next.js and MCP processes.
 *
 * The `knowledge_fts` virtual table is a denormalized full-text index over
 * Note, Claim, Card, Comment, and repo markdown. Writes go through the per-
 * source `index*` functions below; the Prisma client extension in
 * `./extension` calls these on every create/update/delete so the index stays
 * live without manual rebuild.
 *
 * ─── Column-weight policy ─────────────────────────────────────────
 *
 * The FTS table has two indexed columns: `title` (high weight) and `content`
 * (low weight). Column weighting is implicit through the mapping below — we
 * intentionally kept the schema flat rather than per-source columns because
 * (a) FTS5's bm25() ranking already gives `title` more weight than `content`
 * by default, and (b) per-source columns would force every query to know the
 * shape of every source. Mapping per source:
 *
 *   Note     → title=note.title,                  content=note.content
 *   Handoff  → title="Handoff by AUTHOR (date)",  content=note.content + findings
 *   Claim    → title="[kind · status] statement", content=body + evidence + payload
 *   Card     → title="#NUM card.title",           content=description + tags
 *   Comment  → title="Comment on #NUM",           content=comment.content
 *   Doc      → title=relPath,                     content=markdown (truncated to 50KB)
 *
 * The Claim mapping is the load-bearing one: putting `statement` in `title`
 * ensures decision/context lookups match the one-sentence summary first, with
 * the longer `body` and structured `payload` as recall material.
 *
 * ─── Live sync vs manual rebuild ──────────────────────────────────
 *
 * - Live sync (Prisma extension in ./extension): handles single-row
 *   create/update/upsert/delete on Note/Claim/Card/Comment.
 * - Manual rebuild (`rebuildIndex`): handles repo markdown (filesystem can't
 *   trigger extensions), drift recovery, and bulk operations. Exposed as the
 *   `rebuildKnowledgeIndex` MCP tool.
 * - `createMany` / `updateMany` / `deleteMany` BYPASS live sync — Prisma
 *   extensions don't return affected rows for batch ops. Run a rebuild after
 *   bulk operations.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { PrismaClient } from "prisma/generated/client";

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 5000, maxBuffer: 1024 * 1024 };

// A db-shaped client — we accept either the base PrismaClient or an extended
// variant. The extension hooks pass in the raw (un-extended) client to avoid
// recursion if multiple extensions are layered.
export type FtsClient = PrismaClient;

// ─── Types ────────────────────────────────────────────────────────

export type FtsRow = {
	source_type: string;
	source_id: string;
	project_id: string;
	title: string;
	content: string;
};

export type KnowledgeResult = {
	sourceType: string;
	sourceId: string;
	title: string;
	snippet: string;
	rank: number;
};

// ─── Init ─────────────────────────────────────────────────────────

export async function initFts5(client: FtsClient): Promise<void> {
	await client.$executeRawUnsafe(`
		CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
			source_type UNINDEXED,
			source_id UNINDEXED,
			project_id UNINDEXED,
			title,
			content,
			tokenize='porter unicode61'
		)
	`);
}

// ─── Low-level writers ────────────────────────────────────────────

async function upsertRow(client: FtsClient, row: FtsRow): Promise<void> {
	// FTS5 has no UPSERT; delete the old entry then insert the new one.
	await client.$executeRawUnsafe(
		"DELETE FROM knowledge_fts WHERE source_type = ? AND source_id = ?",
		row.source_type,
		row.source_id
	);
	await client.$executeRawUnsafe(
		"INSERT INTO knowledge_fts (source_type, source_id, project_id, title, content) VALUES (?, ?, ?, ?, ?)",
		row.source_type,
		row.source_id,
		row.project_id,
		row.title,
		row.content
	);
}

export async function removeFromIndex(
	client: FtsClient,
	sourceType: string,
	sourceId: string
): Promise<void> {
	await client.$executeRawUnsafe(
		"DELETE FROM knowledge_fts WHERE source_type = ? AND source_id = ?",
		sourceType,
		sourceId
	);
}

// ─── Per-source indexers ──────────────────────────────────────────

export async function indexNote(client: FtsClient, noteId: string): Promise<void> {
	const note = await client.note.findUnique({
		where: { id: noteId },
		select: {
			id: true,
			projectId: true,
			kind: true,
			title: true,
			content: true,
			author: true,
			metadata: true,
			createdAt: true,
		},
	});
	if (!note || !note.projectId) return; // Notes without a project aren't indexed.

	if (note.kind === "handoff") {
		const metadata = JSON.parse(note.metadata || "{}") as { findings?: string[] };
		await upsertRow(client, {
			source_type: "handoff",
			source_id: note.id,
			project_id: note.projectId,
			title: `Handoff by ${note.author} (${note.createdAt.toISOString().slice(0, 10)})`,
			content: [note.content, ...(metadata.findings ?? [])].filter(Boolean).join("\n"),
		});
	} else {
		await upsertRow(client, {
			source_type: "note",
			source_id: note.id,
			project_id: note.projectId,
			title: note.title,
			content: note.content,
		});
	}
}

export async function indexClaim(client: FtsClient, claimId: string): Promise<void> {
	const claim = await client.claim.findUnique({
		where: { id: claimId },
		select: {
			id: true,
			projectId: true,
			kind: true,
			statement: true,
			status: true,
			body: true,
			evidence: true,
			payload: true,
		},
	});
	if (!claim) return;

	const evidence = JSON.parse(claim.evidence) as {
		files?: string[];
		symbols?: string[];
		urls?: string[];
	};
	const payload = JSON.parse(claim.payload) as Record<string, unknown>;
	const evidenceParts = [
		...(evidence.files ?? []),
		...(evidence.symbols ?? []),
		...(evidence.urls ?? []),
	];
	const payloadParts = Object.entries(payload)
		.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
		.filter((s) => s.length < 500);

	await upsertRow(client, {
		source_type: `claim_${claim.kind}`,
		source_id: claim.id,
		project_id: claim.projectId,
		title: `[${claim.kind}${claim.kind === "decision" ? ` · ${claim.status}` : ""}] ${claim.statement}`,
		content: [claim.body, evidenceParts.join(" · "), payloadParts.join(" · ")]
			.filter(Boolean)
			.join("\n"),
	});
}

export async function indexCard(client: FtsClient, cardId: string): Promise<void> {
	const card = await client.card.findUnique({
		where: { id: cardId },
		select: { id: true, projectId: true, title: true, description: true, number: true, tags: true },
	});
	if (!card) return;

	const tags = JSON.parse(card.tags) as string[];
	const content = [card.description ?? "", tags.length > 0 ? `Tags: ${tags.join(", ")}` : ""]
		.filter(Boolean)
		.join("\n");

	await upsertRow(client, {
		source_type: "card",
		source_id: card.id,
		project_id: card.projectId,
		title: `#${card.number} ${card.title}`,
		content,
	});
}

export async function indexComment(client: FtsClient, commentId: string): Promise<void> {
	const comment = await client.comment.findUnique({
		where: { id: commentId },
		select: {
			id: true,
			content: true,
			card: { select: { number: true, projectId: true } },
		},
	});
	if (!comment) return;

	await upsertRow(client, {
		source_type: "comment",
		source_id: comment.id,
		project_id: comment.card.projectId,
		title: `Comment on #${comment.card.number}`,
		content: comment.content,
	});
}

// ─── Project-wide rebuild ─────────────────────────────────────────

/**
 * Rebuild the FTS5 index for a project from all knowledge sources.
 *
 * This is the recovery / cold-start path. Handles repo markdown indexing
 * (which live sync can't trigger from the filesystem) and is exposed as the
 * `rebuildKnowledgeIndex` MCP tool.
 */
export async function rebuildIndex(
	client: FtsClient,
	projectId: string
): Promise<{ indexed: Record<string, number> }> {
	// Clear existing entries for this project
	await client.$executeRawUnsafe("DELETE FROM knowledge_fts WHERE project_id = ?", projectId);

	const rows: FtsRow[] = [];

	// Source: Cards
	const cards = await client.card.findMany({
		where: { projectId },
		select: { id: true, title: true, description: true, number: true, tags: true },
	});
	for (const card of cards) {
		const tags = JSON.parse(card.tags) as string[];
		const content = [card.description ?? "", tags.length > 0 ? `Tags: ${tags.join(", ")}` : ""]
			.filter(Boolean)
			.join("\n");
		rows.push({
			source_type: "card",
			source_id: card.id,
			project_id: projectId,
			title: `#${card.number} ${card.title}`,
			content,
		});
	}

	// Source: Comments
	const comments = await client.comment.findMany({
		where: { card: { projectId } },
		select: { id: true, content: true, cardId: true, card: { select: { number: true } } },
	});
	for (const comment of comments) {
		rows.push({
			source_type: "comment",
			source_id: comment.id,
			project_id: projectId,
			title: `Comment on #${comment.card.number}`,
			content: comment.content,
		});
	}

	// Source: Claims (decision / context / code / measurement)
	const claims = await client.claim.findMany({
		where: { projectId },
		select: {
			id: true,
			kind: true,
			statement: true,
			status: true,
			body: true,
			evidence: true,
			payload: true,
		},
	});
	for (const c of claims) {
		const evidence = JSON.parse(c.evidence) as {
			files?: string[];
			symbols?: string[];
			urls?: string[];
		};
		const payload = JSON.parse(c.payload) as Record<string, unknown>;
		const evidenceParts = [
			...(evidence.files ?? []),
			...(evidence.symbols ?? []),
			...(evidence.urls ?? []),
		];
		const payloadParts = Object.entries(payload)
			.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
			.filter((s) => s.length < 500);
		rows.push({
			source_type: `claim_${c.kind}`,
			source_id: c.id,
			project_id: projectId,
			title: `[${c.kind}${c.kind === "decision" ? ` · ${c.status}` : ""}] ${c.statement}`,
			content: [c.body, evidenceParts.join(" · "), payloadParts.join(" · ")]
				.filter(Boolean)
				.join("\n"),
		});
	}

	// Source: Notes (general + handoff)
	const notes = await client.note.findMany({
		where: { projectId },
		select: {
			id: true,
			kind: true,
			title: true,
			content: true,
			author: true,
			metadata: true,
			createdAt: true,
		},
	});
	for (const note of notes) {
		if (note.kind === "handoff") {
			const metadata = JSON.parse(note.metadata || "{}") as { findings?: string[] };
			rows.push({
				source_type: "handoff",
				source_id: note.id,
				project_id: projectId,
				title: `Handoff by ${note.author} (${note.createdAt.toISOString().slice(0, 10)})`,
				content: [note.content, ...(metadata.findings ?? [])].filter(Boolean).join("\n"),
			});
		} else {
			rows.push({
				source_type: "note",
				source_id: note.id,
				project_id: projectId,
				title: note.title,
				content: note.content,
			});
		}
	}

	// Source: indexed repo markdown files
	const project = await client.project.findUnique({
		where: { id: projectId },
		select: { repoPath: true },
	});
	if (project?.repoPath) {
		const docRows = await indexRepoMarkdown(projectId, project.repoPath);
		rows.push(...docRows);
	}

	// Bulk insert
	for (const row of rows) {
		await client.$executeRawUnsafe(
			"INSERT INTO knowledge_fts (source_type, source_id, project_id, title, content) VALUES (?, ?, ?, ?, ?)",
			row.source_type,
			row.source_id,
			row.project_id,
			row.title,
			row.content
		);
	}

	const indexed: Record<string, number> = {};
	for (const row of rows) {
		indexed[row.source_type] = (indexed[row.source_type] ?? 0) + 1;
	}

	return { indexed };
}

// ─── Repo Markdown Indexer ────────────────────────────────────────

async function indexRepoMarkdown(projectId: string, repoPath: string): Promise<FtsRow[]> {
	const rows: FtsRow[] = [];

	try {
		const mdFiles = await findMarkdownFiles(repoPath);

		for (const filePath of mdFiles) {
			try {
				const content = await readFile(filePath, "utf-8");
				if (content.length === 0) continue;

				let sha: string | undefined;
				try {
					const { stdout } = await execFileAsync(
						"git",
						["log", "-1", "--format=%H", "--", relative(repoPath, filePath)],
						{ ...EXEC_OPTS, cwd: repoPath }
					);
					sha = stdout.trim() || undefined;
				} catch {}

				const relPath = relative(repoPath, filePath);
				rows.push({
					source_type: "doc",
					source_id: sha ?? relPath,
					project_id: projectId,
					title: relPath,
					content: content.slice(0, 50_000),
				});
			} catch {}
		}
	} catch {}

	return rows;
}

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	"vendor",
	".turbo",
]);

async function findMarkdownFiles(dir: string, depth = 0): Promise<string[]> {
	if (depth > 5) return [];

	const results: string[] = [];

	try {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name.startsWith(".") && entry.name !== ".") continue;
			if (SKIP_DIRS.has(entry.name)) continue;

			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				const nested = await findMarkdownFiles(fullPath, depth + 1);
				results.push(...nested);
			} else if (entry.name.endsWith(".md")) {
				const fileStat = await stat(fullPath);
				if (fileStat.size <= 100_000) {
					results.push(fullPath);
				}
			}
		}
	} catch {}

	return results;
}

// ─── Search ───────────────────────────────────────────────────────

/**
 * Search across all indexed knowledge for a project.
 *
 * Cold-start safety: if the project has zero indexed rows, runs a rebuild
 * before the search so first-time queries don't return empty.
 */
export async function queryKnowledge(
	client: FtsClient,
	projectId: string,
	topic: string,
	limit = 20
): Promise<KnowledgeResult[]> {
	const sanitized = sanitizeFts5Query(topic);
	if (!sanitized) return [];

	// Idempotent — ensures the virtual table exists even if db.ts init raced
	// past the first query. CREATE VIRTUAL TABLE IF NOT EXISTS is cheap.
	await initFts5(client);

	const [{ count }] = await client.$queryRawUnsafe<Array<{ count: number }>>(
		"SELECT COUNT(*) as count FROM knowledge_fts WHERE project_id = ?",
		projectId
	);
	if (Number(count) === 0) {
		await rebuildIndex(client, projectId).catch((err) =>
			console.warn("[fts] cold-start rebuild failed:", err)
		);
	}

	const results = await client.$queryRawUnsafe<
		Array<{
			source_type: string;
			source_id: string;
			title: string;
			snippet: string;
			rank: number;
		}>
	>(
		`SELECT
			source_type,
			source_id,
			title,
			snippet(knowledge_fts, 4, '**', '**', '…', 48) as snippet,
			rank
		FROM knowledge_fts
		WHERE knowledge_fts MATCH ? AND project_id = ?
		ORDER BY rank
		LIMIT ?`,
		sanitized,
		projectId,
		limit
	);

	return results.map((r) => ({
		sourceType: r.source_type,
		sourceId: r.source_id,
		title: r.title,
		snippet: r.snippet,
		rank: r.rank,
	}));
}

/**
 * Sanitize a user query for FTS5 MATCH syntax — wraps each word in quotes so
 * special characters in user input don't blow up the FTS5 parser.
 */
function sanitizeFts5Query(query: string): string {
	const terms = query
		.replace(/['"]/g, "")
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.map((t) => `"${t}"`);

	return terms.join(" ");
}
