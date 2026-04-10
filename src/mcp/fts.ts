import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { db } from "./db.js";

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 5000, maxBuffer: 1024 * 1024 };

// ─── FTS5 Virtual Table Init ──────────────────────────────────────

/**
 * Create the FTS5 virtual table if it doesn't exist.
 * Called at MCP server startup.
 */
export async function initFts5(): Promise<void> {
	await db.$executeRawUnsafe(`
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

// ─── Index Rebuild ────────────────────────────────────────────────

type FtsRow = {
	source_type: string;
	source_id: string;
	project_id: string;
	title: string;
	content: string;
};

/**
 * Rebuild the FTS5 index for a project from all knowledge sources.
 */
export async function rebuildIndex(projectId: string): Promise<{ indexed: Record<string, number> }> {
	// Clear existing entries for this project
	await db.$executeRawUnsafe(
		"DELETE FROM knowledge_fts WHERE project_id = ?",
		projectId,
	);

	const rows: FtsRow[] = [];

	// Source 1: Cards
	const cards = await db.card.findMany({
		where: { projectId },
		select: { id: true, title: true, description: true, number: true, tags: true },
	});
	for (const card of cards) {
		const tags = JSON.parse(card.tags) as string[];
		const content = [card.description ?? "", tags.length > 0 ? `Tags: ${tags.join(", ")}` : ""].filter(Boolean).join("\n");
		rows.push({
			source_type: "card",
			source_id: card.id,
			project_id: projectId,
			title: `#${card.number} ${card.title}`,
			content,
		});
	}

	// Source 2: Comments
	const comments = await db.comment.findMany({
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

	// Source 3: Decisions
	const decisions = await db.decision.findMany({
		where: { projectId },
		select: { id: true, title: true, decision: true, rationale: true, status: true },
	});
	for (const d of decisions) {
		rows.push({
			source_type: "decision",
			source_id: d.id,
			project_id: projectId,
			title: `[${d.status}] ${d.title}`,
			content: [d.decision, d.rationale].filter(Boolean).join("\n"),
		});
	}

	// Source 4: Notes
	const notes = await db.note.findMany({
		where: { projectId },
		select: { id: true, title: true, content: true },
	});
	for (const note of notes) {
		rows.push({
			source_type: "note",
			source_id: note.id,
			project_id: projectId,
			title: note.title,
			content: note.content,
		});
	}

	// Source 5: Session handoffs
	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { boards: { select: { id: true } }, repoPath: true },
	});
	const boardIds = project?.boards.map((b) => b.id) ?? [];

	if (boardIds.length > 0) {
		const handoffs = await db.sessionHandoff.findMany({
			where: { boardId: { in: boardIds } },
			select: { id: true, summary: true, findings: true, agentName: true, createdAt: true },
		});
		for (const h of handoffs) {
			const findings = JSON.parse(h.findings) as string[];
			rows.push({
				source_type: "handoff",
				source_id: h.id,
				project_id: projectId,
				title: `Handoff by ${h.agentName} (${h.createdAt.toISOString().slice(0, 10)})`,
				content: [h.summary, ...findings].filter(Boolean).join("\n"),
			});
		}
	}

	// Source 6: Code facts
	const codeFacts = await db.codeFact.findMany({
		where: { projectId },
		select: { id: true, path: true, symbol: true, fact: true },
	});
	for (const f of codeFacts) {
		rows.push({
			source_type: "code_fact",
			source_id: f.id,
			project_id: projectId,
			title: f.symbol ? `${f.path}#${f.symbol}` : f.path,
			content: f.fact,
		});
	}

	// Source 7: Persistent context entries
	const entries = await db.persistentContextEntry.findMany({
		where: { projectId },
		select: { id: true, claim: true, rationale: true, application: true, details: true },
	});
	for (const e of entries) {
		const details = JSON.parse(e.details) as string[];
		rows.push({
			source_type: "context_entry",
			source_id: e.id,
			project_id: projectId,
			title: e.claim,
			content: [e.rationale, e.application, ...details].filter(Boolean).join("\n"),
		});
	}

	// Source 8: Indexed repo markdown files
	if (project?.repoPath) {
		const docRows = await indexRepoMarkdown(projectId, project.repoPath);
		rows.push(...docRows);
	}

	// Bulk insert
	for (const row of rows) {
		await db.$executeRawUnsafe(
			"INSERT INTO knowledge_fts (source_type, source_id, project_id, title, content) VALUES (?, ?, ?, ?, ?)",
			row.source_type,
			row.source_id,
			row.project_id,
			row.title,
			row.content,
		);
	}

	// Count by source type
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

				// Compute file SHA for freshness tracking
				let sha: string | undefined;
				try {
					const { stdout } = await execFileAsync(
						"git",
						["log", "-1", "--format=%H", "--", relative(repoPath, filePath)],
						{ ...EXEC_OPTS, cwd: repoPath },
					);
					sha = stdout.trim() || undefined;
				} catch {
					// Not in git or git not available
				}

				const relPath = relative(repoPath, filePath);
				rows.push({
					source_type: "doc",
					source_id: sha ?? relPath,
					project_id: projectId,
					title: relPath,
					content: content.slice(0, 50_000), // Cap at 50KB per file
				});
			} catch {
				// Skip unreadable files
				continue;
			}
		}
	} catch {
		// Repo path doesn't exist or isn't accessible
	}

	return rows;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "vendor", ".turbo"]);

async function findMarkdownFiles(dir: string, depth = 0): Promise<string[]> {
	if (depth > 5) return []; // Max depth to prevent runaway traversal

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
				// Skip very large files
				const fileStat = await stat(fullPath);
				if (fileStat.size <= 100_000) { // 100KB max
					results.push(fullPath);
				}
			}
		}
	} catch {
		// Directory not readable
	}

	return results;
}

// ─── Search ───────────────────────────────────────────────────────

export type KnowledgeResult = {
	sourceType: string;
	sourceId: string;
	title: string;
	snippet: string;
	rank: number;
};

/**
 * Search across all indexed knowledge for a project.
 */
export async function queryKnowledge(
	projectId: string,
	topic: string,
	limit = 20,
): Promise<KnowledgeResult[]> {
	// Sanitize the query for FTS5 — escape special characters and wrap terms
	const sanitized = sanitizeFts5Query(topic);
	if (!sanitized) return [];

	const results = await db.$queryRawUnsafe<
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
		limit,
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
 * Sanitize a user query for FTS5 MATCH syntax.
 * Wraps each word in quotes to prevent FTS5 syntax errors from special chars.
 */
function sanitizeFts5Query(query: string): string {
	// Split into words, remove empty strings, wrap each in quotes
	const terms = query
		.replace(/['"]/g, "") // Remove quotes
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.map((t) => `"${t}"`);

	return terms.join(" ");
}
