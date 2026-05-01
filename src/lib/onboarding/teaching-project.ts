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
 * idempotency guard. Existing installs migrate via `npm run migrate-rebrand`.
 */

export const TUTORIAL_SLUG = "learn-project-tracker";

export const teachingProject = {
	name: "Learn Pigeon",
	slug: TUTORIAL_SLUG,
	description:
		"A hands-on tutorial that teaches humans the UI and agents the MCP surface. Every card has a Try it (UI) and a Try it (agent) step — walk the board solo, or watch your connected agent walk it for you.",
	color: "blue",

	board: {
		name: "Tutorial Board",
		description:
			"Your learning workspace — each card teaches one capability from both the human and agent angle",
	},

	milestone: {
		name: "Getting Started",
		description: "Complete these cards to learn the basics of Pigeon",
	},

	/** Card numbers attached to the "Getting Started" milestone */
	milestoneCards: [11, 12] as number[],

	cards: [
		// ── Done (3) — concepts demonstrated by their existence ──────────
		{
			title: "Welcome to Pigeon",
			description: [
				"**What:** Cards are the building blocks of Pigeon — the homing-pigeon metaphor: each card is a piece of context that travels with you between AI sessions. Each one represents a task, feature, bug, or idea.",
				"**Why it matters:** Everything downstream — priorities, relations, handoffs, commits — hangs off a card. Agents and humans share the same cards as the single source of truth.",
				"**Try it (UI):** You're reading one now! Click any card on the board to open its details.",
				"**Try it (agent):** `briefMe()` — run this first in any session. It returns the last handoff, recent diff, top work, and the current pulse in ~300 tokens instead of a full board dump.",
				"**Outcome:** You can see every card at a glance on the board; your agent has a compact snapshot to start working from.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Understanding Columns",
			description: [
				"**What:** Columns represent workflow stages. The default board has three main columns — **Backlog → In Progress → Done** — plus a **Parking Lot** for unscheduled ideas.",
				"**Why it matters:** `briefMe` ranks top work as In Progress → top-of-Backlog (pinned) → scored Backlog. The top 3 positions in Backlog are treated as your hand-curated priority queue — drag a card to the top to signal *I want this next*. No separate column needed.",
				"**Try it (UI):** Look at the board — each column header shows how many cards are in that stage. Drag a Backlog card up or down to change its priority order.",
				"**Try it (agent):** `briefMe()` then inspect `topWork[]` — cards have `source: 'active' | 'pinned' | 'scored'`. Pinned cards (top 3 of Backlog) surface ahead of scored ones.",
				"**Outcome:** You understand the three-stage workflow and how Backlog position acts as the priority signal.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Moving Cards Between Columns",
			description: [
				"**What:** Cards flow across columns as work progresses — from Backlog into In Progress, then into Done.",
				"**Why it matters:** A move is the most important status signal on the board. The agent surface treats it as an intentional act — every agent-driven move must include a short `intent` so teammates know *why* it moved.",
				"**Try it (UI):** Grab any card and drag it to another column, then drag it back.",
				'**Try it (agent):** `moveCard({ cardId: "#3", columnName: "In Progress", intent: "Walking the tutorial" })`. The `intent` is required for agent moves and surfaces in the activity strip.',
				"**Outcome:** The card lands in the new column and the move shows up in activity history with the intent attached.",
			].join("\n\n"),
			column: "Done",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},

		// ── In Progress (4) — start here ────────────────────────────────
		{
			title: "Start Here: briefMe is your first call",
			description: [
				"**What:** `briefMe` is the session primer every agent should call first. It returns the last handoff, a diff since that handoff, top work ranked across columns, open blockers, recent decisions on still-active cards, and a one-line pulse.",
				"**Why it matters:** It replaces the old habit of dumping the entire board. ~300–500 tokens vs. thousands, and the ordering already tells you what to pick up. This card is the first thing `briefMe` surfaces to a fresh agent on this board.",
				"**Try it (UI):** Humans can read the same information on the Dashboard's Focus panel — In Progress cards are listed there in the same order.",
				"**Try it (agent):** `briefMe()` with no args — the board is auto-detected from the current git repo after `registerRepo`. Pass `{ boardId }` to override.",
				"**Outcome:** You get a session snapshot and a `_hint` suggesting either following `handoff.nextSteps` or picking from `topWork[]`.",
			].join("\n\n"),
			column: "In Progress",
			priority: "HIGH",
			tags: ["tutorial", "mcp", "session"],
			createdBy: "AGENT",
		},
		{
			title: "Set Card Priorities",
			description: [
				"**What:** Priorities help you focus on what matters most. Levels: None, Low, Medium, High, Urgent.",
				"**Why it matters:** `briefMe`'s work-ranking score weights priority heavily. Within a tier, a HIGH card outranks a LOW card — so priority is the knob you use to tell your agent which work matters most. Backlog *position* is the manual override (top 3 are pinned regardless of score).",
				"**Try it (UI):** Open this card's details and change its priority. Notice how the priority badge appears on the board.",
				'**Try it (agent):** `updateCard({ cardId: "#5", priority: "URGENT", intent: "Reprioritizing for demo" })`.',
				"**Outcome:** The badge updates on the board and the card's rank in the next `briefMe` call reflects the change.",
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
				"**Why it matters:** The description is the durable brief an agent reads via `getCardContext`. Good descriptions (context + acceptance criteria) let the agent act without re-asking the human.",
				"**Try it (UI):** Edit this card's description. Try adding a bullet list, a `code snippet`, and a [link](https://example.com).",
				'**Try it (agent):** `updateCard({ cardId: "#6", description: "## Acceptance\\n- [ ] ..." })`. Markdown renders in the UI exactly as written.',
				"**Outcome:** The description persists and is returned by `getCardContext` for any agent that picks the card up.",
			].join("\n\n"),
			column: "In Progress",
			priority: "MEDIUM",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Break Work into Checklists",
			description: [
				"**What:** Checklists let you break a card into smaller steps and track progress.",
				"**Why it matters:** Checklists give an agent a ready-made plan and give the human a glanceable progress indicator (e.g., 2/4) on the board — no need to open the card.",
				"**Try it (UI):** Open this card — it has a checklist with some items already checked. Toggle the remaining items.",
				'**Try it (agent):** `runTool({ tool: "addChecklistItem", params: { cardId: "#7", text: "Newly discovered subtask" } })` — checklist tools are extended, so they come through `runTool`.',
				"**Outcome:** The progress counter on the card updates and the new item appears in the checklist.",
			].join("\n\n"),
			column: "In Progress",
			priority: "MEDIUM",
			tags: ["tutorial", "organization"],
			createdBy: "AGENT",
		},

		// ── Backlog top — pinned (5) ────────────────────────────────────
		// These five sit at the top of Backlog. The first 3 surface as
		// `source: "pinned"` in briefMe.topWork — they're the agent's
		// recommended next-up after the In Progress cards.
		{
			title: "Connect Related Cards",
			description: [
				"**What:** Card relations link related work together. Types: **blocks** (hard dependency), **related** (associated), **parent** (hierarchy).",
				"**Why it matters:** Blocking relations short-circuit agent ranking — a blocked card won't show up in `topWork[]` until its blockers clear. This card is blocked by #9 on purpose, so you can see it.",
				'**Try it (UI):** Open this card — it shows a "blocked by #9" badge.',
				"**Try it (agent):** `briefMe()` and look at `blockers[]` — this card appears there until #9 is moved to Done.",
				"**Outcome:** Dependencies are visible on the board and the agent's work queue respects them automatically.",
			].join("\n\n"),
			column: "Backlog",
			priority: "MEDIUM",
			tags: ["tutorial", "relations"],
			createdBy: "AGENT",
		},
		{
			title: "Configure Development Tools",
			description: [
				'**What:** This card demonstrates blocking relationships — it **blocks #8** ("Connect Related Cards").',
				"**Why it matters:** Shipping order is a real constraint; encoding it on the board keeps agents from starting downstream work early.",
				'**Try it (UI):** Open this card to see the "blocks #8" relation, then move it to Done.',
				'**Try it (agent):** `moveCard({ cardId: "#9", columnName: "Done", intent: "Unblocking #8" })`, then call `briefMe()` again — #8 should no longer appear in `blockers[]`.',
				"**Outcome:** #8 becomes unblocked and rises in the work ranking on your next `briefMe` call.",
			].join("\n\n"),
			column: "Backlog",
			priority: "HIGH",
			tags: ["tutorial", "relations"],
			createdBy: "AGENT",
		},
		{
			title: "Organize with Tags",
			description: [
				"**What:** Tags are project-scoped, normalized labels — every spelling variant of the same idea collapses onto a single canonical tag. Each tag has an immutable `slug` (kebab-case identifier) and a mutable `label` (display).",
				'**Why it matters:** Tags survive column moves. An agent can pull "everything tagged `mcp`" across Backlog and In Progress without caring about current status. Normalization eliminates the "232 distinct strings, half singletons" drift the v4.2 rework was scoped to fix.',
				"**Convention (flat, two slots):** A card's tags answer two orthogonal questions: *what kind of work is this?* and *what part of the system does it touch?*\n  - **type** (required): exactly one of `bug | feature | chore | docs | epic | spike`.\n  - **area** (optional): an open vocabulary — `mcp`, `ui`, `cli`, `schema`, `roadmap`, etc. Add more only when the work genuinely spans surfaces.\n  - **`feature:foo` namespacing is deprecated.** Group cards by feature or release using a *milestone*, not a tag prefix. v4.2 slugify rewrites `feature:auth` → `feature-auth`, but the convention is to fold those into the matching milestone via `mergeTags`.",
				'**Try it (UI):** Open this card and use the tag combobox — type to filter existing tags, or "Create new" if none match.',
				'**Try it (agent — strict, recommended):** `runTool({ tool: "listTags", params: { projectId } })` to discover existing slugs, then `updateCard({ cardId: "#10", tagSlugs: ["tutorial", "feature", "schema"] })` — `feature` is the type, `schema` is the area. Strict mode rejects unknown slugs with `_didYouMean` suggestions — call `runTool({ tool: "createTag", params: { projectId, label: "..." } })` first when introducing new vocabulary.',
				'**Try it (agent — legacy, v4.2 only):** `updateCard({ cardId: "#10", tags: ["tutorial", "feature", "schema"] })` still works in v4.2 with auto-create + slugify normalization. Response includes `_deprecated` and any near-miss `_didYouMean` hints. Removed in v5.0.0.',
				"**Outcome:** The tag combobox now shows the canonical labels for the project. Filtering by `bug` matches every card with that slug regardless of original casing — and you can answer *what kind of work is open?* and *which surface needs attention?* with two filters.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "feature", "schema"],
			createdBy: "AGENT",
		},
		{
			title: "Plan with Milestones",
			description: [
				"**What:** A milestone is a **bounded set of cards intended to ship as a coherent unit** — a release horizon, a cross-version initiative, or any other 'I'll know it's done when X' container. The unifying rule: every milestone description must answer *what's the unit of completion?* If it can't, it's a tag, not a milestone.",
				"**Why it matters:** Milestones answer *when will this ship?* and *what is this part of?* — agents use `getMilestoneContext` to report progress without re-counting cards manually. They're also where `feature:foo` grouping lives now (the deprecated tag-prefix style is folded into milestones during cleanup).",
				"**Two valid shapes:**\n  - **Release-shaped** — `vN.M.P — Theme` for software releases (e.g. `v4.2.0 — Taxonomy primitives`). Bounded by a version cut.\n  - **Theme-shaped** — free-form initiative names that span versions (e.g. `Adoption Push`, `Token Tracking & Cost Surfacing`, `Rebrand → Pigeon`). Bounded by 'the initiative is done.' Archive once shipped so the picker stays focused on active work.\n\nAvoid: anonymous milestones, single-card milestones (almost always premature — `_governanceHints` flags these), and theme-shaped milestones left open indefinitely past their initiative.",
				'**Try it (UI):** This card is attached to the "Getting Started" milestone. Open the roadmap view to see milestone progress. The milestone picker now filters out archived milestones by default — toggle "Show archived" to see them.',
				'**Try it (agent — strict, recommended):** `runTool({ tool: "listMilestones", params: { projectId } })` to discover IDs and any `_governanceHints` (singletons > 60 days, near-name neighbours), then `updateCard({ cardId: "#11", milestoneId: "<uuid>" })`. Pass `milestoneId: null` to unassign.',
				'**Try it (agent — legacy, v4.2 only):** `updateCard({ cardId: "#11", milestoneName: "Getting Started" })` still works in v4.2 with case-insensitive normalization. "Getting Started" and "getting started" no longer create two milestones. Response includes `_deprecated`. Removed in v5.0.0.',
				"**Outcome:** You can report milestone status in one call. The roadmap view groups by horizon (Now / Next / Later / Done) — a healthy roadmap has both release-shaped and theme-shaped milestones, with the Done horizon telling a real shipping narrative.",
			].join("\n\n"),
			column: "Backlog",
			priority: "MEDIUM",
			tags: ["tutorial", "planning"],
			createdBy: "AGENT",
		},
		{
			title: "Add Comments & Collaborate",
			description: [
				"**What:** Comments let humans and agents discuss a card asynchronously. Author type (HUMAN vs. AGENT) is preserved, so the audit trail makes clear who said what.",
				"**Why it matters:** Human guidance left as a comment is surfaced to the next agent via `getCardContext`. It's the primary way a human steers an agent mid-flight without rewriting the description.",
				"**Try it (UI):** Open this card — it already has example comments from both a human and an agent. Add your own.",
				'**Try it (agent):** `addComment({ cardId: "#12", content: "Walked the tutorial — all MCP calls worked as documented." })`.',
				"**Outcome:** The comment appears under the card with your author label, and any future `getCardContext` call will include it.",
			].join("\n\n"),
			column: "Backlog",
			priority: "MEDIUM",
			tags: ["tutorial", "collaboration"],
			createdBy: "AGENT",
		},

		// ── Backlog (6) ─────────────────────────────────────────────────
		{
			title: "Record Architectural Decisions",
			description: [
				"**What:** Decision Records capture important technical decisions with context, alternatives, and rationale. Status cycle: **proposed → accepted** (or **rejected**), with **superseded** when a later decision replaces an old one.",
				"**Why it matters:** ADRs live on cards, not in a wiki that goes stale. The next agent sees the decision and its rationale in `getCardContext` without leaving the tool surface.",
				"**Try it (UI):** Open this card — it has an attached decision about using SQLite. Check the Decisions tab on the project page too.",
				'**Try it (agent):** `runTool({ tool: "recordDecision", params: { projectId, cardId: "#13", title: "Use SQLite", status: "accepted", decision: "Store all data in tracker.db", alternatives: ["Postgres", "Mongo"], rationale: "Local-first, zero setup" } })`.',
				"**Outcome:** The decision is attached to the card and appears in `briefMe`'s `recentDecisions[]` while the card is still active. Once the card moves to Done, the decision drops out of the brief — it's been ratified and shipped.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "mcp"],
			createdBy: "AGENT",
		},
		{
			title: "Save Facts & Claims (saveClaim)",
			description: [
				"**What:** `saveClaim` is the unified write path for typed assertions. Kinds: **context** (project-level knowledge), **code** (assertion about a file or symbol), **measurement** (numeric value with a unit), **decision** (architectural, same shape as `recordDecision`).",
				"**Why it matters:** Claims are the long-term memory of the project. They survive sessions, carry evidence (files, symbols, URLs, card refs), and can be superseded rather than deleted — so history stays intact.",
				"**Try it (UI):** Claims surface on cards and in the Knowledge tab. You read them; you don't usually author them by hand.",
				'**Try it (agent):** Three mini-tasks:\n  1. `runTool({ tool: "saveClaim", params: { projectId, kind: "context", statement: "Tutorial uses SQLite at ./data/tracker.db" } })`\n  2. `runTool({ tool: "saveClaim", params: { projectId, kind: "code", statement: "seedTutorialProject seeds the learn project", evidence: { files: ["src/lib/onboarding/seed-runner.ts"] } } })`\n  3. `runTool({ tool: "saveClaim", params: { projectId, kind: "measurement", statement: "Tutorial seeds 20 cards", payload: { value: 20, unit: "cards" } } })`',
				"**Outcome:** Three claims appear under the project, each queryable via `runTool('queryKnowledge', ...)`.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "mcp", "knowledge"],
			createdBy: "AGENT",
		},
		{
			title: "Hand Off Between Sessions",
			description: [
				"**What:** `saveHandoff` records what you worked on, what you found, what's next, and what's blocking — and (by default) auto-links new git commits, reports touched cards, and returns a copy-pasteable resume prompt for the next chat.",
				"**Why it matters:** Handoffs are what make multi-session agent work coherent. `briefMe` reads the latest handoff at session start — without one, the next agent starts cold.",
				"**Try it (UI):** Open the Session History panel on the board page. This project has a sample handoff already.",
				'**Try it (agent):** End of session: `saveHandoff({ summary: "Completed dual-audience tutorial walkthrough", nextSteps: ["Delete tutorial and create a real project"] })` — saves the handoff, links commits, prints a resume prompt for the next chat.\n\nMid-session checkpoint without git sync: `saveHandoff({ summary: "Walked tutorial", nextSteps: ["Try the remaining backlog cards"], syncGit: false })`.',
				"**Outcome:** Your next `briefMe` call returns your handoff as `handoff.summary` and `handoff.nextSteps` — the next session picks up where you left off.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "mcp", "session"],
			createdBy: "AGENT",
		},
		{
			title: "Deep Context for a Card (getCardContext)",
			description: [
				"**What:** `getCardContext` returns everything attached to a single card — description, checklist, comments, relations, decisions, linked commits, and related cards — in one call.",
				"**Why it matters:** When `briefMe` tells you which card to work on, `getCardContext` is the follow-up that gives you the full brief. Avoids the O(N) walk of separate tool calls.",
				"**Try it (UI):** Opening a card's detail view in the UI is the human equivalent — same data, different presentation.",
				'**Try it (agent):** `runTool({ tool: "getCardContext", params: { boardId, cardId: "#16" } })` on this card.',
				"**Outcome:** You get the card's description, any checklist, comments, blockers, related cards, and linked commits — enough context to start work without re-asking the human.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "mcp", "context"],
			createdBy: "AGENT",
		},
		{
			title: "Discover Tools (getTools / runTool)",
			description: [
				"**What:** Only the essential tools are registered at the top level. Everything else — milestone context, tag context, knowledge queries, checklist tools, decision tools — is *extended* and called through `runTool`. `getTools` browses what's available.",
				"**Why it matters:** Keeps the top-level tool surface tiny and discoverable. An agent learns the common path (briefMe, moveCard, updateCard, addComment) and reaches for the long tail only when needed.",
				"**Try it (UI):** The docs site lists all tools with their categories — the same data `getTools` returns.",
				'**Try it (agent):** Two calls:\n  1. `getTools({ category: "context" })` — list all context-category extended tools.\n  2. `getTools({ tool: "saveClaim" })` — fetch the full input schema for one tool before calling it via `runTool`.',
				"**Outcome:** You know what's available and how to call it — no guessing at parameter shapes.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "mcp", "discovery"],
			createdBy: "AGENT",
		},
		{
			title: "Track Git Commits",
			description: [
				"**What:** Git integration links commits to cards automatically — mention `#7` in a commit message and the commit shows up on card #7.",
				"**Why it matters:** Code and card stay coupled without a separate bookkeeping step. `saveHandoff` calls `syncGitActivity` for you at wrap-up, so touched cards get their commits linked on every session close.",
				'**Try it (UI):** Set a repo path on the project, then commit with a message like `"Fix tutorial wording #2"` — open card #2 and the commit appears under Commits.',
				'**Try it (agent):** `registerRepo({ projectId, repoPath: "/absolute/path/to/repo" })` — called once per project. After that, `briefMe` auto-resolves the board from cwd inside that repo.',
				"**Outcome:** `briefMe` works without passing `boardId`, and commits referencing card numbers show up on the corresponding cards.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "git", "mcp"],
			createdBy: "AGENT",
		},

		// ── Parking Lot (2) ─────────────────────────────────────────────
		{
			title: "The Parking Lot",
			description: [
				"**What:** The Parking Lot is a special column for ideas you want to remember but aren't ready to prioritize.",
				"**Why it matters:** `briefMe`'s work ranking deliberately ignores Parking Lot cards — they stay out of the way until you promote them, so the active board stays focused.",
				'**Try it (UI):** Drag any card here to "park" it. Cards in the Parking Lot don\'t count toward milestone progress.',
				'**Try it (agent):** `moveCard({ cardId: "#20", columnName: "Parking Lot", intent: "Deferring — revisit after tutorial" })`.',
				"**Outcome:** The card is safely stored and no longer appears in `topWork[]`.",
			].join("\n\n"),
			column: "Parking Lot",
			priority: "NONE",
			tags: ["tutorial", "basics"],
			createdBy: "AGENT",
		},
		{
			title: "Explore More Features",
			description: [
				"**What:** The tutorial is a starting point — Pigeon has more to discover once you're comfortable.",
				"**Why it matters:** The MCP surface is broader than the essentials. Extended tools handle facts, measurements, staleness checks, roadmap views, and more — the docs site and `getTools` are the canonical index.",
				"**Try it (UI):** Explore the Dashboard, Roadmap view, Notes, and the Decisions tab on the project page.",
				'**Try it (agent):** `getTools()` with no filter returns the full list grouped by category. Pick one that looks useful and fetch its schema with `getTools({ tool: "name" })`.',
				"**Outcome:** You have a map of the surface; delete the tutorial project once you're comfortable and create a real one to track actual work.",
			].join("\n\n"),
			column: "Parking Lot",
			priority: "NONE",
			tags: ["tutorial", "advanced"],
			createdBy: "AGENT",
		},

		// ── Backlog (advanced) — tracker.md policy + planning ────────────
		{
			title: "Plan a Card with planCard",
			description: [
				"**What:** `planCard` is a first-class MCP tool that turns a vague backlog item into a structured plan. It returns the card context, the project's `tracker.md` policy, an `investigation_hints` object (URLs / file paths / `#nnn` refs / code symbols extracted from the description), and a fixed `protocol` string instructing the agent to draft a plan with four locked headings.",
				"**Why it matters:** Without it, every session re-derives the same recipe (load card → read policy → investigate → draft → confirm → write). With it, every planned card emerges with the same shape — `## Why now` / `## Plan` / `## Out of scope` / `## Acceptance` — so future humans and agents always find the plan in the same place.",
				"**Try it (UI):** This card is intentionally light on detail. Drop a vague intent into a card description, then let your agent run `/plan-card N` (or call `planCard`) to flesh it out.",
				'**Try it (agent):** `runTool({ tool: "planCard", params: { boardId, cardId: "#22" } })`. Read the `protocol`, walk the four steps (investigate → synthesize → propose in chat → publish on confirm). Watch the activity strip — a `planning` event is stamped while planning is in flight.',
				'**Refuse-on-exists:** If the card description already contains all three required headers (`## Why now`, `## Plan`, `## Acceptance`), `planCard` returns `_warnings[].code === "PLAN_EXISTS"` and omits the protocol. Don\'t silently overwrite a published plan — surface the warning to the human.',
				"**Outcome:** The card description becomes the canonical plan. Anyone (human or agent) opening the card later sees the four locked sections and knows what's planned, why, what's out of scope, and how to verify it shipped.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "mcp", "planning"],
			createdBy: "AGENT",
		},
		{
			title: "Define Runtime Policy in tracker.md",
			description: [
				"**What:** `tracker.md` is a single Markdown file at your project's repo root. YAML front matter carries machine-parsed policy (`intent_required_on`, `columns.<name>.prompt`); the body is the project's general agent prompt. Tracker MCP tools parse it and surface it to agents at the right moment.",
				"**Why it matters:** `tracker.md` is git-versioned — review, branch, roll back. `briefMe` exposes the body under `policy.prompt`. `getCardContext` surfaces `policy.columnPrompt` exactly when an agent picks up a card in that column. Tools listed in `intent_required_on` enforce the `intent` parameter at the MCP boundary.",
				"**Try it (UI):** Drop the example below into `tracker.md` at the root of any project you've connected, edit the prompts to match your policy, and commit it.",
				"**Try it (agent):** Write the file by hand at repo root using the example below as a starting point.",
				"**Example tracker.md:**\n\n````markdown\n---\nschema_version: 1\nproject_slug: learn-project-tracker\nintent_required_on:\n  - moveCard\n  - deleteCard\ncolumns:\n  In Progress:\n    prompt: |\n      Limit to 2-3 cards. Move here when you start writing code, not when planning.\n  Review:\n    prompt: |\n      Code is written and needs human verification. Don't move to Done without\n      explicit approval in a comment.\n---\n\n# Project policy for learn-project-tracker\n\nStart every session with `briefMe` — it returns the last handoff, top work,\nblockers, and pulse. Prefer cards with `source: 'pinned'` over `source: 'scored'`.\n\nEnd every session with `saveHandoff` — saves a handoff and links new commits.\n````",
				"**Outcome:** `briefMe` includes the parsed policy in its response. Cards in `In Progress` or `Review` get the matching `columnPrompt` via `getCardContext`. `moveCard` and `deleteCard` reject calls without an `intent`.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "mcp", "policy"],
			createdBy: "AGENT",
		},
		{
			title: "Cleaning up tag drift",
			description: [
				"**What:** Even with v4.2 normalization, tags can drift when an agent introduces a near-miss spelling that the slug doesn't catch (`feature-auth` vs `featureauth`). `mergeTags` rewrites every CardTag from one tag onto another, then deletes the source.",
				"**Why it matters:** Tag drift is dedupe-by-rule (slugify) AND dedupe-by-judgment (humans deciding two slugs mean the same thing). The first happens automatically on write; the second needs an explicit merge.",
				"**Try it (UI):** Open the tag combobox on any card and look for near-duplicate slugs. The combobox shows usage counts so you can spot orphans (zero cards) and likely duplicates.",
				'**Try it (agent):** `runTool({ tool: "listTags", params: { projectId } })` to inspect usage counts, then `runTool({ tool: "mergeTags", params: { fromTagId: "<uuid-of-loser>", intoTagId: "<uuid-of-winner>" } })`. The merge is transactional — composite-PK collisions on (cardId, tagId) are skipped, the source tag is deleted, and the response reports `rewroteCount` and `skippedDuplicates`.',
				"**Outcome:** All cards previously tagged with the source tag now show the destination tag. The source tag no longer appears in `listTags` or the combobox. Merge is irreversible — keep the audit JSON from `migrateTags` if you want to know which variants got merged at v4.2 cutover.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "tags"],
			createdBy: "AGENT",
		},
		{
			title: "Cleaning up milestone drift",
			description: [
				"**What:** v4.2 milestones case-insensitively dedupe at the resolveOrCreate boundary, but legacy milestones (created pre-v4.2) and milestones with semantically-similar names (`v1.1` vs `v1.1.0`) need explicit cleanup. Two tools: `mergeMilestones` rewrites Card.milestoneId from one milestone to another; `updateMilestone({ state: 'archived' })` hides a milestone from the picker without losing the data.",
				"**Why it matters:** Tags are dedupe-by-rule; milestones are dedupe-by-judgment. `listMilestones` returns `_governanceHints` per milestone — singleton-after-60-days hints flag premature/abandoned milestones, and `possibleMerge` lists near-name neighbours within Levenshtein 2. The hints are signal, not orders.",
				'**Try it (UI):** Open the milestone picker; archived milestones are hidden by default. Toggle "Show archived" to see the full list.',
				'**Try it (agent):** `runTool({ tool: "listMilestones", params: { projectId } })` to inspect `_governanceHints`. For each hinted milestone, decide:\n  - **Merge:** `runTool({ tool: "mergeMilestones", params: { fromMilestoneId: "<loser>", intoMilestoneId: "<winner>" } })`\n  - **Archive:** `runTool({ tool: "updateMilestone", params: { milestoneId: "<id>", state: "archived" } })`\n  - **Leave:** the milestone is intentional; the hint is noise.',
				"**Outcome:** The milestone picker shows only active, distinct milestones. Merged source milestones are gone; archived ones survive in the DB but stay out of the picker.",
			].join("\n\n"),
			column: "Backlog",
			priority: "LOW",
			tags: ["tutorial", "advanced", "milestones"],
			createdBy: "AGENT",
		},
	],

	/** Card #7 (Break Work into Checklists) gets a partial checklist (2/4 done) */
	checklists: [
		{
			cardNumber: 7,
			items: [
				{ text: "Toggle a checklist item in the UI", completed: true },
				{ text: "Read how checklist progress shows on the board", completed: true },
				{ text: "Add a new item via runTool(addChecklistItem)", completed: false },
				{ text: "Complete all items to finish this card", completed: false },
			],
		},
	],

	/** Seeded comments demonstrating collaboration and the human→agent steering loop */
	comments: [
		{
			cardNumber: 1,
			content:
				"Welcome! Work through the cards in order. Humans: drag cards and edit fields. Agents: start with `briefMe()` — it's the first card in In Progress and will point you at the next action.",
			authorType: "AGENT",
			authorName: "tutorial-bot",
		},
		{
			cardNumber: 12,
			content:
				"This is an example comment from a human. Use comments to leave guidance for the next agent — it'll read them via getCardContext.",
			authorType: "HUMAN",
			authorName: "Tutorial User",
		},
		{
			cardNumber: 12,
			content:
				"And this is a comment from an AI agent, left via addComment. Notice the different author label — the trail makes clear who said what.",
			authorType: "AGENT",
			authorName: "tutorial-bot",
		},
	],

	/** Card #9 (Configure Development Tools) blocks card #8 (Connect Related Cards) */
	relations: [{ fromCardNumber: 9, toCardNumber: 8, type: "blocks" as const }],

	/** Decision record attached to card #13 (Record Architectural Decisions) */
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

	/** Sample session handoff so briefMe has something to surface on first load */
	handoff: {
		agentName: "tutorial-bot",
		summary:
			"Seeded the dual-audience tutorial board with 21 cards. Each content card has both a Try it (UI) and a Try it (agent) step.",
		workingOn: ["Seeding the tutorial cards across all columns"],
		findings: [
			"Board has 4 columns: Backlog, In Progress, Done, Parking Lot",
			"Card #9 blocks card #8 to demonstrate blocking relations",
			"Sample decision, checklist, comments, and handoff are attached so briefMe and getCardContext return real data on first load",
		],
		nextSteps: [
			'Agents: start with the "Start Here: briefMe" card in In Progress',
			"Humans: drag cards between columns as you work through them",
			"Delete this tutorial project and create your own when comfortable",
		],
		blockers: [],
	},

	/** Best practices note */
	note: {
		title: "Best Practices",
		content: [
			"# Pigeon Best Practices",
			"",
			"## Card Hygiene",
			"- Keep card titles short and actionable",
			"- Add descriptions with context and acceptance criteria — future agents read them",
			"- Use checklists to break down complex cards",
			"- Move cards between columns as status changes; agents must pass `intent` on every move",
			"",
			"## Organization",
			"- Tag every card with one **type** (`bug | feature | chore | docs | epic | spike`) plus an optional **area** (`mcp`, `ui`, `cli`, `schema`, …). `feature:foo` namespacing is deprecated — group by feature with a *milestone* instead.",
			"- Set priorities to focus on what matters — `briefMe` scoring weights priority heavily",
			"- Review the Parking Lot periodically",
			"- Attach cards to milestones to get roadmap progress — milestones can be release-shaped (`v4.2.0 — Taxonomy primitives`) or theme-shaped (`Adoption Push`)",
			"",
			"## Agent Collaboration",
			"- Start every session with `briefMe()` — it's the cheapest way to catch up",
			"- End every session with `saveHandoff` — saves a handoff and links new commits",
			"- Use comments to leave guidance; agents read them via `getCardContext`",
			"- Record decisions with `recordDecision` (or `saveClaim` of kind `decision`) — kept on the card, not in a wiki",
		].join("\n"),
		tags: ["best-practices", "tips"],
	},
};
