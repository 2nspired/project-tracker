// Slash-command catalog — the UI-facing inventory of Claude Code slash
// commands that ship in `.claude/commands/`. Each entry maps a `/name`
// to one or more underlying MCP tool calls so users can discover the
// actual entry points (`/brief-me`, `/handoff`, `/plan-card`) instead of
// just the raw MCP tools.
//
// Source of truth for tool wiring is `src/mcp/workflows.ts` — workflows
// with a `slashCommand` field. We keep the curated `common` flag and
// the `/plan-card` entry (which has its own MCP tool, not a workflow)
// here in the UI layer so the MCP module stays read-only from the web
// surface and Webpack/Turbopack never has to resolve `.js`-suffixed MCP
// imports.
//
// Coordination note (card #151): `endSession` is being renamed to
// `saveHandoff`. Until that workflow change lands, we translate the old
// name on the way out so UI surfaces always show the canonical name.

import { WORKFLOWS, type Workflow } from "@/mcp/workflows";

export type SlashCommand = {
	/** Slash-command syntax as users type it, e.g. `/brief-me`. */
	name: string;
	/** One-line description suitable for a row in a command palette. */
	description: string;
	/** Underlying MCP tool name(s) the command runs. */
	tools: string[];
	/** Curated shortlist flag — the few commands surfaced in compact UIs. */
	common: boolean;
};

// Curated `common` set — kept tiny on purpose. These are the three
// commands a working agent reaches for at session boundaries. Adding
// more here dilutes the "essentials" promise of the Cmd-K row above
// the MCP catalog.
const COMMON: ReadonlySet<string> = new Set(["/brief-me", "/handoff", "/plan-card"]);

// Pre-rename → post-rename tool aliasing. When workflow steps still
// reference `endSession`, surface `saveHandoff` instead so the UI is
// already correct on day one of the rename rollout.
const TOOL_ALIASES: Record<string, string> = {
	endSession: "saveHandoff",
};

const DESCRIPTIONS: Record<string, string> = {
	"/brief-me": "Start a session — load the latest handoff, top work, blockers, and pulse.",
	"/handoff":
		"Wrap a session — save handoff, link commits, report touched cards, emit resume prompt.",
	"/plan-card":
		"Plan a card — load context + tracker.md policy + investigation hints, draft the four-section plan.",
};

function uniqueTools(workflow: Workflow): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const step of workflow.steps) {
		const aliased = TOOL_ALIASES[step.tool] ?? step.tool;
		if (seen.has(aliased)) continue;
		seen.add(aliased);
		ordered.push(aliased);
	}
	return ordered;
}

function fromWorkflows(): SlashCommand[] {
	const commands: SlashCommand[] = [];
	for (const workflow of WORKFLOWS) {
		if (!workflow.slashCommand) continue;
		commands.push({
			name: workflow.slashCommand,
			description: DESCRIPTIONS[workflow.slashCommand] ?? workflow.title,
			tools: uniqueTools(workflow),
			common: COMMON.has(workflow.slashCommand),
		});
	}
	return commands;
}

// `/plan-card` is a tool, not a workflow — so it doesn't appear in
// WORKFLOWS. We surface it explicitly so users see the same three
// session-boundary shortcuts in the UI that the docs promise.
const STANDALONE: SlashCommand[] = [
	{
		name: "/plan-card",
		description:
			DESCRIPTIONS["/plan-card"] ??
			"Plan a card — load context + tracker.md policy + investigation hints.",
		tools: ["planCard"],
		common: COMMON.has("/plan-card"),
	},
];

/**
 * Full slash-command catalog. Common commands first, then the rest in
 * the order workflows.ts defines them — stable across renders.
 */
export function getSlashCommands(): SlashCommand[] {
	const all = [...fromWorkflows(), ...STANDALONE];
	return all.sort((a, b) => {
		if (a.common !== b.common) return a.common ? -1 : 1;
		return 0;
	});
}
