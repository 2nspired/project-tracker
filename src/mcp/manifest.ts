import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAllExtendedTools } from "./tool-registry.js";
import { SCHEMA_VERSION } from "./utils.js";

const execFileAsync = promisify(execFile);

export const MCP_SERVER_VERSION = "2.2.0";

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
			"One-shot session primer — handoff, diff, top work, blockers, open decisions, pulse.",
	},
	{ name: "createCard", description: "Create a card in a column (by name)." },
	{ name: "updateCard", description: "Update card fields; optional `intent`." },
	{ name: "moveCard", description: "Move a card to a column. Requires `intent`." },
	{ name: "addComment", description: "Add a comment to a card." },
	{
		name: "checkOnboarding",
		description: "Detect DB state, list projects/boards, session-start discovery.",
	},
	{ name: "getTools", description: "Browse extended tools by category." },
	{ name: "runTool", description: "Execute any extended tool by name." },
];

let cachedCommitSha: string | null | undefined;

export async function getCommitSha(): Promise<string | null> {
	if (cachedCommitSha !== undefined) return cachedCommitSha;
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
			cwd: process.cwd(),
			timeout: 2000,
		});
		cachedCommitSha = stdout.trim();
	} catch {
		cachedCommitSha = null;
	}
	return cachedCommitSha;
}

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
	};
}
