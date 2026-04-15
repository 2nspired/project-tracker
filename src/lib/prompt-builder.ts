/**
 * Card-to-Prompt generator — assembles a ready-to-paste prompt from card data.
 * Pure function, zero dependencies. Usable from both MCP and UI.
 */

export type PromptCardInput = {
	ref: string; // "#7"
	boardId: string;
	title: string;
	description: string | null;
	priority: string;
	tags: string[];
	assignee: string | null;
	milestone: string | null;
	column: string | null;
	checklist: Array<{ text: string; completed: boolean }>;
	decisions: Array<{ title: string; status: string; decision: string }>;
	blockedBy: Array<{ ref: string; title: string }>;
	blocks: Array<{ ref: string; title: string }>;
};

export function buildAgentPrompt(card: PromptCardInput): string {
	const lines: string[] = [];

	// ─── Header ───────────────────────────────────────────────────
	lines.push(`# Agent Task: ${card.ref} ${card.title}`);
	lines.push("");

	// ─── Report Back ──────────────────────────────────────────────
	lines.push("> **When done:** Move the card to Review and save a handoff.");
	lines.push("> Use `addComment` on the card to record decisions or blockers.");
	lines.push("");

	// ─── Context ──────────────────────────────────────────────────
	lines.push("## Context");
	lines.push("");

	const meta: string[] = [];
	if (card.priority && card.priority !== "NONE") meta.push(`**Priority:** ${card.priority}`);
	if (card.column) meta.push(`**Column:** ${card.column}`);
	if (card.milestone) meta.push(`**Milestone:** ${card.milestone}`);
	if (card.assignee) meta.push(`**Assignee:** ${card.assignee}`);
	if (card.tags.length > 0) meta.push(`**Tags:** ${card.tags.join(", ")}`);
	if (meta.length > 0) {
		lines.push(meta.join("  \n"));
		lines.push("");
	}

	// ─── Task ─────────────────────────────────────────────────────
	lines.push("## Task");
	lines.push("");

	if (card.description) {
		lines.push(card.description.trim());
		lines.push("");
	}

	// ─── Acceptance Criteria (from checklist) ─────────────────────
	const incomplete = card.checklist.filter((c) => !c.completed);
	const completed = card.checklist.filter((c) => c.completed);

	if (card.checklist.length > 0) {
		lines.push("## Acceptance Criteria");
		lines.push("");
		for (const item of incomplete) {
			lines.push(`- [ ] ${item.text}`);
		}
		for (const item of completed) {
			lines.push(`- [x] ${item.text}`);
		}
		lines.push("");
	}

	// ─── Decisions Already Made ───────────────────────────────────
	const activeDecisions = card.decisions.filter((d) => d.status !== "superseded" && d.status !== "rejected");
	if (activeDecisions.length > 0) {
		lines.push("## Decisions Already Made");
		lines.push("");
		for (const d of activeDecisions) {
			lines.push(`- **${d.title}** (${d.status}): ${d.decision}`);
		}
		lines.push("");
	}

	// ─── Dependencies ─────────────────────────────────────────────
	if (card.blockedBy.length > 0 || card.blocks.length > 0) {
		lines.push("## Dependencies");
		lines.push("");
		for (const dep of card.blockedBy) {
			lines.push(`- **Blocked by** ${dep.ref} ${dep.title}`);
		}
		for (const dep of card.blocks) {
			lines.push(`- **Blocks** ${dep.ref} ${dep.title}`);
		}
		lines.push("");
	}

	// ─── Board Connection ─────────────────────────────────────────
	lines.push("## Board Connection");
	lines.push("");
	lines.push("This card is tracked on a Project Tracker board via MCP.");
	lines.push(`Use \`loadHandoff({ boardId: "${card.boardId}" })\` for session context.`);
	lines.push(`Reference this card as \`${card.ref}\` in comments and moves.`);
	lines.push("");

	return lines.join("\n").trimEnd() + "\n";
}
