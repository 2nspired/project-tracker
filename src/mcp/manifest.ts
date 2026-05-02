import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAllExtendedTools } from "./tool-registry.js";
import { SCHEMA_VERSION } from "./utils.js";

const execFileAsync = promisify(execFile);

export const MCP_SERVER_VERSION = "6.1.0";

/**
 * Source of truth for what counts as an essential tool.
 *
 * Anything registered via `server.registerTool` (McpServer SDK). Anything in
 * the tool-registry Map is extended. When you add or remove an essential,
 * update this list — the manifest resource, docs, and briefMe all read from
 * here.
 */
export const ESSENTIAL_TOOLS: Array<{ name: string; description: string }> = [
	{
		name: "briefMe",
		description:
			"One-shot session primer — handoff, diff, top work, blockers, recent decisions, pulse.",
	},
	{
		name: "saveHandoff",
		description:
			"Session wrap-up — saves handoff, links commits, reports touched cards, returns resume prompt.",
	},
	{ name: "createCard", description: "Create a card in a column (by name)." },
	{ name: "updateCard", description: "Update card fields; optional `intent`." },
	{ name: "moveCard", description: "Move a card to a column. Requires `intent`." },
	{
		name: "addComment",
		description:
			"Add a markdown comment to a card. Surfaces in `getCardContext` for future agents.",
	},
	{
		name: "registerRepo",
		description:
			"Bind a git repo path to a project (call after briefMe returns needsRegistration).",
	},
	{
		name: "checkOnboarding",
		description: "Detect DB state, list projects/boards, session-start discovery.",
	},
	{ name: "getTools", description: "Browse extended tools by category." },
	{ name: "runTool", description: "Execute any extended tool by name." },
];

let cachedCommitSha: string | null | undefined;

async function readHeadSha(): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
			cwd: process.cwd(),
			timeout: 2000,
		});
		return stdout.trim();
	} catch {
		return null;
	}
}

/**
 * Commit SHA of the running server build — captured at first call and
 * frozen for the process lifetime. Use this for boot logs and any
 * "what build is talking to me" checks.
 */
export async function getCommitSha(): Promise<string | null> {
	if (cachedCommitSha !== undefined) return cachedCommitSha;
	cachedCommitSha = await readHeadSha();
	return cachedCommitSha;
}

/**
 * Current HEAD SHA, read fresh every call. Comparing against getCommitSha()
 * detects drift between a long-lived server process and a repo that has
 * moved forward (user pulled or committed while the server was running).
 */
export async function getCurrentHeadSha(): Promise<string | null> {
	return readHeadSha();
}

/**
 * Resources that don't depend on database state — always present, always
 * advertised. Database-derived resources (boards, cards, handoffs, decisions,
 * status) are intentionally omitted from this list because their availability
 * is per-row; clients discover them via the MCP `resources/list` protocol.
 *
 * When you add a static resource to `src/mcp/resources.ts`, add it here so
 * `briefMe`/`checkOnboarding` make it discoverable in the manifest.
 */
export const STATIC_RESOURCES: Array<{
	uri: string;
	mimeType: string;
	description: string;
}> = [
	{
		uri: "tracker://server/manifest",
		mimeType: "application/json",
		description:
			"Machine-readable snapshot of this MCP server's version, schema, commit, and full tool surface.",
	},
	{
		uri: "tracker://server/agent-guide",
		mimeType: "text/markdown",
		description:
			"Project-agnostic guide for any AI agent using Pigeon. Live `fs.readFile` of docs/AGENT-GUIDE.md — no copy, no cache.",
	},
];

export type ServerManifest = {
	version: string;
	schemaVersion: number;
	commitSha: string | null;
	counts: {
		essential: number;
		extended: number;
	};
	essentials: Array<{ name: string; description: string }>;
	extended: Array<{
		name: string;
		category: string;
		description: string;
		readOnly: boolean;
		destructive: boolean;
	}>;
	resources: Array<{ uri: string; mimeType: string; description: string }>;
};

export async function buildServerManifest(): Promise<ServerManifest> {
	const extended = getAllExtendedTools();
	return {
		version: MCP_SERVER_VERSION,
		schemaVersion: SCHEMA_VERSION,
		commitSha: await getCommitSha(),
		counts: {
			essential: ESSENTIAL_TOOLS.length,
			extended: extended.length,
		},
		essentials: ESSENTIAL_TOOLS,
		extended,
		resources: STATIC_RESOURCES,
	};
}
