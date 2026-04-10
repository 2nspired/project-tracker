import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "./db.js";
import { toToon } from "./toon.js";

/**
 * Register MCP resources — read-only views of tracker data.
 * Resources let clients browse project data without calling tools.
 */
export function registerResources(server: McpServer) {

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
								},
							},
						},
					},
				},
			});
			if (!board) return { contents: [{ uri: uri.href, text: "Board not found", mimeType: "text/plain" }] };

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
						tags: JSON.parse(c.tags),
						milestone: c.milestone?.name ?? null,
						checklist: `${c.checklists.filter((cl) => cl.completed).length}/${c.checklists.length}`,
					})),
				})),
			};

			return {
				contents: [{
					uri: uri.href,
					text: toToon(data),
					mimeType: "application/json",
				}],
			};
		},
	);

	// ─── Card resource ─────────────────────────────────────────────
	server.registerResource(
		"card",
		new ResourceTemplate("tracker://board/{boardId}/card/{number}", { list: undefined }),
		{ title: "Card Detail", description: "Single card with checklist, comments, relations" },
		async (uri, { boardId, number }) => {
			const cardNum = Number.parseInt(number as string, 10);
			const board = await db.board.findUnique({ where: { id: boardId as string }, select: { projectId: true } });
			if (!board) return { contents: [{ uri: uri.href, text: "Board not found", mimeType: "text/plain" }] };

			const card = await db.card.findUnique({
				where: { projectId_number: { projectId: board.projectId, number: cardNum } },
				include: {
					checklists: { orderBy: { position: "asc" }, select: { text: true, completed: true } },
					comments: { orderBy: { createdAt: "desc" }, take: 10, select: { content: true, authorName: true, authorType: true, createdAt: true } },
					column: { select: { name: true } },
					milestone: { select: { name: true } },
					relationsFrom: { include: { toCard: { select: { number: true, title: true } } } },
					relationsTo: { include: { fromCard: { select: { number: true, title: true } } } },
				},
			});
			if (!card) return { contents: [{ uri: uri.href, text: "Card not found", mimeType: "text/plain" }] };

			const data = {
				ref: `#${card.number}`,
				title: card.title,
				description: card.description,
				priority: card.priority,
				column: card.column.name,
				milestone: card.milestone?.name ?? null,
				tags: JSON.parse(card.tags),
				checklist: card.checklists,
				comments: card.comments.map((c) => ({
					content: c.content,
					author: c.authorName ?? c.authorType,
					when: c.createdAt,
				})),
				blocks: card.relationsFrom.filter((r) => r.type === "blocks").map((r) => `#${r.toCard.number}`),
				blockedBy: card.relationsTo.filter((r) => r.type === "blocks").map((r) => `#${r.fromCard.number}`),
			};

			return {
				contents: [{
					uri: uri.href,
					text: JSON.stringify(data, null, 2),
					mimeType: "application/json",
				}],
			};
		},
	);

	// ─── Handoff resource ──────────────────────────────────────────
	server.registerResource(
		"handoff",
		new ResourceTemplate("tracker://board/{boardId}/handoff", { list: undefined }),
		{ title: "Latest Handoff", description: "Most recent agent session handoff" },
		async (uri, { boardId }) => {
			const handoff = await db.sessionHandoff.findFirst({
				where: { boardId: boardId as string },
				orderBy: { createdAt: "desc" },
			});
			if (!handoff) return { contents: [{ uri: uri.href, text: "No handoff found", mimeType: "text/plain" }] };

			const data = {
				agentName: handoff.agentName,
				summary: handoff.summary,
				workingOn: JSON.parse(handoff.workingOn),
				findings: JSON.parse(handoff.findings),
				nextSteps: JSON.parse(handoff.nextSteps),
				blockers: JSON.parse(handoff.blockers),
				createdAt: handoff.createdAt,
			};

			return {
				contents: [{
					uri: uri.href,
					text: JSON.stringify(data, null, 2),
					mimeType: "application/json",
				}],
			};
		},
	);

	// ─── Decisions resource ────────────────────────────────────────
	server.registerResource(
		"decisions",
		new ResourceTemplate("tracker://project/{projectId}/decisions", { list: undefined }),
		{ title: "Project Decisions", description: "All architectural decision records for a project" },
		async (uri, { projectId }) => {
			const decisions = await db.decision.findMany({
				where: { projectId: projectId as string },
				include: { card: { select: { number: true, title: true } } },
				orderBy: { createdAt: "desc" },
			});

			const data = decisions.map((d) => ({
				title: d.title,
				status: d.status,
				decision: d.decision,
				rationale: d.rationale,
				alternatives: JSON.parse(d.alternatives),
				card: d.card ? `#${d.card.number}` : null,
				author: d.author,
				createdAt: d.createdAt,
			}));

			return {
				contents: [{
					uri: uri.href,
					text: JSON.stringify(data, null, 2),
					mimeType: "application/json",
				}],
			};
		},
	);
}
