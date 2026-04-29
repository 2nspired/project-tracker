import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initFts5 } from "@/server/fts";
import { findStaleInProgress } from "@/server/services/stale-cards";
import { getHorizon, hasRole } from "../lib/column-roles.js";
import { seedTutorialProject } from "../lib/onboarding/seed-runner.js";
import { computeBoardDiff } from "../lib/services/board-diff.js";
import { saveBriefSnapshot } from "../lib/services/brief-snapshot.js";
import { isRecentDecision } from "../lib/services/decisions.js";
import { getLatestHandoff, parseHandoff, saveHandoff } from "../lib/services/handoff.js";
import { getBlockers as getBlockersShared } from "../lib/services/relations.js";
import { loadTrackerPolicy } from "../lib/services/tracker-policy.js";
import { computeWorkNextScore } from "../lib/work-next-score.js";
import { db } from "./db.js";
import { syncGitActivityForProject } from "./git-sync.js";
import { wrapEssentialHandler } from "./instrumentation.js";
import {
	ESSENTIAL_TOOLS,
	getCommitSha,
	getCurrentHeadSha,
	MCP_SERVER_VERSION,
} from "./manifest.js";
import { registerResources } from "./resources.js";
import { checkStaleness, formatStalenessWarnings } from "./staleness.js";
import { executeTool, getRegistrySize, getToolCatalog } from "./tool-registry.js";
import { toToon } from "./toon.js";
import {
	AGENT_NAME,
	detectFeatures,
	err,
	getAgentNameSource,
	getProjectIdForBoard,
	ok,
	resolveAgentNameFromClient,
	resolveCardRef,
	resolveOrCreateMilestone,
	SCHEMA_VERSION,
	safeExecute,
} from "./utils.js";

function humanizeAge(date: Date): string {
	const ms = Date.now() - date.getTime();
	const minutes = Math.floor(ms / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

const execFileAsync = promisify(execFile);

type ResolvedBoard =
	| { ok: true; boardId: string; projectName: string; boardName: string }
	| { ok: false; kind: "unregistered"; repoRoot: string }
	| { ok: false; kind: "error"; reason: string; hint: string };

async function resolveBoardFromCwd(): Promise<ResolvedBoard> {
	// MCP_CALLER_CWD is set by scripts/mcp-start.sh before it cd's into the
	// tracker root; it preserves the project root the server was spawned from.
	const callerCwd = process.env.MCP_CALLER_CWD || process.cwd();

	let repoRoot: string;
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd: callerCwd,
			timeout: 3000,
		});
		repoRoot = await realpath(stdout.trim());
	} catch {
		return {
			ok: false,
			kind: "error",
			reason: `Not inside a git repository (cwd: ${callerCwd}).`,
			hint: "Pass boardId explicitly, or run from a project's git root.",
		};
	}

	const project = await db.project.findUnique({
		where: { repoPath: repoRoot },
		select: {
			id: true,
			name: true,
			defaultBoardId: true,
			boards: {
				orderBy: { createdAt: "asc" },
				select: { id: true, name: true },
				take: 1,
			},
		},
	});

	if (!project) {
		return { ok: false, kind: "unregistered", repoRoot };
	}

	let boardId: string | null = project.defaultBoardId;
	let boardName: string | null = null;

	if (boardId) {
		const defaultBoard = await db.board.findUnique({
			where: { id: boardId },
			select: { id: true, name: true, projectId: true },
		});
		if (defaultBoard && defaultBoard.projectId === project.id) {
			boardName = defaultBoard.name;
		} else {
			boardId = null;
		}
	}

	if (!boardId) {
		const firstBoard = project.boards[0];
		if (!firstBoard) {
			return {
				ok: false,
				kind: "error",
				reason: `Project "${project.name}" has no boards.`,
				hint: "Create a board in the web UI at http://localhost:3100, then retry.",
			};
		}
		boardId = firstBoard.id;
		boardName = firstBoard.name;
	}

	return { ok: true, boardId, projectName: project.name, boardName: boardName ?? "" };
}

/**
 * Response for briefMe/endSession when cwd is a git repo but no project owns
 * it. Returns ok() with a setup prompt so the agent can ask the human which
 * project to bind to, then call registerRepo. Not an error — the system
 * works, it just needs a one-time bind.
 */
async function unregisteredRepoResponse(repoRoot: string) {
	const projects = await db.project.findMany({
		select: {
			id: true,
			name: true,
			repoPath: true,
			favorite: true,
			_count: { select: { boards: true } },
		},
		orderBy: [{ favorite: "desc" }, { name: "asc" }],
	});
	return ok({
		needsRegistration: true,
		repoRoot,
		message: `This git repo isn't bound to a Project Tracker project yet. Ask the human which project to attach it to, then call registerRepo({ projectId, repoPath: "${repoRoot}" }).`,
		projects: projects.map((p) => ({
			id: p.id,
			name: p.name,
			boards: p._count.boards,
			repoPath: p.repoPath,
		})),
		hint: "If no project fits, ask the human to create one in the web UI (http://localhost:3100), then re-run briefMe.",
	});
}

// Initialize extended tools (registers them in the catalog)
import "./extended-tools.js";
import "./tools/discovery-tools.js";
import "./tools/relation-tools.js";
import "./tools/session-tools.js";
import "./tools/decision-tools.js";
import "./tools/context-tools.js";
import "./tools/query-tools.js";
import "./tools/git-tools.js";
import "./tools/summary-tools.js";
import "./tools/onboarding-tools.js";
import "./tools/status-tools.js";
import "./tools/fact-tools.js";
import "./tools/claim-tools.js";
import "./tools/knowledge-tools.js";
import "./tools/instrumentation-tools.js";

const server = new McpServer({
	name: "project-tracker",
	version: MCP_SERVER_VERSION,
});

server.registerTool(
	"createCard",
	{
		title: "Create Card",
		description: "Create a card. Uses column name (not ID); auto-creates milestone if name is new.",
		inputSchema: {
			boardId: z.string().describe("Board UUID"),
			columnName: z.string().describe("Column name (e.g. 'Backlog', 'In Progress')"),
			title: z.string().describe("Card title"),
			description: z.string().optional().describe("Markdown description"),
			priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE"),
			tags: z.array(z.string()).default([]).describe("e.g. ['bug', 'feature:auth']"),
			milestoneName: z.string().optional().describe("Auto-creates if new"),
			metadata: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Agent-writable JSON metadata (not rendered in UI)"),
		},
	},
	wrapEssentialHandler(
		"createCard",
		async ({
			boardId,
			columnName,
			title,
			description,
			priority,
			tags,
			milestoneName,
			metadata,
		}) => {
			return safeExecute(async () => {
				const column = await db.column.findFirst({
					where: { boardId, name: { equals: columnName } },
				});
				if (!column) {
					const columns = await db.column.findMany({ where: { boardId }, select: { name: true } });
					return err(
						`Column "${columnName}" not found.`,
						`Available: ${columns.map((c) => c.name).join(", ")}`
					);
				}

				const board = await db.board.findUnique({
					where: { id: boardId },
					select: { projectId: true },
				});
				if (!board) return err("Board not found.");

				const maxPosition = await db.card.aggregate({
					where: { columnId: column.id },
					_max: { position: true },
				});
				const project = await db.project.update({
					where: { id: board.projectId },
					data: { nextCardNumber: { increment: 1 } },
				});
				const cardNumber = project.nextCardNumber - 1;

				let milestoneId: string | undefined;
				if (milestoneName) {
					milestoneId = await resolveOrCreateMilestone(board.projectId, milestoneName);
				}

				const card = await db.card.create({
					data: {
						columnId: column.id,
						projectId: board.projectId,
						number: cardNumber,
						title,
						description,
						priority,
						tags: JSON.stringify(tags),
						milestoneId,
						metadata: metadata ? JSON.stringify(metadata) : undefined,
						createdBy: "AGENT",
						lastEditedBy: AGENT_NAME,
						position: (maxPosition._max.position ?? -1) + 1,
					},
				});

				await db.activity.create({
					data: {
						cardId: card.id,
						action: "created",
						details: `Card #${cardNumber} "${title}" created in ${columnName}`,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				});

				return ok({
					id: card.id,
					number: cardNumber,
					ref: `#${cardNumber}`,
					title: card.title,
					column: columnName,
				});
			});
		}
	)
);

server.registerTool(
	"updateCard",
	{
		title: "Update Card",
		description: "Update card fields. Omitted fields unchanged.",
		inputSchema: {
			cardId: z.string().describe("Card UUID or #number"),
			boardId: z
				.string()
				.optional()
				.describe("Board UUID — scopes #number resolution to this board's project"),
			title: z.string().optional(),
			description: z.string().optional().describe("Markdown"),
			priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
			tags: z.array(z.string()).optional().describe("Replaces all tags"),
			milestoneName: z
				.string()
				.nullable()
				.optional()
				.describe("null to unassign; auto-creates if new"),
			metadata: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Agent-writable JSON metadata (merged with existing; set key to null to delete)"),
			intent: z
				.string()
				.max(120, "intent must be ≤ 120 chars")
				.optional()
				.describe("Optional short rationale — when present, surfaces in the activity strip"),
		},
		annotations: { idempotentHint: true },
	},
	wrapEssentialHandler(
		"updateCard",
		async ({
			cardId: cardRef,
			boardId,
			title,
			description,
			priority,
			tags,
			milestoneName,
			metadata,
			intent,
		}) => {
			return safeExecute(async () => {
				const projectId = boardId ? await getProjectIdForBoard(boardId as string) : undefined;
				const resolved = await resolveCardRef(cardRef, projectId);
				if (!resolved.ok) return err(resolved.message);
				const cardId = resolved.id;

				const existing = await db.card.findUnique({ where: { id: cardId } });
				if (!existing) return err("Card not found.");

				let milestoneId: string | null | undefined;
				if (milestoneName !== undefined) {
					milestoneId = milestoneName
						? await resolveOrCreateMilestone(existing.projectId, milestoneName)
						: null;
				}

				// Merge metadata: combine with existing, remove keys set to null
				let mergedMetadata: string | undefined;
				if (metadata) {
					const existingMeta = JSON.parse(existing.metadata || "{}");
					const merged = { ...existingMeta, ...(metadata as Record<string, unknown>) };
					for (const [key, value] of Object.entries(merged)) {
						if (value === null) delete merged[key];
					}
					mergedMetadata = JSON.stringify(merged);
				}

				const card = await db.card.update({
					where: { id: cardId },
					data: {
						title,
						description,
						priority,
						tags: tags ? JSON.stringify(tags) : undefined,
						milestoneId: milestoneId !== undefined ? milestoneId : undefined,
						metadata: mergedMetadata,
						lastEditedBy: AGENT_NAME,
					},
					include: { milestone: { select: { name: true } } },
				});

				await db.activity.create({
					data: {
						cardId,
						action: "updated",
						...(intent ? { intent: intent as string } : {}),
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				});

				return ok({
					id: card.id,
					ref: `#${card.number}`,
					title: card.title,
					updated: true,
					lastEditedBy: card.lastEditedBy,
					fields: {
						priority: card.priority,
						tags: JSON.parse(card.tags),
						milestone: card.milestone?.name ?? null,
						metadata: JSON.parse(card.metadata),
					},
					...(resolved.warning && { _warning: resolved.warning }),
				});
			});
		}
	)
);

server.registerTool(
	"moveCard",
	{
		title: "Move Card",
		description:
			"Move a card to a column. Position 0 = top; default = bottom. Agents must pass a short `intent` describing why.",
		inputSchema: {
			cardId: z.string().describe("Card UUID or #number"),
			columnName: z.string().describe("Target column (e.g. 'In Progress', 'Done')"),
			intent: z
				.string()
				.min(1, "intent is required — explain why you're moving this card")
				.max(120, "intent must be ≤ 120 chars")
				.describe(
					"Short rationale for the move (e.g. 'promoting to In Progress: starting auth implementation')"
				),
			boardId: z
				.string()
				.optional()
				.describe("Board UUID — scopes #number resolution to this board's project"),
			position: z.number().int().min(0).optional().describe("0 = top, omit = bottom"),
		},
	},
	wrapEssentialHandler(
		"moveCard",
		async ({ cardId: cardRef, columnName, intent, boardId, position }) => {
			return safeExecute(async () => {
				const projectId = boardId ? await getProjectIdForBoard(boardId as string) : undefined;
				const resolved = await resolveCardRef(cardRef, projectId);
				if (!resolved.ok) return err(resolved.message);
				const cardId = resolved.id;

				const card = await db.card.findUnique({
					where: { id: cardId },
					include: { column: { include: { board: true } } },
				});
				if (!card) return err("Card not found.");

				const targetColumn = await db.column.findFirst({
					where: { boardId: card.column.boardId, name: { equals: columnName } },
				});
				if (!targetColumn) {
					const cols = await db.column.findMany({
						where: { boardId: card.column.boardId },
						select: { name: true },
					});
					return err(
						`Column "${columnName}" not found.`,
						`Available: ${cols.map((c) => c.name).join(", ")}`
					);
				}

				const cardsInTarget = await db.card.findMany({
					where: { columnId: targetColumn.id },
					orderBy: { position: "asc" },
				});

				const filtered = cardsInTarget.filter((c) => c.id !== cardId);
				const insertAt =
					position !== undefined ? Math.min(position, filtered.length) : filtered.length;
				filtered.splice(insertAt, 0, card);

				const updates = filtered.map((c, i) =>
					db.card.update({
						where: { id: c.id },
						data: {
							columnId: targetColumn.id,
							position: i,
							...(c.id === cardId && { lastEditedBy: AGENT_NAME }),
						},
					})
				);
				await db.$transaction(updates);

				const fromCol = card.column.name;
				if (fromCol !== columnName) {
					await db.activity.create({
						data: {
							cardId,
							action: "moved",
							details: `Moved from "${fromCol}" to "${columnName}"`,
							intent: intent as string,
							actorType: "AGENT",
							actorName: AGENT_NAME,
						},
					});
				}

				return ok({
					id: cardId,
					ref: `#${card.number}`,
					title: card.title,
					from: fromCol,
					to: columnName,
					...(resolved.warning && { _warning: resolved.warning }),
				});
			});
		}
	)
);

server.registerTool(
	"addComment",
	{
		title: "Add Comment",
		description: "Add a comment to a card.",
		inputSchema: {
			cardId: z.string().describe("Card UUID or #number"),
			boardId: z
				.string()
				.optional()
				.describe("Board UUID — scopes #number resolution to this board's project"),
			content: z.string().describe("Comment text (markdown)"),
		},
	},
	wrapEssentialHandler("addComment", async ({ cardId: cardRef, boardId, content }) => {
		return safeExecute(async () => {
			const projectId = boardId ? await getProjectIdForBoard(boardId as string) : undefined;
			const resolved = await resolveCardRef(cardRef, projectId);
			if (!resolved.ok) return err(resolved.message);
			const cardId = resolved.id;

			const card = await db.card.findUnique({ where: { id: cardId } });
			if (!card) return err("Card not found.");

			const comment = await db.comment.create({
				data: { cardId, content, authorType: "AGENT", authorName: AGENT_NAME },
			});

			return ok({
				id: comment.id,
				ref: `#${card.number}`,
				created: true,
				...(resolved.warning && { _warning: resolved.warning }),
			});
		});
	})
);
// ─── Onboarding (Essential) ──────────────────────────────────────────

server.registerTool(
	"checkOnboarding",
	{
		title: "Check Onboarding",
		description:
			"Detect DB state and get onboarding guidance. Call at session start if no board ID is known.",
		inputSchema: {},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("checkOnboarding", async () => {
		const [projectCount, boardCount, cardCount, handoffCount, projects] = await Promise.all([
			db.project.count(),
			db.board.count(),
			db.card.count(),
			db.note.count({ where: { kind: "handoff" } }),
			db.project.findMany({
				orderBy: { createdAt: "desc" },
				include: {
					boards: {
						select: {
							id: true,
							name: true,
							columns: {
								select: { name: true, _count: { select: { cards: true } } },
								orderBy: { position: "asc" },
							},
						},
					},
				},
			}),
		]);

		let state: "empty" | "existing" | "returning";
		if (projectCount === 0) {
			state = "empty";
		} else if (handoffCount > 0) {
			state = "returning";
		} else {
			state = "existing";
		}

		const offerSampleProject = state === "empty" || (state === "existing" && cardCount === 0);

		const options: Array<{ action: string; description: string }> = [];
		if (offerSampleProject) {
			options.push(
				{
					action: "runTool({ tool: 'seedTutorial' })",
					description: "Create tutorial project with 17 example cards",
				},
				{ action: "onboarding prompt (quickstart)", description: "Set up your own project" },
				{ action: "onboarding prompt (tutorial)", description: "Step-by-step guided walkthrough" }
			);
		}
		if (state === "returning") {
			options.push({
				action:
					"Use MCP prompt 'resume-session' with { boardId } — or call briefMe({ boardId }) for a lightweight session primer",
				description: "Continue where you left off",
			});
		} else if (state === "existing") {
			options.push({
				action:
					"Use MCP prompt 'resume-session' with { boardId } — or call briefMe({ boardId }) for a lightweight session primer",
				description: "Start working on a board",
			});
		}

		// Check staleness across all projects
		const allWarnings = (await Promise.all(projects.map((p) => checkStaleness(p.id)))).flat();
		const stalenessWarnings = allWarnings.length > 0 ? formatStalenessWarnings(allWarnings) : null;

		return ok({
			state,
			stats: {
				projects: projectCount,
				boards: boardCount,
				cards: cardCount,
				handoffs: handoffCount,
			},
			toolArchitecture: {
				essential: `${ESSENTIAL_TOOLS.length} tools are always visible: ${ESSENTIAL_TOOLS.map((t) => t.name).join(", ")}. briefMe is the session-start primer; getBoard, searchCards, and getRoadmap live in extended — call via runTool.`,
				extended: `${getRegistrySize()} additional tools are behind getTools/runTool. Call getTools() to see categories, getTools({ category }) to list tools, runTool({ tool, params }) to execute.`,
				workflows:
					"Named multi-step recipes (sessionStart, sessionEnd, firstSession, recordDecision, searchKnowledge) are listed via `runTool('listWorkflows', { boardId? })` — use these to learn what to do, not just which tool to call.",
				prompts:
					"8 MCP prompts are available (resume-session, end-session, onboarding, deep-dive, sprint-review, plan-work, setup-project, holistic-review). Prompts are invoked via the MCP prompts/get protocol, not via runTool.",
				manifest:
					"Machine-readable surface at resource `tracker://server/manifest` — all tool names, categories, descriptions, schema version, and commit SHA.",
			},
			offerSampleProject,
			projects: projects.map((p) => ({
				id: p.id,
				name: p.name,
				...(p.projectPrompt ? { projectPrompt: p.projectPrompt } : {}),
				boards: p.boards.map((b) => ({
					id: b.id,
					name: b.name,
					columns: b.columns.map((c) => ({ name: c.name, cards: c._count.cards })),
				})),
			})),
			options,
			stalenessWarnings,
		});
	})
);

// ─── Session Primer (Essential) ──────────────────────────────────────

server.registerTool(
	"briefMe",
	{
		title: "Brief Me",
		description:
			"One-shot session primer: last handoff + diff since it, top 3 work-next candidates, blockers, recent decisions, staleness, one-line pulse. Call this first at session start instead of getBoard — ~300-500 tokens vs. full board. With no args, auto-detects the project from the current git repo (after scripts/connect.sh). Pass boardId to override.",
		inputSchema: {
			boardId: z
				.string()
				.optional()
				.describe("Board UUID (optional — auto-detected from cwd when omitted)"),
			format: z
				.enum(["json", "toon"])
				.default("json")
				.describe(
					"'json' (default) or 'toon' (wins on flat tabular arrays, loses on nested payloads)"
				),
		},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("briefMe", async ({ boardId: explicitBoardId, format }) => {
		return safeExecute(async () => {
			let boardId = explicitBoardId;
			let autoResolved: { projectName: string; boardName: string } | null = null;
			if (!boardId) {
				const resolved = await resolveBoardFromCwd();
				if (!resolved.ok) {
					if (resolved.kind === "unregistered") return unregisteredRepoResponse(resolved.repoRoot);
					return err(resolved.reason, resolved.hint);
				}
				boardId = resolved.boardId;
				autoResolved = { projectName: resolved.projectName, boardName: resolved.boardName };
			}

			const board = await db.board.findUnique({
				where: { id: boardId },
				include: {
					project: {
						select: { id: true, name: true, repoPath: true, projectPrompt: true },
					},
					columns: {
						orderBy: { position: "asc" },
						include: {
							cards: {
								orderBy: { position: "asc" },
								select: {
									id: true,
									number: true,
									title: true,
									position: true,
									priority: true,
									updatedAt: true,
									dueDate: true,
									checklists: { select: { completed: true } },
									relationsTo: { where: { type: "blocks" }, select: { id: true } },
									relationsFrom: { where: { type: "blocks" }, select: { id: true } },
								},
							},
						},
					},
				},
			});

			if (!board) return err("Board not found.", "Use checkOnboarding to discover boards.");

			const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const [
				lastHandoff,
				decisionClaims,
				stalenessWarnings,
				blockerEntries,
				recentAgentActivity,
				staleInProgressMap,
				policyResult,
			] = await Promise.all([
				getLatestHandoff(db, boardId),
				db.claim.findMany({
					where: { projectId: board.project.id, kind: "decision", status: "active" },
					orderBy: { createdAt: "desc" },
					take: 10,
					select: {
						id: true,
						statement: true,
						card: {
							select: {
								number: true,
								column: { select: { role: true, name: true } },
							},
						},
					},
				}),
				checkStaleness(board.project.id),
				getBlockersShared(db, boardId),
				db.activity.findMany({
					where: {
						actorType: "AGENT",
						actorName: AGENT_NAME,
						createdAt: { gte: twentyFourHoursAgo },
						card: { column: { boardId } },
					},
					select: { id: true, intent: true },
				}),
				findStaleInProgress(db, boardId),
				loadTrackerPolicy({
					repoPath: board.project.repoPath,
					projectPrompt: board.project.projectPrompt,
				}),
			]);

			const allCards = board.columns.flatMap((col) =>
				col.cards.map((card) => ({ card, column: col }))
			);
			const openCards = allCards.filter(
				({ column }) => !hasRole(column, "done") && !hasRole(column, "parking")
			);
			const inProgressCount = allCards.filter(({ column }) => hasRole(column, "active")).length;

			const handoffAge = lastHandoff ? humanizeAge(lastHandoff.createdAt) : null;
			const pulseParts = [
				`${openCards.length} open`,
				`${inProgressCount} in progress`,
				`${blockerEntries.length} blocked`,
			];
			if (handoffAge) pulseParts.push(`handoff ${handoffAge} ago`);
			const pulse = `${board.project.name} / ${board.name} · ${pulseParts.join(" · ")}`;

			const diff = lastHandoff ? await computeBoardDiff(db, boardId, lastHandoff.createdAt) : null;

			// Top N positions in Backlog are treated as human-pinned and surface
			// ahead of score-ranked Backlog cards. Replaces the old "Up Next"
			// column tier (#97).
			const PIN_THRESHOLD = 3;
			const scoredCards = openCards
				.map(({ card, column }) => ({
					ref: `#${card.number}`,
					title: card.title,
					column: column.name,
					priority: card.priority,
					score: computeWorkNextScore({
						priority: card.priority,
						updatedAt: card.updatedAt,
						dueDate: card.dueDate,
						checklists: card.checklists,
						_blockedByCount: card.relationsTo.length,
						_blocksOtherCount: card.relationsFrom.length,
					}),
					source: hasRole(column, "active")
						? ("active" as const)
						: hasRole(column, "backlog") && card.position < PIN_THRESHOLD
							? ("pinned" as const)
							: ("scored" as const),
				}))
				.filter((c) => c.score >= 0);
			const tierRank = { active: 0, pinned: 1, scored: 2 } as const;
			const topWork = scoredCards
				.sort((a, b) => tierRank[a.source] - tierRank[b.source] || b.score - a.score)
				.slice(0, 3);

			const parsedHandoff = lastHandoff ? parseHandoff(lastHandoff) : null;
			const handoff = parsedHandoff
				? {
						agentName: parsedHandoff.agentName,
						createdAt: parsedHandoff.createdAt,
						summary: parsedHandoff.summary,
						nextSteps: parsedHandoff.nextSteps,
						blockers: parsedHandoff.blockers,
					}
				: null;

			const blockers = blockerEntries.map((b) => ({
				ref: `#${b.card.number}`,
				title: b.card.title,
				blockedBy: b.blockedBy.map((bb) => `#${bb.number}`),
			}));

			const recentDecisions = decisionClaims.filter(isRecentDecision).map((d) => ({
				id: d.id,
				title: d.statement,
				card: d.card ? `#${d.card.number}` : null,
			}));

			const writesWithIntent = recentAgentActivity.filter((a) => a.intent !== null).length;
			const totalAgentWrites = recentAgentActivity.length;
			const intentReminder =
				totalAgentWrites >= 3 && writesWithIntent === 0
					? `No recent intent observed on ${totalAgentWrites} writes in the last 24h — pass a short \`intent\` on moveCard/updateCard so the human sees *why* live. See AGENTS.md § Intent on Writes.`
					: null;

			const [bootSha, headSha] = await Promise.all([getCommitSha(), getCurrentHeadSha()]);
			const versionMismatch =
				bootSha && headSha && bootSha !== headSha
					? `Server is running commit ${bootSha.slice(0, 7)} but repo HEAD is ${headSha.slice(0, 7)} — restart the MCP server to pick up newer code.`
					: null;

			const staleInProgress = allCards
				.map(({ card }) => {
					const info = staleInProgressMap.get(card.id);
					if (!info) return null;
					return {
						ref: `#${card.number}`,
						title: card.title,
						days: info.days,
						lastSignalAt: info.lastSignalAt.toISOString(),
					};
				})
				.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
				.sort((a, b) => b.days - a.days);

			const briefPayload = {
				_serverVersion: MCP_SERVER_VERSION,
				...(versionMismatch ? { _versionMismatch: versionMismatch } : {}),
				...(policyResult.warnings.length > 0 ? { _warnings: policyResult.warnings } : {}),
				pulse,
				...(autoResolved ? { resolvedFromCwd: { ...autoResolved, boardId } } : {}),
				policy: policyResult.policy,
				...(policyResult.policy_error ? { policy_error: policyResult.policy_error } : {}),
				handoff,
				diff,
				topWork,
				blockers,
				recentDecisions,
				stale: formatStalenessWarnings(stalenessWarnings),
				...(staleInProgress.length > 0 ? { staleInProgress } : {}),
				...(intentReminder ? { intentReminder } : {}),
				_hint: lastHandoff
					? "Continue via handoff.nextSteps or pick from topWork (cards with source='pinned' are human-prioritized — top of Backlog by drag order — pick those before source='scored'). Use runTool('getCardContext', { cardId }) for deep work. Run `listWorkflows({ boardId })` to see named recipes (sessionStart, sessionEnd, recordDecision, searchKnowledge)."
					: "No prior handoff — pick from topWork (cards with source='pinned' are human-prioritized — top of Backlog by drag order — pick those before source='scored'). Run `listWorkflows({ boardId })` for the full recipe set; call `endSession` before wrapping to save context.",
			};

			try {
				await saveBriefSnapshot(db, {
					boardId,
					agentName: AGENT_NAME,
					pulse,
					payload: briefPayload,
				});
			} catch (e) {
				console.error("[briefMe] snapshot persist failed:", e);
			}

			return ok(briefPayload, format as "json" | "toon");
		});
	})
);

// ─── Session Wrap-Up (Essential) ─────────────────────────────────────

server.registerTool(
	"endSession",
	{
		title: "End Session",
		description:
			"Session wrap-up companion to `briefMe`. Saves a handoff, links new commits via syncGitActivity, reports which cards the agent touched since the last handoff, and returns a copy-pasteable resume prompt for the next conversation. Does NOT auto-move cards — call `moveCard` with `intent` for any remaining transitions before wrapping up. With no boardId, auto-detects the project from the current git repo.",
		inputSchema: {
			boardId: z
				.string()
				.optional()
				.describe("Board UUID (optional — auto-detected from cwd when omitted)"),
			summary: z
				.string()
				.min(1, "summary is required — one paragraph describing what this session accomplished")
				.describe("One-paragraph session summary (what was accomplished)"),
			workingOn: z
				.array(z.string())
				.default([])
				.describe("Cards or topics worked on (free text; card refs like '#7 auth' are fine)"),
			findings: z
				.array(z.string())
				.default([])
				.describe("Non-obvious discoveries worth carrying forward (code facts, gotchas)"),
			nextSteps: z
				.array(z.string())
				.default([])
				.describe("Concrete first actions for the next agent"),
			blockers: z
				.array(z.string())
				.default([])
				.describe("Anything waiting on a human decision or external change"),
			syncGit: z
				.boolean()
				.default(true)
				.describe("Run syncGitActivity to link new commits referencing #N (default true)"),
		},
	},
	wrapEssentialHandler(
		"endSession",
		async ({
			boardId: explicitBoardId,
			summary,
			workingOn,
			findings,
			nextSteps,
			blockers,
			syncGit,
		}) => {
			return safeExecute(async () => {
				let boardId = explicitBoardId;
				let autoResolved: { projectName: string; boardName: string } | null = null;
				if (!boardId) {
					const resolved = await resolveBoardFromCwd();
					if (!resolved.ok) {
						if (resolved.kind === "unregistered")
							return unregisteredRepoResponse(resolved.repoRoot);
						return err(resolved.reason, resolved.hint);
					}
					boardId = resolved.boardId;
					autoResolved = { projectName: resolved.projectName, boardName: resolved.boardName };
				}

				const board = await db.board.findUnique({
					where: { id: boardId },
					include: { project: { select: { id: true, name: true } } },
				});
				if (!board) return err("Board not found.", "Use checkOnboarding to discover boards.");

				// Optional: link new commits. Failures are non-fatal — endSession's
				// primary job is the handoff; commit linkage is a bonus.
				let gitSync: { commitsScanned: number; linksCreated: number; refsSkipped: number } | null =
					null;
				let gitSyncError: string | null = null;
				if (syncGit !== false) {
					const syncResult = await syncGitActivityForProject(board.project.id);
					if (syncResult.ok) {
						gitSync = {
							commitsScanned: syncResult.commitsScanned,
							linksCreated: syncResult.linksCreated,
							refsSkipped: syncResult.refsSkipped,
						};
					} else {
						gitSyncError = syncResult.message;
					}
				}

				// Infer touched cards: agent activity since the prior handoff, or
				// last 2 hours if there's no handoff yet. Last-write-wins doctrine
				// forbids auto-moving cards here — we only *report* what the agent
				// touched so the human sees the wake.
				const lastHandoff = await getLatestHandoff(db, boardId);
				const since = lastHandoff
					? lastHandoff.createdAt
					: new Date(Date.now() - 2 * 60 * 60 * 1000);

				const recentActivity = await db.activity.findMany({
					where: {
						actorType: "AGENT",
						actorName: AGENT_NAME,
						createdAt: { gte: since },
						card: { column: { boardId } },
					},
					include: {
						card: {
							select: {
								number: true,
								title: true,
								column: { select: { name: true } },
							},
						},
					},
					orderBy: { createdAt: "asc" },
				});

				const touchedMap = new Map<
					number,
					{ ref: string; title: string; column: string; activityCount: number }
				>();
				for (const a of recentActivity) {
					const existing = touchedMap.get(a.card.number);
					if (existing) {
						existing.activityCount++;
					} else {
						touchedMap.set(a.card.number, {
							ref: `#${a.card.number}`,
							title: a.card.title,
							column: a.card.column.name,
							activityCount: 1,
						});
					}
				}
				const touchedCards = Array.from(touchedMap.values()).sort((a, b) =>
					a.ref.localeCompare(b.ref, undefined, { numeric: true })
				);

				const handoff = await saveHandoff(db, {
					boardId,
					agentName: AGENT_NAME,
					workingOn: (workingOn as string[]) ?? [],
					findings: (findings as string[]) ?? [],
					nextSteps: (nextSteps as string[]) ?? [],
					blockers: (blockers as string[]) ?? [],
					summary: summary as string,
				});

				const projectName = autoResolved?.projectName ?? board.project.name;
				const boardName = autoResolved?.boardName ?? board.name;

				// Copy-pasteable resume prompt for the next chat. References cards
				// by #number so the next agent can resolve them via briefMe.
				const resumeLines = [
					`Continue the ${projectName} session. Call \`briefMe()\` first to load the handoff, then pick up from the next steps.`,
				];
				if (touchedCards.length > 0) {
					const refs = touchedCards.map((c) => c.ref).join(", ");
					resumeLines.push(`Recent focus: ${refs}.`);
				}
				if ((blockers as string[])?.length > 0) {
					resumeLines.push(`Open blockers: ${(blockers as string[]).join("; ")}.`);
				}
				const resumePrompt = resumeLines.join(" ");

				return ok({
					handoff: {
						id: handoff.id,
						boardId: handoff.boardId,
						agentName: handoff.author,
						createdAt: handoff.createdAt,
					},
					board: { id: boardId, project: projectName, name: boardName },
					touchedCards,
					gitSync,
					...(gitSyncError ? { gitSyncError } : {}),
					resumePrompt,
					_hint:
						"Paste `resumePrompt` into the next conversation — the next session calls briefMe() and picks up from there.",
				});
			});
		}
	)
);

server.registerTool(
	"registerRepo",
	{
		title: "Register Repo",
		description:
			"Bind a git repo path to a project so briefMe/endSession can auto-detect it from cwd. Call this after briefMe returns needsRegistration.",
		inputSchema: {
			projectId: z.string().uuid().describe("Project UUID to attach the repo to"),
			repoPath: z
				.string()
				.min(1)
				.describe("Absolute git-repo path (pass the repoRoot briefMe returned verbatim)"),
		},
	},
	wrapEssentialHandler("registerRepo", async ({ projectId, repoPath }) => {
		return safeExecute(async () => {
			let resolvedPath: string;
			try {
				resolvedPath = await realpath(repoPath);
			} catch {
				return err(
					`Path "${repoPath}" does not exist on disk.`,
					"Pass the absolute repo root (the value briefMe returned as repoRoot)."
				);
			}

			try {
				await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
					cwd: resolvedPath,
					timeout: 3000,
				});
			} catch {
				return err(
					`"${resolvedPath}" is not inside a git repository.`,
					"Run `git init` in the repo first if the binding is intentional."
				);
			}

			const existingBinding = await db.project.findUnique({
				where: { repoPath: resolvedPath },
				select: { id: true, name: true },
			});
			if (existingBinding && existingBinding.id !== projectId) {
				return err(
					`Repo "${resolvedPath}" is already bound to project "${existingBinding.name}".`,
					"Clear that project's repoPath in the web UI first, or pick it as the target."
				);
			}

			const project = await db.project.findUnique({
				where: { id: projectId },
				select: {
					id: true,
					name: true,
					repoPath: true,
					_count: { select: { boards: true } },
				},
			});
			if (!project) return err(`Project ${projectId} not found.`);

			if (project.repoPath && project.repoPath !== resolvedPath) {
				return err(
					`Project "${project.name}" is already bound to "${project.repoPath}".`,
					"Update it via the web UI if you want to move the binding."
				);
			}

			await db.project.update({
				where: { id: projectId },
				data: { repoPath: resolvedPath },
			});

			return ok({
				registered: true,
				projectId: project.id,
				projectName: project.name,
				repoPath: resolvedPath,
				hasBoards: project._count.boards > 0,
				nextStep:
					project._count.boards > 0
						? "Call briefMe() — it will now auto-detect this repo."
						: "Project has no boards yet. Create one in the web UI at http://localhost:3100, then call briefMe().",
			});
		});
	})
);

// ─── Meta-Tools (Essential + Catalog pattern) ──────────────────────

server.registerTool(
	"getTools",
	{
		title: "Get Tools",
		description: `Browse ${getRegistrySize()} extended tools. No args=categories, category=list tools, tool=full schema.`,
		inputSchema: {
			category: z.string().optional().describe("e.g. 'cards', 'milestones', 'notes'"),
			tool: z.string().optional().describe("Tool name for full parameter schema"),
		},
		annotations: { readOnlyHint: true },
	},
	wrapEssentialHandler("getTools", async ({ category, tool }) => {
		const result = getToolCatalog({ category, tool });
		if (!result)
			return err(
				`Tool "${tool}" not found.`,
				"Call getTools() with no args to see all categories."
			);
		return ok(result);
	})
);

server.registerTool(
	"runTool",
	{
		title: "Run Tool",
		description: "Execute an extended tool by name with validated parameters.",
		inputSchema: {
			tool: z.string().describe("e.g. 'bulkCreateCards', 'listActivity', 'createNote'"),
			params: z
				.record(z.string(), z.unknown())
				.default({})
				.describe(
					"Tool parameters — use getTools({ tool: 'toolName' }) to see required params and their types"
				),
		},
	},
	async ({ tool, params }) => {
		return executeTool(tool, params);
	}
);

// ─── Prompts ───────────────────────────────────────────────────────

server.registerPrompt(
	"resume-session",
	{
		title: "Resume Session",
		description: "Load board state + last handoff + diff. Use at the start of every conversation.",
		argsSchema: {
			boardId: z.string().describe("Board ID"),
		},
	},
	async ({ boardId }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: true,
				columns: {
					orderBy: { position: "asc" },
					include: {
						cards: {
							orderBy: { position: "asc" },
							include: {
								checklists: true,
								_count: { select: { comments: true } },
								relationsTo: { where: { type: "blocks" }, select: { id: true } },
							},
						},
					},
				},
			},
		});

		if (!board) {
			const projectCount = await db.project.count();
			const hint =
				projectCount === 0
					? "Board not found and the database is empty. Call `checkOnboarding` to get started — it will detect your setup state and suggest next steps."
					: "Board not found. Use `runTool({ tool: 'listBoards' })` to find available boards.";
			return {
				messages: [{ role: "user" as const, content: { type: "text" as const, text: hint } }],
			};
		}

		// Last handoff
		const lastHandoff = await getLatestHandoff(db, boardId);

		// Board diff since last handoff
		let diffSummary = "";
		if (lastHandoff) {
			const cardIds = board.columns.flatMap((c) => c.cards.map((card) => card.id));
			const recentActivity = await db.activity.findMany({
				where: { cardId: { in: cardIds }, createdAt: { gt: lastHandoff.createdAt } },
				include: { card: { select: { number: true } } },
				orderBy: { createdAt: "desc" },
				take: 20,
			});
			if (recentActivity.length > 0) {
				diffSummary =
					`\n## Changes since last session (${recentActivity.length})\n` +
					recentActivity
						.slice(0, 10)
						.map((a) => `- #${a.card.number}: ${a.details ?? a.action}`)
						.join("\n");
			}
		}

		const inProgress = board.columns.find((c) => hasRole(c, "active"))?.cards ?? [];
		// Top 3 positions in Backlog are treated as human-pinned (#97).
		const backlogCards = board.columns.find((c) => hasRole(c, "backlog"))?.cards ?? [];
		const pinned = backlogCards.slice(0, 3);
		const blocked = board.columns.flatMap((c) => c.cards).filter((c) => c.relationsTo.length > 0);

		// Detect available features
		const features = await detectFeatures();
		const missingFeatures = Object.entries(features)
			.filter(([key, val]) => key !== "version" && val === false)
			.map(([key]) => key);

		const lines = [
			`# Session — ${board.project.name} / ${board.name}`,
			`Board: \`${boardId}\` | Project: \`${board.project.id}\` | Schema v${features.version}`,
		];

		if (missingFeatures.length > 0) {
			lines.push(
				"",
				`> **Migration needed**: Run \`npm run db:push\` to enable: ${missingFeatures.join(", ")}`,
				"> Some tools (relations, decisions, handoffs, git links) may not work until schema is updated."
			);
		}

		if (lastHandoff) {
			const parsed = parseHandoff(lastHandoff);
			const handoffData = {
				agent: parsed.agentName,
				summary: parsed.summary,
				nextSteps: parsed.nextSteps,
				blockers: parsed.blockers,
			};
			lines.push(
				"",
				"## Last Handoff",
				`Agent: ${handoffData.agent} | ${parsed.createdAt.toISOString()}`
			);
			if (handoffData.summary) lines.push(handoffData.summary);
			if (handoffData.nextSteps.length > 0) {
				lines.push("**Next steps:**");
				for (const s of handoffData.nextSteps) lines.push(`- ${s}`);
			}
			if (handoffData.blockers.length > 0) {
				lines.push("**Blockers:**");
				for (const b of handoffData.blockers) lines.push(`- ${b}`);
			}
		}

		if (diffSummary) lines.push(diffSummary);

		lines.push("", `## In Progress (${inProgress.length})`);
		for (const c of inProgress) {
			const done = c.checklists.filter((i) => i.completed).length;
			const total = c.checklists.length;
			lines.push(
				`- #${c.number} ${c.title}${total > 0 ? ` [${done}/${total}]` : ""} (${c.priority})`
			);
		}

		if (pinned.length > 0) {
			lines.push("", `## Pinned — top of Backlog (${pinned.length})`);
			for (const c of pinned) lines.push(`- #${c.number} ${c.title} (${c.priority})`);
		}

		if (blocked.length > 0) {
			lines.push("", `## Blocked (${blocked.length})`);
			for (const c of blocked) lines.push(`- #${c.number} ${c.title}`);
		}

		const text = lines.join("\n");
		const tokens = Math.ceil(text.length / 4);
		lines.push(
			"",
			`---`,
			`~${tokens} tokens | Use \`getCardContext\` for deep work on a card. Call \`end-session\` before wrapping up.`
		);

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: lines.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"end-session",
	{
		title: "End Session (superseded)",
		description:
			"Superseded by the `endSession` essential tool. Kept as a pointer for older clients.",
		argsSchema: {
			boardId: z.string().describe("Board ID").optional(),
		},
	},
	async ({ boardId }) => {
		const text = [
			"# End Session — superseded",
			"",
			"This prompt has been replaced by the **`endSession`** essential tool. Call it directly instead of walking a checklist:",
			"",
			"```",
			"endSession({",
			`  ${boardId ? `boardId: '${boardId}',` : "// boardId auto-detected from cwd"}`,
			"  summary: 'one paragraph — what this session accomplished',",
			"  workingOn: ['cards or topics'],",
			"  findings: ['non-obvious discoveries'],",
			"  nextSteps: ['concrete first actions for the next agent'],",
			"  blockers: ['anything waiting on a human or external change'],",
			"})",
			"```",
			"",
			"`endSession` saves the handoff, runs `syncGitActivity`, reports which cards you touched this session, and returns a copy-pasteable resume prompt for the next conversation.",
			"",
			"Before calling it, move any finished cards with `moveCard({ intent })` — the tool won't auto-move cards because the intent contract requires a human-readable reason on every transition.",
		].join("\n");

		return {
			messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
		};
	}
);

server.registerPrompt(
	"deep-dive",
	{
		title: "Deep Dive",
		description:
			"Load focused context for deep work on a specific card. Returns card + relations + decisions + related cards.",
		argsSchema: {
			boardId: z.string().describe("Board ID"),
			cardId: z.string().describe("Card ID or #number"),
		},
	},
	async ({ boardId, cardId: cardRef }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			select: { projectId: true, name: true },
		});
		if (!board)
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};

		const cardResolved = await resolveCardRef(cardRef, board.projectId);
		if (!cardResolved.ok)
			return {
				messages: [
					{
						role: "user" as const,
						content: { type: "text" as const, text: `Card "${cardRef}" not found.` },
					},
				],
			};

		const prompt = [
			`# Deep Dive — ${board.name}`,
			"",
			`Load full context for card \`${cardRef}\`:`,
			"```",
			`runTool('getCardContext', { boardId: '${boardId}', cardId: '${cardRef}' })`,
			"```",
			"",
			"Then work on the card. When done, update checklist items, add comments with findings, and move the card if complete.",
		];

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: prompt.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"sprint-review",
	{
		title: "Sprint Review",
		description: "Review board progress: velocity, milestone status, stale cards, blockers.",
		argsSchema: {
			boardId: z.string().describe("Board ID"),
			since: z
				.string()
				.describe("ISO datetime or relative (e.g. '7 days ago')")
				.default(new Date(Date.now() - 7 * 86400000).toISOString()),
		},
	},
	async ({ boardId, since }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: {
					include: {
						milestones: {
							orderBy: { position: "asc" },
							include: { _count: { select: { cards: true } } },
						},
					},
				},
				columns: {
					orderBy: { position: "asc" },
					include: {
						cards: {
							include: {
								checklists: { select: { completed: true } },
								relationsTo: {
									where: { type: "blocks" },
									select: { fromCard: { select: { number: true, title: true } } },
								},
							},
						},
					},
				},
			},
		});

		if (!board)
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};

		const sinceDate = new Date(since);
		const allCards = board.columns.flatMap((c) => c.cards);
		const cardIds = allCards.map((c) => c.id);

		// Completed since
		const completedActivities = await db.activity.findMany({
			where: {
				cardId: { in: cardIds },
				action: "moved",
				details: { contains: '"Done"' },
				createdAt: { gt: sinceDate },
			},
			select: { cardId: true },
		});
		const completedCount = new Set(completedActivities.map((a) => a.cardId)).size;

		// Stale cards (not updated in 7+ days, not in Done)
		const staleThreshold = new Date(Date.now() - 7 * 86400000);
		const doneCol = board.columns.find((c) => hasRole(c, "done"));
		const stale = allCards.filter(
			(c) => c.columnId !== doneCol?.id && new Date(c.updatedAt) < staleThreshold
		);

		// Blocked cards
		const blocked = allCards.filter((c) => c.relationsTo.length > 0);

		const daysDiff = Math.max(1, Math.ceil((Date.now() - sinceDate.getTime()) / 86400000));

		const lines = [
			`# Sprint Review — ${board.project.name} / ${board.name}`,
			`Period: ${sinceDate.toLocaleDateString()} → now (${daysDiff} days)`,
			"",
			`## Velocity`,
			`Cards completed: ${completedCount} (~${(completedCount / daysDiff).toFixed(1)}/day)`,
			"",
			`## Milestones`,
			...board.project.milestones.map((ms) => {
				return `- ${ms.name}: ${ms._count.cards} cards${ms.targetDate ? ` (target: ${ms.targetDate.toLocaleDateString()})` : ""}`;
			}),
			"",
		];

		if (blocked.length > 0) {
			lines.push(`## Blocked (${blocked.length})`);
			for (const c of blocked) {
				const blockers = c.relationsTo.map((r) => `#${r.fromCard.number}`).join(", ");
				lines.push(`- #${c.number} ${c.title} ← blocked by ${blockers}`);
			}
			lines.push("");
		}

		if (stale.length > 0) {
			lines.push(`## Stale Cards (${stale.length})`);
			for (const c of stale.slice(0, 10)) {
				const days = Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 86400000);
				lines.push(`- #${c.number} ${c.title} (${days}d stale)`);
			}
			if (stale.length > 10) lines.push(`  ...and ${stale.length - 10} more`);
			lines.push("");
		}

		lines.push(
			"## Actions",
			"Review stale cards — move to Parking Lot or update. Unblock blocked cards. Check milestone progress."
		);

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: lines.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"plan-work",
	{
		title: "Plan Work",
		description:
			"Create a structured plan for upcoming work. Returns a template you can fill in and execute with bulkCreateCards.",
		argsSchema: {
			boardId: z.string().describe("Board ID to plan for"),
		},
	},
	async ({ boardId }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: true,
				columns: { select: { name: true } },
			},
		});

		if (!board) {
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};
		}

		const columnNames = board.columns.map((c) => c.name).join(", ");

		const template = [
			`# Planning — ${board.project.name} / ${board.name}`,
			"",
			`Columns: ${columnNames}`,
			`Board ID: \`${boardId}\` | Project ID: \`${board.project.id}\``,
			"",
			"Use `runTool('bulkCreateCards', {...})` to batch-create cards.",
			"Use `runTool('addChecklistItem', {...})` to add sub-tasks.",
			"",
			"Templates via `runTool('createCardFromTemplate', {...})`:",
			"Bug Report, Feature, Spike / Research, Tech Debt, Epic",
		];

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: template.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"setup-project",
	{
		title: "Setup Project",
		description:
			"Guide for setting up a new project on the tracker board. Use this when connecting a project for the first time.",
		argsSchema: {
			projectName: z.string().describe("Name of the project to set up"),
		},
	},
	async ({ projectName }) => {
		const existing = await db.project.findFirst({
			where: { name: { equals: projectName } },
			include: { boards: { include: { columns: true } } },
		});

		const instructions = [`# Project Setup — ${projectName}`, ""];

		if (existing) {
			instructions.push(
				`Project "${projectName}" already exists (ID: \`${existing.id}\`).`,
				existing.boards.length > 0
					? `It has ${existing.boards.length} board(s): ${existing.boards.map((b) => `"${b.name}" (\`${b.id}\`)`).join(", ")}`
					: "It has no boards yet — create one with a descriptive name.",
				"",
				"Skip to Step 3 below to populate the board."
			);
		} else {
			instructions.push(
				"## Step 1: Create the project",
				"",
				`Use \`runTool('createProject', { name: "${projectName}", description: "..." })\``,
				"This creates a default board with standard columns (Backlog, In Progress, Review, Done, Parking Lot).",
				""
			);
		}

		instructions.push(
			"",
			"## Step 2: Populate the board",
			"",
			"Read the project's README, CLAUDE.md, and `git log --oneline -20` to understand state.",
			"Then create cards: Completed→Done, Active→In Progress, Next/Future→Backlog (drag the most important to the top), Ideas→Parking Lot.",
			"Use `runTool('bulkCreateCards', {...})` to batch-create.",
			"",
			"## Step 3: Add to the project's CLAUDE.md",
			"",
			"```",
			"## Project Tracking",
			"This project uses the `project-tracker` MCP tools.",
			"Use the `resume-session` prompt with the board ID at the start of each conversation.",
			"Use `end-session` before wrapping up to save handoff for the next session.",
			'Reference cards by #number (e.g. "working on #7").',
			"```",
			"",
			"Keep cards PR-sized. Use tags (`feature:X`, `bug`, `debt`). Use `getTools()` to discover all tools."
		);

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: instructions.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"holistic-review",
	{
		title: "Holistic Review",
		description:
			"Review the entire board against the actual codebase. Syncs board state with reality.",
		argsSchema: {
			boardId: z.string().describe("Board ID to review"),
		},
	},
	async ({ boardId }) => {
		const board = await db.board.findUnique({
			where: { id: boardId },
			include: {
				project: {
					include: { milestones: { orderBy: { position: "asc" } } },
				},
				columns: {
					orderBy: { position: "asc" },
					include: {
						cards: {
							orderBy: { position: "asc" },
							include: {
								checklists: true,
								milestone: { select: { id: true, name: true } },
								_count: { select: { comments: true } },
							},
						},
					},
				},
			},
		});

		if (!board) {
			return {
				messages: [
					{ role: "user" as const, content: { type: "text" as const, text: "Board not found." } },
				],
			};
		}

		const boardState = board.columns.map((col) => ({
			column: col.name,
			cards: col.cards.map((c) => ({
				ref: `#${c.number}`,
				title: c.title,
				description: c.description?.substring(0, 200),
				priority: c.priority,
				tags: JSON.parse(c.tags),
				milestone: c.milestone?.name ?? null,
				checklist: `${c.checklists.filter((i) => i.completed).length}/${c.checklists.length}`,
			})),
		}));

		const milestones = board.project.milestones.map((m) => ({
			name: m.name,
			targetDate: m.targetDate,
			description: m.description,
		}));

		const boardStateToon = toToon(boardState);

		const prompt = [
			`# Holistic Board Review — ${board.project.name} / ${board.name}`,
			"",
			`Board ID: \`${boardId}\` | Project ID: \`${board.project.id}\``,
			"",
			"## Current Board State (TOON encoded)",
			"```",
			boardStateToon,
			"```",
			"",
			milestones.length > 0 ? `## Milestones\n${JSON.stringify(milestones, null, 2)}\n` : "",
			"## Instructions",
			"",
			"Review the codebase thoroughly and compare it against the board state above. For each finding, take action:",
			"",
			"1. **Untracked work**: If you find code not represented by any card → `createCard`",
			"2. **Stale cards**: If a card is clearly done in code but not in Done column → `moveCard`",
			"3. **Outdated descriptions**: If a card doesn't match code reality → `updateCard`",
			"4. **Missing context**: Architecture decisions or important context → `addComment`",
			"5. **Priority misalignment**: If priorities don't reflect codebase needs → `updateCard`",
			"6. **Milestone alignment**: Ungrouped cards that belong to a milestone → `updateCard({ milestoneName })`",
			"7. **Checklist updates**: Items completed in code → `runTool('toggleChecklistItem', ...)`",
			"",
			"Explore codebase structure and key files, compare against board, take corrective actions, then summarize changes.",
		];

		return {
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: prompt.join("\n") },
				},
			],
		};
	}
);

server.registerPrompt(
	"onboarding",
	{
		title: "Onboarding",
		description:
			"Guide a new user through setup. 'tutorial' seeds a sample project to explore; 'quickstart' helps create their first real project.",
		argsSchema: {
			mode: z
				.enum(["tutorial", "quickstart"])
				.describe(
					"'tutorial' creates a sample project to explore; 'quickstart' starts a real project"
				),
		},
	},
	async ({ mode }) => {
		if (mode === "tutorial") {
			const result = await seedTutorialProject(db);
			if (result) {
				const text = [
					"# Welcome to Project Tracker! 🎓",
					"",
					`I've created a tutorial project for you to explore. Use the **resume-session** prompt with boardId \`${result.boardId}\` to see the board.`,
					"",
					"## What's inside",
					"",
					'The "Learn Project Tracker" project has **17 cards** across all 6 columns, each teaching a different feature:',
					"",
					"- **Cards & columns** — how tasks flow from Backlog → Done",
					"- **Checklists** — break cards into subtasks (card #6 has a partial checklist)",
					"- **Milestones** — group related cards (cards #10, #11)",
					"- **Card relations** — blocking dependencies (#8 blocks #7)",
					"- **Comments** — discussion threads on cards",
					"- **Decision records** — document architectural choices",
					"- **Session handoffs** — continuity between agent sessions",
					"- **Notes** — project-level knowledge base",
					"- **Tags & priorities** — organize and filter cards",
					"- **Parking Lot** — ideas you're not ready to work on",
					"",
					"## Try these",
					"",
					`1. \`resume-session\` with boardId \`${result.boardId}\` to see the full board`,
					"2. Open a card to read its description — each one explains the feature",
					"3. Try moving a card, adding a checklist item, or creating a comment",
					"4. Use `getTools` to discover all available tools",
				].join("\n");
				return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
			}
			// Already exists
			const existing = await db.project.findUnique({
				where: { slug: "learn-project-tracker" },
				include: { boards: { take: 1 } },
			});
			const boardId = existing?.boards[0]?.id ?? "unknown";
			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: `Tutorial project already exists. Use **resume-session** with boardId \`${boardId}\` to explore it.`,
						},
					},
				],
			};
		}

		// quickstart mode
		const text = [
			"# Quick Start — Create Your First Project",
			"",
			"Let's set up a real project. I need a few details:",
			"",
			'1. **Project name** — What are you building? (e.g. "My App", "Website Redesign")',
			'2. **Board name** — Optional, defaults to "Main Board"',
			"3. **Initial columns** — A board starts with: Backlog, In Progress, Review, Done, Parking Lot",
			"",
			"Once you tell me the project name, I'll:",
			"- Create the project with `createProject`",
			"- The board and columns are created automatically",
			"- Then use `resume-session` to load the board",
			"",
			"## After setup",
			"",
			"- **Create cards**: describe tasks and I'll create them with `createCard` or `bulkCreateCards`",
			"- **Organize**: set priorities, add tags, group into milestones",
			"- **Track progress**: move cards through columns, check off subtasks",
			"- **Handoffs**: I'll save a session summary when we're done so the next session picks up where we left off",
			"",
			"What's your project name?",
		].join("\n");
		return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
	}
);

// ─── Resources ────────────────────────────────────────────────────
registerResources(server);

// ─── Start ──────────────────────────────────────────────────────────

async function main() {
	// Initialize FTS5 virtual table for cross-source knowledge search.
	// db.ts also fires this fire-and-forget at startup; awaiting here ensures
	// the table exists before we accept tool calls.
	await initFts5(db).catch((e) => console.error("FTS5 init failed (non-fatal):", e));

	// Populate AGENT_NAME from client handshake when the env var wasn't set.
	server.server.oninitialized = () => {
		resolveAgentNameFromClient(server.server.getClientVersion()?.name);
		const source = getAgentNameSource();
		if (source === "default") {
			console.error(
				"Warning: AGENT_NAME env var not set and MCP client provided no name — activity rows will be labeled 'Agent'."
			);
		} else {
			console.error(`Agent identity: ${AGENT_NAME} (from ${source})`);
		}
	};

	const transport = new StdioServerTransport();
	await server.connect(transport);
	const sha = await getCommitSha();
	const shaShort = sha ? sha.slice(0, 7) : "unknown";
	console.error(
		`Project Tracker MCP v${MCP_SERVER_VERSION} — ${ESSENTIAL_TOOLS.length} essentials + ${getRegistrySize()} extended, schema v${SCHEMA_VERSION}, commit ${shaShort}`
	);
}

main().catch((error) => {
	console.error("Failed to start MCP server:", error);
	process.exit(1);
});
