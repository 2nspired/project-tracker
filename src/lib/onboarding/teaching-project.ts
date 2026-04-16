/**
 * Pure data definition for the "Learn Project Tracker" tutorial project.
 * 17 cards across all columns, each teaching one feature.
 * No Prisma or runtime imports — just plain objects.
 */

export const TUTORIAL_SLUG = "learn-project-tracker";

export const teachingProject = {
	name: "Learn Project Tracker",
	slug: TUTORIAL_SLUG,
	description:
		"A hands-on tutorial that teaches you every feature of Project Tracker. Each card covers one capability — read, explore, and move cards as you learn!",
	color: "blue",

	board: {
		name: "Tutorial Board",
		description: "Your learning workspace — each card teaches one feature",
	},

	milestone: {
		name: "Getting Started",
		description: "Complete these cards to learn the basics of Project Tracker",
	},

	/** Card numbers attached to the "Getting Started" milestone */
	milestoneCards: [10, 11] as number[],

	cards: [
		// ── Done (3) — concepts demonstrated by their existence ──────────
		{
			title: "Welcome to Project Tracker",
			description: [
				"**What:** Cards are the building blocks of Project Tracker. Each one represents a task, feature, bug, or idea.",
				"**When to use:** Create a card whenever you have work to track — from quick fixes to large features.",
				"**How to try:** You're reading one now! Click any card on the board to open its details.",
				"**Tip:** Cards are auto-numbered per project. No need to assign IDs yourself.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Understanding Columns",
			description: [
				"**What:** Columns represent workflow stages. The default board has: Backlog → Up Next → In Progress → Review → Done, plus a Parking Lot.",
				"**When to use:** Move cards between columns to reflect their current status.",
				"**How to try:** Look at the board — cards in each column are at that stage of work.",
				"**Tip:** The Parking Lot is special — it's for ideas you want to save but aren't ready to prioritize.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Moving Cards Between Columns",
			description: [
				"**What:** Drag and drop cards between columns to update their status as work progresses.",
				"**When to use:** When you start working on something (→ In Progress), finish it (→ Done), or need review (→ Review).",
				"**How to try:** Grab any card and drag it to another column, then drag it back.",
				"**Tip:** You can also reorder cards within a column by dragging them up or down.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},

		// ── In Progress (3) — things to explore ─────────────────────────
		{
			title: "Set Card Priorities",
			description: [
				"**What:** Priorities help you focus on what matters most. Levels: None, Low, Medium, High, Urgent.",
				"**When to use:** Set priority when a card needs attention relative to others. Not everything needs a priority.",
				"**How to try:** Open this card's details and change its priority. Notice how the priority badge appears on the board.",
				"**Tip:** Use Urgent sparingly — if everything is urgent, nothing is.",
			].join("\n\n"),
			column: "In Progress",
			priority: "HIGH",
			tags: ["tutorial", "organization"],
			createdBy: "AGENT",
		},
		{
			title: "Write Rich Descriptions",
			description: [
				"**What:** Card descriptions support full Markdown — headings, lists, code blocks, links, and more.",
				"**When to use:** Add descriptions to provide context, acceptance criteria, or implementation notes.",
				"**How to try:** Edit this card's description. Try adding:",
				"- A bullet list",
				"- A `code snippet`",
				"- A [link](https://example.com)",
				"",
				"**Tip:** Good descriptions save time — future-you (or your AI assistant) will thank you.",
			].join("\n"),
			column: "In Progress",
			priority: "MEDIUM",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Break Work into Checklists",
			description: [
				"**What:** Checklists let you break a card into smaller steps and track progress.",
				"**When to use:** When a card has multiple subtasks that need to be completed individually.",
				"**How to try:** Open this card — it has a checklist with some items already checked. Toggle the remaining items!",
				"**Tip:** The board shows checklist progress (e.g., 2/4) so you can see status at a glance.",
			].join("\n\n"),
			column: "In Progress",
			priority: "MEDIUM",
			tags: ["tutorial", "organization"],
			createdBy: "AGENT",
		},

		// ── Up Next (4) — features to try next ──────────────────────────
		{
			title: "Connect Related Cards",
			description: [
				'**What:** Card relations link related work together. Types: "blocks" (dependency), "related" (associated), and "parent" (hierarchy).',
				"**When to use:** When one card depends on another, or cards are conceptually related.",
				'**How to try:** Open this card — it shows a "blocked by #8" indicator. Card #8 must be completed before this one can proceed.',
				"**Tip:** Blocked cards show a special indicator on the board, making dependencies visible at a glance.",
			].join("\n\n"),
			column: "Up Next",
			priority: "MEDIUM",
			tags: ["tutorial", "relations"],
			createdBy: "AGENT",
		},
		{
			title: "Configure Development Tools",
			description: [
				'**What:** This card demonstrates blocking relationships. It blocks card #7 ("Connect Related Cards").',
				"**When to use:** Create blocking relations when work has a strict order — one task must finish before another can start.",
				'**How to try:** Open this card to see the "blocks #7" relation. Try completing this card first, then work on #7.',
				'**Tip:** Use "blocks" for hard dependencies and "related" for soft associations.',
			].join("\n\n"),
			column: "Up Next",
			priority: "HIGH",
			tags: ["tutorial", "relations"],
			createdBy: "AGENT",
		},
		{
			title: "Organize with Tags",
			description: [
				"**What:** Tags are flexible labels you can add to any card for filtering and organization.",
				'**When to use:** Use tags for cross-cutting concerns: feature areas, sprint labels, card types, or any custom grouping.',
				'**How to try:** Look at the tags on this card and others. Notice how tutorial cards all share the "tutorial" tag.',
				'**Tip:** Tags are free-form text — use consistent naming (e.g., "feature:auth", "bug", "dx") for easy filtering.',
			].join("\n\n"),
			column: "Up Next",
			priority: "LOW",
			tags: ["tutorial", "organization", "feature:tags"],
			createdBy: "AGENT",
		},
		{
			title: "Plan with Milestones",
			description: [
				"**What:** Milestones group cards into larger goals with optional target dates. Track progress across multiple cards.",
				"**When to use:** When you have a goal that spans several cards — like a release, sprint, or feature set.",
				'**How to try:** This card is attached to the "Getting Started" milestone. Check the roadmap view to see milestone progress.',
				"**Tip:** Milestones show completion percentage based on how many attached cards are in the Done column.",
			].join("\n\n"),
			column: "Up Next",
			priority: "MEDIUM",
			tags: ["tutorial", "planning"],
			createdBy: "AGENT",
		},

		// ── Review (2) ──────────────────────────────────────────────────
		{
			title: "Add Comments & Collaborate",
			description: [
				"**What:** Comments let you discuss cards with your team or leave notes for your AI assistant.",
				"**When to use:** Record decisions, ask questions, share updates, or leave context for the next person.",
				"**How to try:** Open this card — it has example comments. Add your own comment to try it out!",
				"**Tip:** Comments from AI agents are labeled differently from human comments, so you can tell who said what.",
			].join("\n\n"),
			column: "Review",
			priority: "MEDIUM",
			tags: ["tutorial", "collaboration"],
			createdBy: "AGENT",
		},
		// ── Backlog (3) ─────────────────────────────────────────────────
		{
			title: "Record Architectural Decisions",
			description: [
				"**What:** Decision Records (ADRs) capture important technical decisions with context, alternatives, and rationale.",
				"**When to use:** When you make a significant technical choice — framework selection, database design, API patterns.",
				"**How to try:** Open this card — it has an attached decision record about using SQLite. Check the project's Decisions tab too.",
				"**Tip:** Decisions have statuses: proposed → accepted/rejected. You can supersede old decisions with new ones.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced"],
			createdBy: "AGENT",
		},
		{
			title: "Hand Off Between AI Sessions",
			description: [
				"**What:** Session Handoffs let AI agents save their working context — what they did, found, and suggest for next steps.",
				"**When to use:** At the end of an AI session, so the next session can pick up where the last one left off.",
				"**How to try:** Check the Session History panel on the board page. This project has a sample handoff.",
				"**Tip:** Handoffs include: working on, findings, next steps, and blockers — everything the next agent needs.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "ai"],
			createdBy: "AGENT",
		},
		{
			title: "Track Git Commits",
			description: [
				"**What:** Git integration links commits to cards automatically by detecting card references (e.g., #7) in commit messages.",
				"**When to use:** When your project has a connected git repository. Mention card numbers in commit messages to link them.",
				'**How to try:** Set a repo path on the project, then use git commit messages like "Fix bug in search #7" to auto-link.',
				"**Tip:** Use the code map tool to understand your codebase structure at a glance.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "git"],
			createdBy: "AGENT",
		},

		// ── Parking Lot (2) ─────────────────────────────────────────────
		{
			title: "The Parking Lot",
			description: [
				"**What:** The Parking Lot is a special column for ideas and items you want to save but aren't ready to work on.",
				"**When to use:** When you have an idea worth remembering but it's not a priority right now. It keeps your board clean.",
				'**How to try:** Drag any card here to "park" it. Cards in the Parking Lot don\'t count toward milestone progress.',
				"**Tip:** Review your Parking Lot periodically — some ideas become priorities, others can be deleted.",
			].join("\n\n"),
			column: "Parking Lot",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Explore More Features",
			description: [
				"**What:** Project Tracker has even more to discover! This card is a jumping-off point for advanced features.",
				"**When to use:** When you've completed the tutorial cards and want to go deeper.",
				"**How to try:** Explore these features:",
				"- **Dashboard** — overview of all projects",
				"- **Roadmap view** — timeline visualization",
				"- **Notes** — project documentation",
				"- **MCP tools** — AI integration via Model Context Protocol",
				"",
				"**Tip:** You can safely delete this tutorial project once you're comfortable. Create your own project to start tracking real work!",
			].join("\n"),
			column: "Parking Lot",
			priority: "NONE",
			tags: ["tutorial", "advanced"],
			createdBy: "AGENT",
		},
	],

	/** Card #6 gets a partial checklist (2/4 done) */
	checklists: [
		{
			cardNumber: 6,
			items: [
				{ text: "Create a card with a checklist", completed: true },
				{ text: "Mark some items as done", completed: true },
				{ text: "See progress on the board card", completed: false },
				{ text: "Complete all items to finish", completed: false },
			],
		},
	],

	/** Comments demonstrating collaboration */
	comments: [
		{
			cardNumber: 1,
			content:
				"Welcome! Work through the cards in order to learn all the features. Start with the cards in In Progress and move them to Done as you complete them.",
			authorType: "AGENT",
			authorName: "tutorial-bot",
		},
		{
			cardNumber: 11,
			content:
				"This is an example comment from a human. Use comments to discuss cards, ask questions, or share updates.",
			authorType: "HUMAN",
			authorName: "Tutorial User",
		},
		{
			cardNumber: 11,
			content:
				"And this is a comment from an AI agent! Notice the different author label. AI agents can leave context about their work.",
			authorType: "AGENT",
			authorName: "tutorial-bot",
		},
	],

	/** Card #8 blocks card #7 */
	relations: [
		{ fromCardNumber: 8, toCardNumber: 7, type: "blocks" as const },
	],

	/** Decision record attached to card #13 */
	decision: {
		cardNumber: 13,
		title: "Use SQLite for local-first data storage",
		status: "accepted",
		decision:
			"All project data is stored in a local SQLite database file (tracker.db). No external database server required.",
		alternatives: [
			"PostgreSQL — more powerful but requires a running server",
			"MongoDB — flexible schema but adds operational complexity",
			"JSON files — simple but no query capabilities or ACID guarantees",
		],
		rationale:
			"SQLite provides full SQL capabilities with zero setup. The database is a single file that can be backed up by copying. This aligns with our local-first philosophy — your data stays on your machine.",
		author: "AGENT",
	},

	/** Sample session handoff */
	handoff: {
		agentName: "tutorial-bot",
		summary:
			"Created the tutorial project with 17 example cards demonstrating all Project Tracker features.",
		workingOn: ["Setting up tutorial cards across all columns"],
		findings: [
			"All features working correctly",
			"Board has 6 default columns",
		],
		nextSteps: [
			'Work through the tutorial cards starting from "In Progress"',
			"Try creating your own project when ready",
		],
		blockers: [],
	},

	/** Best practices note */
	note: {
		title: "Best Practices",
		content: [
			"# Project Tracker Best Practices",
			"",
			"## Card Hygiene",
			"- Keep card titles short and actionable",
			"- Add descriptions with context and acceptance criteria",
			"- Use checklists to break down complex cards",
			"- Update card status as work progresses",
			"",
			"## Organization",
			"- Use tags consistently across cards",
			"- Set priorities to focus on what matters",
			"- Review the Parking Lot periodically",
			"- Archive completed milestones",
			"",
			"## AI Collaboration",
			"- Assign cards to agents for AI-assisted work",
			"- Use session handoffs to maintain context between sessions",
			"- Record architectural decisions for future reference",
			"- Leave comments with context an AI can understand",
		].join("\n"),
		tags: ["best-practices", "tips"],
	},
};
