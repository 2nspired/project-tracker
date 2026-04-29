export type CardTemplate = {
	name: string;
	title: string;
	description: string;
	priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
	tags: string[];
	checklist: string[];
};

export const cardTemplates: CardTemplate[] = [
	{
		name: "Bug Report",
		title: "Bug: ",
		description:
			"**What happened:**\n\n**Expected behavior:**\n\n**Steps to reproduce:**\n1. \n\n**Environment:**\n",
		priority: "HIGH",
		tags: ["bug"],
		checklist: ["Reproduce the issue", "Identify root cause", "Write fix", "Test fix"],
	},
	{
		name: "Feature",
		title: "Feature: ",
		description: "**Goal:**\n\n**Approach:**\n\n**Acceptance criteria:**\n- \n",
		priority: "MEDIUM",
		tags: ["feature"],
		checklist: ["Design approach", "Implement", "Add tests", "Update docs if needed"],
	},
	{
		name: "Spike / Research",
		title: "Spike: ",
		description:
			"**Question to answer:**\n\n**Time-box:** 2 hours\n\n**Options to evaluate:**\n1. \n\n**Decision:**\n",
		priority: "LOW",
		tags: ["spike"],
		checklist: [
			"Research options",
			"Prototype if needed",
			"Document findings",
			"Make recommendation",
		],
	},
	{
		name: "Tech Debt",
		title: "Refactor: ",
		description: "**Current state:**\n\n**Desired state:**\n\n**Why now:**\n",
		priority: "LOW",
		tags: ["debt"],
		checklist: ["Assess impact", "Refactor", "Verify no regressions"],
	},
	{
		name: "Epic",
		title: "Epic: ",
		description:
			"**Overview:**\n\n**Sub-tasks:**\nCreate individual cards for each sub-task and tag them with this epic tag.\n\n**Success criteria:**\n- \n",
		priority: "MEDIUM",
		tags: ["epic"],
		checklist: ["Break down into cards", "Prioritize sub-tasks", "Track progress"],
	},
];
