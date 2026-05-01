// Workflow registry — single source of truth for named, multi-step procedures
// agents should run at lifecycle moments. The `listWorkflows` MCP tool reads
// from this file; future surfaces (MCP prompts, docs site) can read from here
// without duplication.
//
// Workflows are *recipes* — ordered tool calls with intent — not tools.
// Tool reference lives in `getTools`. Workflows tell an agent which tools
// to call in which order, and why.
//
// Adding a workflow: append to WORKFLOWS, ensure each step's `tool` matches
// a registered MCP tool (essential or extended). Run `tsx scripts/smoke-workflows.ts`
// to validate — it asserts every step resolves and slash-command files exist.

export type WorkflowStep = {
	/** Tool name — must resolve to an essential or extended MCP tool. */
	tool: string;
	/** Why this step exists in the recipe — one short sentence, agent-facing. */
	intent: string;
	/** Optional precondition. When present, the step is conditional. */
	when?: string;
};

export type Workflow = {
	/** Stable identifier (camelCase). Treat as an external API — don't rename. */
	name: string;
	/** Short human label for UI / docs. */
	title: string;
	/** When an agent should run this workflow — the trigger or moment. */
	when: string;
	/** Ordered tool calls. */
	steps: WorkflowStep[];
	/** Claude Code slash command equivalent, if one exists in `.claude/commands/`. */
	slashCommand?: string;
};

export const WORKFLOWS: Workflow[] = [
	{
		name: "firstSession",
		title: "First session in a new repo",
		when: "You're connecting from a repo that hasn't been bound to a project yet — `briefMe` returned `needsRegistration`, or no project owns the current cwd.",
		steps: [
			{
				tool: "checkOnboarding",
				intent: "Detect DB state, list projects, find a candidate project to bind.",
			},
			{
				tool: "registerRepo",
				intent: "Bind this repo path to the chosen project so future sessions auto-detect.",
				when: "The human picks an existing project to attach this repo to.",
			},
			{
				tool: "briefMe",
				intent: "Load the now-resolved board's session primer and start work.",
			},
		],
	},
	{
		name: "sessionStart",
		title: "Start a session on a bound repo",
		when: "Beginning a conversation in a repo that's already bound to a project.",
		slashCommand: "/brief-me",
		steps: [
			{
				tool: "briefMe",
				intent: "One-shot primer — last handoff, diff since, top work, blockers, decisions, pulse.",
			},
			{
				tool: "getCardContext",
				intent:
					"Deep context (description, comments, relations, decisions, commits) for the card you'll work on.",
				when: "You've picked a card from `topWork` or `handoff.nextSteps`.",
			},
		],
	},
	{
		name: "sessionEnd",
		title: "Wrap up a session",
		when: "Before ending a conversation — saves a handoff, links commits, returns a resume prompt for the next chat.",
		slashCommand: "/handoff",
		steps: [
			{
				tool: "moveCard",
				intent:
					"Reflect any column transitions for finished work — `saveHandoff` does NOT auto-move cards.",
				when: "You finished work on a card and the column doesn't already match reality.",
			},
			{
				tool: "addComment",
				intent: "Pin a card-specific blocker or decision the next agent needs to see.",
				when: "Something specific belongs on a card, not in the generic handoff blockers list.",
			},
			{
				tool: "saveHandoff",
				intent:
					"Save handoff, run syncGitActivity, report touched cards, and emit a resume prompt the human pastes into the next chat.",
			},
		],
	},
	{
		name: "recordDecision",
		title: "Capture an architectural decision",
		when: "You made a non-obvious choice that future agents need to know about — picked approach X over Y, accepted a tradeoff, established a convention.",
		steps: [
			{
				tool: "recordDecision",
				intent:
					"Persist the decision linked to the card it shaped. Use `supersedesId` if it replaces an earlier decision.",
			},
			{
				tool: "addComment",
				intent:
					"Leave a one-line summary on the card so reviewers see the decision inline without opening the decision record.",
				when: "The decision is anchored to a specific card.",
			},
		],
	},
	{
		name: "searchKnowledge",
		title: "Search across project knowledge",
		when: "You need to find prior context — past decisions, notes, handoffs, code facts, indexed repo markdown — before duplicating work.",
		steps: [
			{
				tool: "queryKnowledge",
				intent:
					"Full-text search across cards, comments, decisions, notes, handoffs, code facts, and indexed repo docs.",
			},
			{
				tool: "getCardContext",
				intent: "Pull deep context on cards surfaced by the search.",
				when: "A card hit looks relevant.",
			},
		],
	},
];

/** Look up a workflow by name. */
export function getWorkflow(name: string): Workflow | undefined {
	return WORKFLOWS.find((w) => w.name === name);
}
