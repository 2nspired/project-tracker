import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "./db.js";
import { buildServerManifest } from "./manifest.js";
import { generateStatusMarkdown } from "./tools/status-tools.js";
import { toToon } from "./toon.js";

// Repo root resolved from this file's location, not process.cwd(), so the
// resolution is stable regardless of how the server was launched. The
// agent-guide resource reads `docs/AGENT-GUIDE.md` relative to this root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AGENT_GUIDE_PATH = resolve(REPO_ROOT, "docs/AGENT-GUIDE.md");

/**
 * Register MCP resources — read-only views of tracker data.
 * Resources let clients browse project data without calling tools.
 */
export function registerResources(server: McpServer) {
	// ─── Server manifest resource ──────────────────────────────────
	// One machine-readable source of truth for what's in the MCP server —
	// version, schema, commit SHA, and the full tool surface (essentials +
	// extended with descriptions and categories). All counts are derived
	// at runtime from the registry so docs and the manifest can never drift.
	server.registerResource(
		"server-manifest",
		"tracker://server/manifest",
		{
			title: "Server Manifest",
			description:
				"Machine-readable snapshot of this MCP server's version, schema, commit, and full tool surface. Use to verify what's actually available instead of trusting cached docs.",
			mimeType: "application/json",
		},
		async (uri) => {
			const manifest = await buildServerManifest();
			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify(manifest, null, 2),
						mimeType: "application/json",
					},
				],
			};
		}
	);

	// ─── Agent guide resource ──────────────────────────────────────
	// Project-agnostic best-practices guide for any AI agent using Pigeon.
	// Modeled on the server-manifest resource (static URI, single read).
	// Handler does live `fs.readFile` at request time — no copy, no cache —
	// so edits to docs/AGENT-GUIDE.md surface immediately without a restart.
	server.registerResource(
		"agent-guide",
		"tracker://server/agent-guide",
		{
			title: "Pigeon Agent Guide",
			description:
				"Project-agnostic best-practices guide for any AI agent using Pigeon (column conventions, intent on writes, planCard workflow, handoff cadence).",
			mimeType: "text/markdown",
		},
		async (uri) => {
			try {
				const text = await readFile(AGENT_GUIDE_PATH, "utf8");
				return {
					contents: [
						{
							uri: uri.href,
							text,
							mimeType: "text/markdown",
						},
					],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					contents: [
						{
							uri: uri.href,
							text: `Failed to read agent guide at ${AGENT_GUIDE_PATH}: ${message}`,
							mimeType: "text/plain",
						},
					],
				};
			}
		}
	);

	// ─── Board resource ────────────────────────────────────────────
	server.registerResource(
		"board",
		new ResourceTemplate("tracker://board/{boardId}", {
			list: async () => {
				const boards = await db.board.findMany({
					include: { project: { select: { name: true } } },
					orderBy: { updatedAt: "desc" },
				});
				return {
					resources: boards.map((b) => ({
						uri: `tracker://board/${b.id}`,
						name: `${b.project.name} / ${b.name}`,
						mimeType: "application/json",
					})),
				};
			},
		}),
		{ title: "Board State", description: "Full board with columns, cards, and checklists" },
		async (uri, { boardId }) => {
			const board = await db.board.findUnique({
				where: { id: boardId as string },
				include: {
					project: { select: { id: true, name: true } },
					columns: {
						orderBy: { position: "asc" },
						include: {
							cards: {
								orderBy: { position: "asc" },
								include: {
									checklists: { select: { text: true, completed: true } },
									milestone: { select: { name: true } },
									cardTags: { include: { tag: { select: { label: true } } } },
								},
							},
						},
					},
				},
			});
			if (!board)
				return { contents: [{ uri: uri.href, text: "Board not found", mimeType: "text/plain" }] };

			const data = {
				id: board.id,
				name: board.name,
				project: board.project,
				columns: board.columns.map((col) => ({
					name: col.name,
					cards: col.cards.map((c) => ({
						ref: `#${c.number}`,
						title: c.title,
						priority: c.priority,
						tags: c.cardTags.map((ct) => ct.tag.label),
						milestone: c.milestone?.name ?? null,
						checklist: `${c.checklists.filter((cl) => cl.completed).length}/${c.checklists.length}`,
					})),
				})),
			};

			return {
				contents: [
					{
						uri: uri.href,
						text: toToon(data),
						mimeType: "application/json",
					},
				],
			};
		}
	);

	// ─── Card resource ─────────────────────────────────────────────
	server.registerResource(
		"card",
		new ResourceTemplate("tracker://board/{boardId}/card/{number}", { list: undefined }),
		{ title: "Card Detail", description: "Single card with checklist, comments, relations" },
		async (uri, { boardId, number }) => {
			const cardNum = Number.parseInt(number as string, 10);
			const board = await db.board.findUnique({
				where: { id: boardId as string },
				select: { projectId: true },
			});
			if (!board)
				return { contents: [{ uri: uri.href, text: "Board not found", mimeType: "text/plain" }] };

			const card = await db.card.findUnique({
				where: { projectId_number: { projectId: board.projectId, number: cardNum } },
				include: {
					checklists: { orderBy: { position: "asc" }, select: { text: true, completed: true } },
					comments: {
						orderBy: { createdAt: "asc" },
						take: 50,
						select: { content: true, authorName: true, authorType: true, createdAt: true },
					},
					column: { select: { name: true } },
					milestone: { select: { name: true } },
					cardTags: { include: { tag: { select: { label: true } } } },
					relationsFrom: { include: { toCard: { select: { number: true, title: true } } } },
					relationsTo: { include: { fromCard: { select: { number: true, title: true } } } },
				},
			});
			if (!card)
				return { contents: [{ uri: uri.href, text: "Card not found", mimeType: "text/plain" }] };

			const data = {
				ref: `#${card.number}`,
				title: card.title,
				description: card.description,
				priority: card.priority,
				column: card.column.name,
				milestone: card.milestone?.name ?? null,
				tags: card.cardTags.map((ct) => ct.tag.label),
				checklist: card.checklists,
				comments: card.comments.map((c) => ({
					content: c.content,
					author: c.authorName ?? c.authorType,
					when: c.createdAt,
				})),
				blocks: card.relationsFrom
					.filter((r) => r.type === "blocks")
					.map((r) => `#${r.toCard.number}`),
				blockedBy: card.relationsTo
					.filter((r) => r.type === "blocks")
					.map((r) => `#${r.fromCard.number}`),
			};

			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify(data, null, 2),
						mimeType: "application/json",
					},
				],
			};
		}
	);

	// ─── Handoff resource ──────────────────────────────────────────
	server.registerResource(
		"handoff",
		new ResourceTemplate("tracker://board/{boardId}/handoff", { list: undefined }),
		{ title: "Latest Handoff", description: "Most recent agent session handoff" },
		async (uri, { boardId }) => {
			const handoff = await db.handoff.findFirst({
				where: { boardId: boardId as string },
				orderBy: { createdAt: "desc" },
			});
			if (!handoff)
				return { contents: [{ uri: uri.href, text: "No handoff found", mimeType: "text/plain" }] };

			const data = {
				agentName: handoff.agentName,
				summary: handoff.summary,
				workingOn: JSON.parse(handoff.workingOn) as string[],
				findings: JSON.parse(handoff.findings) as string[],
				nextSteps: JSON.parse(handoff.nextSteps) as string[],
				blockers: JSON.parse(handoff.blockers) as string[],
				createdAt: handoff.createdAt,
			};

			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify(data, null, 2),
						mimeType: "application/json",
					},
				],
			};
		}
	);

	// ─── Decisions resource ────────────────────────────────────────
	server.registerResource(
		"decisions",
		new ResourceTemplate("tracker://project/{projectId}/decisions", { list: undefined }),
		{ title: "Project Decisions", description: "All architectural decision records for a project" },
		async (uri, { projectId }) => {
			const claims = await db.claim.findMany({
				where: { projectId: projectId as string, kind: "decision" },
				include: { card: { select: { number: true, title: true } } },
				orderBy: { createdAt: "desc" },
			});

			const data = claims.map((c) => {
				const payload = JSON.parse(c.payload) as { alternatives?: string[] };
				const [decisionText, ...rationaleLines] = c.body.split(/\n{2,}/);
				return {
					title: c.statement,
					status: c.status,
					decision: decisionText ?? c.body,
					rationale: rationaleLines.join("\n\n"),
					alternatives: payload.alternatives ?? [],
					card: c.card ? `#${c.card.number}` : null,
					author: c.author,
					createdAt: c.createdAt,
				};
			});

			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify(data, null, 2),
						mimeType: "application/json",
					},
				],
			};
		}
	);

	// ─── Status resource ──────────────────────────────────────────────
	server.registerResource(
		"status",
		new ResourceTemplate("status://project/{slug}", {
			list: async () => {
				const projects = await db.project.findMany({
					orderBy: { updatedAt: "desc" },
					select: { slug: true, name: true },
				});
				return {
					resources: projects.map((p) => ({
						uri: `status://project/${p.slug}`,
						name: `${p.name} — Status`,
						mimeType: "text/markdown",
					})),
				};
			},
		}),
		{
			title: "Project Status",
			description:
				"Board-derived STATUS.md equivalent — milestones, components, metrics. Auto-loadable replacement for hand-maintained STATUS.md files.",
		},
		async (uri, { slug }) => {
			const project = await db.project.findUnique({
				where: { slug: slug as string },
				select: { id: true },
			});
			if (!project) {
				return {
					contents: [
						{
							uri: uri.href,
							text: `Project with slug "${slug}" not found.`,
							mimeType: "text/plain",
						},
					],
				};
			}

			const result = await generateStatusMarkdown(project.id);
			if ("error" in result) {
				return {
					contents: [
						{
							uri: uri.href,
							text: result.error,
							mimeType: "text/plain",
						},
					],
				};
			}

			return {
				contents: [
					{
						uri: uri.href,
						text: result.markdown,
						mimeType: "text/markdown",
					},
				],
			};
		}
	);
}
