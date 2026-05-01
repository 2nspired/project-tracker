/**
 * Pure data definition for the "Learn Pigeon" tutorial project.
 *
 * Dual-audience: every content card teaches both a human (UI action) and a
 * connected agent (MCP call), so the tutorial board works as a live demo
 * when a human watches their agent walk it.
 *
 * Card body convention:
 *   **What:** concept
 *   **Why it matters:** motivation
 *   **Try it (UI):** human action
 *   **Try it (agent):** exact MCP call with example args
 *   **Outcome:** observable change
 *
 * No Prisma or runtime imports — just plain objects.
 *
 * Note: TUTORIAL_SLUG stays as "learn-project-tracker" — it's the DB
 * idempotency guard for installs predating the rebrand.
 */

export const TUTORIAL_SLUG = "learn-project-tracker";

export const teachingProject = {
	name: "Learn Pigeon",
	slug: TUTORIAL_SLUG,
	description:
		"A 10-card hands-on tutorial. Each card teaches one capability from both the human (UI) and agent (MCP) angle — walk the board solo, or watch your connected agent walk it for you. Graduate by deleting this project and starting your own.",
	color: "blue",

	board: {
		name: "Tutorial Board",
		description:
			"Your learning workspace. Drag cards through the columns as you complete them; aim to finish in 10–15 minutes.",
	},

	cards: [
		// ── Done (2) — orientation ──────────────────────────────────────
		{
			title: "Welcome to Pigeon",
			description: [
				"**What:** Pigeon is a local-first kanban board with MCP tools that lets you and an AI agent share the same context. Each *card* is a unit of work; each card travels with you between sessions.",
				"**Why it matters:** The product is built around one loop: `briefMe` at session start (catch up), do the work, `saveHandoff` at session end (leave a trail for next time). Everything else — priorities, plans, costs, git — hangs off cards.",
				"**Try it (UI):** You're reading a card right now. Click around the board to see the three other Done/In Progress cards and the six Backlog cards. The whole tutorial is 10 cards — it's the demo.",
				"**Try it (agent):** `briefMe()` — the first call of every session. Returns the last handoff, top work, blockers, decisions, and a pulse line in ~300–500 tokens instead of dumping the full board.",
				"**Outcome:** You've experienced one card. Your agent has a session snapshot it can act on without re-reading everything.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "How columns work",
			description: [
				"**What:** The board has four columns: **Backlog** (queued), **In Progress** (active focus), **Done** (shipped), **Parking Lot** (deferred — invisible to ranking).",
				"**Why it matters:** `briefMe` ranks topWork as In Progress first, then the **top three positions in Backlog** as your hand-curated priority queue (those surface as `source: 'pinned'`), then everything else by score. Backlog *position* is the priority knob — drag a card to the top to mean *I want this next*. No separate column needed.",
				"**Try it (UI):** Each column header shows a count. Drag a Backlog card up to position 1 to pin it. Drag any card across columns to feel the snap.",
				"**Try it (agent):** `briefMe()` and look at the `topWork[]` entries — each has `source: 'active' | 'pinned' | 'scored'`. Cards in the Parking Lot never appear here.",
				"**Outcome:** You understand WIP discipline (limit In Progress) and how Backlog position acts as the priority signal.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},

		// ── In Progress (1) — your first action ─────────────────────────
		{
			title: "Start here: briefMe is your first call",
			description: [
				"**What:** `briefMe` is the session primer. It returns the last handoff, the diff since that handoff, top work ranked across columns, open blockers, recent decisions on still-active cards, and a one-line pulse — plus a token-cost summary if tracking is on.",
				"**Why it matters:** It replaces the old habit of dumping the entire board. Roughly 300–500 tokens vs. thousands, and the ordering already tells you what to pick up. This is the single highest-leverage MCP call in Pigeon — it's why the project exists.",
				"**Try it (UI):** Humans can read the same data on the Dashboard's Focus panel. The Sessions tab shows past handoffs that fed prior `briefMe` calls.",
				"**Try it (agent):** `briefMe()` with no args — the board is auto-detected from the current git repo *after* `registerRepo` has been run for that project (see card #7). Pass `{ boardId }` to override.",
				"**Outcome:** You get a session snapshot plus a `_hint` line suggesting whether to follow `handoff.nextSteps` or pick from `topWork[]`. From there, drag this card to Done and pick up card #4.",
			].join("\n\n"),
			column: "In Progress",
			priority: "HIGH",
			tags: ["tutorial", "mcp", "session"],
			createdBy: "AGENT",
		},

		// ── Backlog (6) — the curriculum, work top to bottom ────────────
		{
			title: "Cards 101: priority, description, checklists",
			description: [
				"**What:** Three core affordances every card supports. **Priority** (None/Low/Medium/High/Urgent) feeds the work-ranking score. **Description** is full Markdown — the durable brief an agent reads via `getCardContext`. **Checklists** break a card into subtasks with a glanceable progress counter on the board.",
				"**Why it matters:** Within a tier, a HIGH card outranks a LOW card — priority is the knob you use to tell your agent which work matters most. A good description (context + acceptance criteria) lets the agent act without re-asking. Checklists give an agent a ready-made plan and the human a 2/4 progress badge without opening the card.",
				"**Try it (UI):** Open this card. Change its priority to URGENT. Edit the description and add a code block. Below, toggle the partially-checked checklist items.",
				'**Try it (agent):** Three calls on this card:\n  1. `updateCard({ cardId: "#4", priority: "URGENT", intent: "Walking tutorial" })`\n  2. `updateCard({ cardId: "#4", description: "## Acceptance\\n- [ ] Walked Cards 101" })`\n  3. `runTool({ tool: "addChecklistItem", params: { cardId: "#4", text: "Newly discovered subtask" } })` — checklist tools are extended, hence `runTool`.',
				"**Outcome:** Priority badge updates, description renders, checklist counter changes on the card. The next `briefMe` call reflects the new priority in `topWork[]` ordering.",
			].join("\n\n"),
			column: "Backlog",
			priority: "HIGH",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Hand off between sessions (saveHandoff)",
			description: [
				"**What:** `saveHandoff` records what you worked on, what you found, what's next, and what's blocking — and (by default) auto-links new git commits, reports touched cards, and prints a copy-pasteable resume prompt for the next chat.",
				"**Why it matters:** Handoffs are what make multi-session agent work coherent. `briefMe` reads the latest handoff at session start — without one, the next agent starts cold and re-derives everything you already figured out. The session loop is *briefMe → work → saveHandoff → repeat*.",
				"**Try it (UI):** Open the Sessions page from the project sidebar. This project has a sample handoff already, plus the resume-prompt block you can copy.",
				'**Try it (agent):** End-of-session call: `saveHandoff({ summary: "Walked tutorial cards 1–5", nextSteps: ["Try planCard on #6", "Bind a real repo with registerRepo"] })`.\n\nMid-session checkpoint without git sync: `saveHandoff({ summary: "Halfway", nextSteps: ["..."], syncGit: false })`.',
				"**Outcome:** Your next `briefMe` call returns this handoff as `handoff.summary` + `handoff.nextSteps[]`. The next session picks up exactly where you left off — no cold start.",
			].join("\n\n"),
			column: "Backlog",
			priority: "HIGH",
			tags: ["tutorial", "mcp", "session"],
			createdBy: "AGENT",
		},
		{
			title: "Plan a card with planCard + tracker.md",
			description: [
				"**What:** Two pieces, designed to work together. **`tracker.md`** is a single Markdown file at your project's repo root with YAML front matter for machine-parsed policy (`intent_required_on`, per-column prompts) and a body for the project's general agent prompt — git-versioned, reviewable, rollback-able. **`planCard`** is an MCP tool that reads `tracker.md`, returns the card context plus investigation hints (URLs, file paths, `#nnn` refs extracted from the description), and a fixed 4-section protocol (`## Why now` / `## Plan` / `## Out of scope` / `## Acceptance`).",
				"**Why it matters:** Without them, every session re-derives the same recipe (load card → read policy → investigate → draft → confirm → publish). With them, every planned card emerges in the same shape — future humans and agents always find the plan in the same place. `planCard` refuses to overwrite a published plan; if the card already has the three required headers, it returns `_warnings[].code === \"PLAN_EXISTS\"` and omits the protocol.",
				"**Try it (UI):** This card is intentionally light on detail. Open it, drop a one-line vague intent into the description, then tell your agent `/plan-card #6` (the slash command wraps the MCP tool).",
				'**Try it (agent):** `runTool({ tool: "planCard", params: { boardId, cardId: "#6" } })`. Read the returned `protocol`, walk the four steps (investigate → synthesize → propose in chat → publish on confirm). Watch the activity strip — a `planning` event is stamped while the plan is in flight.',
				"**Outcome:** The card description becomes the canonical plan in four locked sections. Anyone (human or agent) opening the card later sees exactly what's planned, why, what's out of scope, and how to verify it shipped.",
			].join("\n\n"),
			column: "Backlog",
			priority: "MEDIUM",
			tags: ["tutorial", "mcp", "planning"],
			createdBy: "AGENT",
		},
		{
			title: "Connect your repo (registerRepo)",
			description: [
				"**What:** `registerRepo` binds a project to an absolute repo path on your machine. Once bound, Pigeon knows which board belongs to which working tree.",
				"**Why it matters:** Two big wins. (1) `briefMe` and other tools auto-detect the right project from `cwd` after binding — no need to pass `boardId` from anywhere inside that repo. (2) `saveHandoff` calls `syncGitActivity` automatically at wrap-up, so commits referencing `#N` get linked to card N without manual bookkeeping. Skip this step and `briefMe` returns `needsRegistration` until you bind.",
				"**Try it (UI):** Project settings → Repo path. Paste the absolute path to your project's git repo (or use the `connect.sh` helper from the project root).",
				'**Try it (agent):** Once per project: `registerRepo({ projectId, repoPath: "/Users/you/Projects/your-app" })`. After that, `briefMe()` with no args resolves the right board from any subdirectory of that repo.',
				"**Outcome:** `briefMe()` works without `boardId`. A commit message like `\"fix login bug #42\"` shows up under card #42's commits tab, and on the next `saveHandoff`, the touched-cards list reflects what you actually changed.",
			].join("\n\n"),
			column: "Backlog",
			priority: "MEDIUM",
			tags: ["tutorial", "mcp", "git"],
			createdBy: "AGENT",
		},
		{
			title: "Track your costs",
			description: [
				"**What:** Pigeon captures token usage per session and surfaces it as a per-project Costs page with four lenses: **overhead** (what Pigeon's own MCP responses cost you), **savings** (what `briefMe` saved vs. cold-loading the full board), **cost-per-shipped-card** (run-rate for delivery), and **model breakdown** (where the spend went).",
				"**Why it matters:** Knowing your token spend turns *Pigeon costs context tokens* into *Pigeon paid for itself* — measurable savings, not vibes. The Costs page is the one place where the value prop is concrete.",
				"**Try it (UI):** Open `/projects/<projectId>/costs` from this project's settings, or click Costs in the Project switcher. If it's empty, follow the in-page setup prompt to wire the Stop hook (one-time, ~30s).",
				'**Try it (agent):** `briefMe()` returns a `tokenPulse` object with `totalCostUsd` + `sessionCount`. For the savings lens specifically: `runTool({ tool: "getSavingsSummary", params: { projectId } })` — and `runTool({ tool: "recalibrateBaseline", params: { projectId } })` to refresh the baseline if the board has grown a lot since setup.',
				"**Outcome:** You can see per-card and per-session cost without leaving the app. The savings lens shows the dollar figure Pigeon kept out of your context window.",
			].join("\n\n"),
			column: "Backlog",
			priority: "MEDIUM",
			tags: ["tutorial", "costs", "ui"],
			createdBy: "AGENT",
		},
		{
			title: "Discover tools (? hotkey and getTools)",
			description: [
				"**What:** Only ~10 essentials are top-level MCP tools (the ones that ship in every session: `briefMe`, `createCard`, `updateCard`, `moveCard`, `saveHandoff`, etc.). Everything else — knowledge queries, milestone context, decision tools, checklist tools, claim writes — is *extended* and called through `runTool`. The UI mirrors this with a `?` hotkey that opens the Commands catalog.",
				"**Why it matters:** Keeps the top-level surface tiny and discoverable. An agent learns the common path quickly and reaches for the long tail only when needed. Browsing > guessing at tool names.",
				"**Try it (UI):** Press **`?`** anywhere in the app to open the Commands catalog. Search by tool name or category. Each entry has a short description and a deep link to its docs.",
				'**Try it (agent):** Three calls:\n  1. `getTools()` — lists categories.\n  2. `getTools({ category: "context" })` — lists tools in one category.\n  3. `getTools({ tool: "saveClaim" })` — fetches the full input schema before you call it via `runTool`.',
				"**Outcome:** You know what's available without memorizing the surface. Every tool you'll ever need is two keystrokes (or one MCP call) away.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "discovery", "mcp"],
			createdBy: "AGENT",
		},

		// ── Parking Lot (1) — graduation ────────────────────────────────
		{
			title: "When you're ready: graduate from this board",
			description: [
				"**What:** When you've finished the nine cards above, this tutorial has done its job. Delete this project, then start your own.",
				"**Why it matters:** The tutorial is scaffolding. Real value comes from running the same loop (`briefMe` → work → `saveHandoff`) on actual code you care about. Pigeon shines on projects where you'll come back to it tomorrow.",
				"**Try it (UI):** Project settings → **Delete project**. This only removes the tutorial — your other projects (and your token-tracking history) are untouched.",
				'**Try it (agent):** `runTool({ tool: "deleteProject", params: { projectId } })` on this tutorial, then `createProject({ name: "My App", description: "..." })` for your own. Or trigger the **`setup-project`** MCP prompt for a guided first-project flow that walks you through `createProject`, populating the Backlog, and adding a `tracker.md`.',
				"**Outcome:** You're in a clean slate, ready to track real work. From here: `registerRepo` your project's path, drop a `tracker.md` at the repo root, and start your first session with `briefMe`.",
			].join("\n\n"),
			column: "Parking Lot",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
	],

	/**
	 * Card #4 (Cards 101) gets a partial checklist (2/4 done) so the friend
	 * has something to toggle without an empty-state.
	 */
	checklists: [
		{
			cardNumber: 4,
			items: [
				{ text: "Read this card's description", completed: true },
				{ text: "Toggle this checklist item in the UI", completed: true },
				{ text: "Change this card's priority to URGENT", completed: false },
				{ text: "Add a new item via runTool(addChecklistItem)", completed: false },
			],
		},
	],

	/**
	 * Two seeded comments demonstrating the human→agent steering loop.
	 * Card #1 gets a welcome from the seed bot; card #5 (handoff) gets an
	 * example human note plus the agent's reply, so the friend sees what an
	 * authored back-and-forth looks like.
	 */
	comments: [
		{
			cardNumber: 1,
			content:
				"Welcome! Work cards 3 → 9 in order — drag each from Backlog into In Progress, then to Done as you finish. The whole tutorial takes 10–15 minutes. Stuck? Press `?` for the Commands catalog.",
			authorType: "AGENT",
			authorName: "tutorial-bot",
		},
		{
			cardNumber: 5,
			content:
				"Tip from a human: always pass an honest `summary` to saveHandoff — your future self reads it via briefMe and trusts it. Vague handoffs make the next session worse.",
			authorType: "HUMAN",
			authorName: "Tutorial User",
		},
		{
			cardNumber: 5,
			content:
				"Agent reply: comments like the one above flow into `getCardContext` so the next agent sees the human's guidance without re-asking. That's the steering loop in action.",
			authorType: "AGENT",
			authorName: "tutorial-bot",
		},
	],

	/**
	 * Sample session handoff so briefMe has something to surface on first
	 * load. Summary, working-on, findings, and nextSteps mirror what a real
	 * end-of-session handoff looks like.
	 */
	handoff: {
		agentName: "tutorial-bot",
		summary:
			"Seeded the Learn Pigeon tutorial board with 10 cards covering the full session loop (briefMe → cards → saveHandoff), the planning protocol (planCard + tracker.md), git binding (registerRepo), the Costs page, and tool discovery (? hotkey + getTools). Each card has a Try it (UI) and a Try it (agent) step.",
		workingOn: ["Walking the tutorial top to bottom"],
		findings: [
			"Board has 4 columns: Backlog, In Progress, Done, Parking Lot — Parking Lot is invisible to briefMe ranking",
			"Card #4 has a partial checklist so toggling has something to grab",
			"Sample comments on cards #1 and #5 show how the human→agent steering loop works",
		],
		nextSteps: [
			'Drag card #3 ("Start here: briefMe") to Done, then pull #4 from Backlog into In Progress',
			"Work cards 4 → 9 top-to-bottom",
			"When done, follow card #10 to delete this tutorial and start your own project",
		],
		blockers: [],
	},

	/**
	 * Best-practices note pinned to the project — short, focused, no
	 * deprecated advice.
	 */
	note: {
		title: "Pigeon best practices",
		content: [
			"# Pigeon best practices",
			"",
			"## The session loop",
			"- Start every session with `briefMe()` — it's the cheapest way to catch up.",
			"- End every session with `saveHandoff` — links new commits and primes the next session.",
			"- Use `planCard` (or `/plan-card #N`) before starting non-trivial cards. Plans live on the card description in four locked sections.",
			"",
			"## Card hygiene",
			"- Keep titles short and actionable. Past-tense for Done, imperative for everything else.",
			"- Description = context + acceptance criteria. Future agents (and future you) read it.",
			"- Limit In Progress. Backlog position is the priority signal — drag what you want next to the top.",
			"- Tag cards with one type (`bug | feature | chore | docs | epic | spike`) plus an optional area (`mcp`, `ui`, `cli`, `schema`, …). Group cross-card initiatives with a *milestone*, not a tag prefix.",
			"",
			"## Project setup",
			"- Run `registerRepo` once per project so `briefMe` auto-detects from cwd.",
			"- Drop a `tracker.md` at your repo root with project policy + per-column prompts. `planCard` reads it.",
			"- Wire the Stop hook (one-time, ~30s) to capture token costs — see the Costs page setup prompt.",
		].join("\n"),
		tags: ["best-practices", "tips"],
	},
};
