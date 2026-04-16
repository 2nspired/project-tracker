# Project Tracker

A local-first kanban board with MCP integration for AI-assisted development. Your AI coding agent reads and updates the board while you work together — both of you stay in sync across conversations.

**The problem:** When working with AI coding agents, context gets lost between conversations. What was planned? What's done? What decisions were made? You end up re-explaining everything.

**The solution:** A shared workspace with persistent memory. You see cards, columns, and progress in the browser. Your agent sees structured context it can read and write through MCP tools. Session handoffs carry context between conversations — the next session picks up exactly where the last one left off.

## Contents

- [Features](#features)
- [Quick Start](#quick-start)
  - [Clone and install](#1-clone-and-install)
  - [Run the setup wizard](#2-run-the-setup-wizard)
  - [Start the web UI](#3-start-the-web-ui)
  - [Connect your project](#4-connect-your-project)
  - [Add tracking instructions](#5-add-tracking-instructions-to-your-project-optional)
- [How It Works](#how-it-works)
- [MCP Surface](#mcp-surface)
  - [Essential tools](#essential-tools-9)
  - [Extended tools](#extended-tools-by-category)
  - [Prompts](#prompts-8)
  - [Resources](#resources-5)
- [Session Lifecycle](#session-lifecycle)
- [Working with Multiple Projects](#working-with-multiple-projects)
- [Multi-Agent Support](#multi-agent-support)
- [Tags](#tags)
- [Available Scripts](#available-scripts)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

**Board**
- Kanban board with drag-and-drop columns and cards
- Cards with priority, tags, checklists, markdown descriptions, comments, and activity log
- Card numbers (`#1`, `#2`) for easy reference in conversation
- Card templates (Bug Report, Feature, Spike, Tech Debt, Epic)
- Card dependencies — blocks, related, parent/child with blocked indicators
- Card similarity detection — warns when creating duplicates
- Column roles — customizable column purposes (backlog, active, done, parking)
- Board Pulse — real-time health overview (velocity, bottlenecks, stale cards)
- Work-Next Score — smart card ranking to suggest what to work on next

**Views**
- Roadmap view with horizon landscape (Now/Next/Later), draggable milestones, progressive disclosure
- Saved views — built-in presets (All Cards, Active Work, Stale Cards, Recently Done) and custom views with persistent filters/sort/grouping
- Timeline view for card history
- Cross-project dashboard with responsive layout
- Notes scratch pad with promote-to-card
- Activity feed showing agent and human actions

**Project management**
- Project favorites and color coding for quick identification
- Architectural decision records linked to cards
- Git commit auto-linking — commits referencing `#N` are linked to cards
- Commit summaries — on-demand aggregation of linked commits with files grouped by category, author breakdown, time span

**Agent integration**
- `briefMe` — one-shot session primer (~300-500 tokens) replacing the getBoard-on-every-session pattern
- `endSession` — session wrap-up that saves a handoff, links new commits, and emits a resume prompt for the next chat
- Session handoffs — agents save context for the next conversation
- Agent scratchpad — ephemeral working memory that auto-expires
- Multi-agent support (Claude, Codex, etc.) via `AGENT_NAME` env var
- Real-time updates via SSE — board refreshes instantly when agents make changes (falls back to polling)
- Optional TOON encoding (opt-in via `format: "toon"` — wins on flat tabular payloads, larger than JSON on nested shapes)
- Board filtering — fetch specific columns, exclude Done, summary mode
- Bulk operations — update cards, add checklists, set milestones in batch
- Board audit — find cards missing priority, tags, milestones, checklists
- Schema version detection with migration hints

**Persistent context** ([design doc](docs/DESIGN-CONTEXT-MODEL.md))
- Context entries — structured knowledge claims with rationale, cited files, staleness tracking
- Code facts — file-cited structural facts about the codebase with auto-staleness detection
- Measurement facts — environment-dependent numeric values (latency, build time) with TTL and env-drift staleness
- Optimistic locking — version-based conflict resolution for multi-agent writes with clear conflict errors
- Knowledge search — FTS5 full-text search across cards, comments, decisions, notes, handoffs, code facts, repo docs
- Staleness warnings — auto-flags stale facts at session start based on git changes and age heuristics
- Generated project status — `renderStatus` replaces hand-maintained STATUS.md with board-derived markdown

For agent workflow conventions and board usage guidelines, see [AGENTS.md](AGENTS.md).

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/2nspired/project-tracker.git
cd project-tracker
npm install
```

### 2. Run the setup wizard

```bash
npm run setup
```

The wizard walks you through:

1. Creating the SQLite database
2. Optionally seeding a tutorial project with sample cards
3. Connecting an external project to the MCP server

Or set up manually:

```bash
npx prisma generate
npx prisma db push
```

### 3. Start the web UI

**Option A: Background service (recommended)**

```bash
npm run service:install
```

Builds the app and registers it as a macOS background service via launchd. The board is always available at [http://localhost:3100](http://localhost:3100) — starts on login, restarts on crash, uses no resources when idle. Run `npm run service:update` after pulling new code.

**Option B: Dev server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use this when actively developing the tracker itself (hot reload, Turbopack). If the database doesn't exist yet, `npm run dev` creates it automatically.

> **Note:** The web UI is optional. The MCP server works independently — your agent can use the board even without the browser open. The UI is where you'll visually track progress.

### 4. Connect your project

From your project directory:

```bash
/path/to/project-tracker/scripts/connect.sh
```

Creates a `.mcp.json` in your project that tells your agent where to find the tracker's MCP server. Next time you start a conversation in that project, the tracker tools are available.

For non-Claude agents, set the agent name:

```bash
AGENT_NAME=Codex /path/to/project-tracker/scripts/connect.sh
```

#### Prompt-based setup

Or paste this prompt into Claude Code from your project directory and let Claude do it:

```
I want to connect this project to my Project Tracker board.

The project tracker is installed at: /path/to/project-tracker

Please run /path/to/project-tracker/scripts/connect.sh from this directory to
create the .mcp.json file. Then add a "Project Tracking" section to this
project's CLAUDE.md explaining that the project is tracked via project-tracker
MCP tools, cards should be referenced by #number, and the agent should call
briefMe() at the start of each conversation and endSession() before wrapping
up.
```

Replace `/path/to/project-tracker` with the actual path.

### 5. Add tracking instructions to your project (optional)

Add this to your project's agent instructions file (`CLAUDE.md`, `AGENTS.md`, etc.):

```markdown
## Project Tracking

This project uses a Project Tracker board via MCP.

**Session lifecycle:** Call `briefMe()` at the start of each conversation
for a one-shot session primer (handoff, top work, blockers, pulse). Call
`endSession({ summary, ... })` before wrapping up — it saves the handoff,
links new commits, reports touched cards, and returns a resume prompt for
the next chat. Both auto-detect the board from your git repo.

**Tool architecture:** 9 essential tools are always visible (briefMe,
endSession, createCard, updateCard, moveCard, addComment, checkOnboarding,
getTools, runTool). Extended tools — including getBoard, searchCards,
getRoadmap — live behind `getTools`/`runTool`; briefMe composes the common
session-start views. Call `getTools()` with no args to see all categories.

**Basics:** Reference cards by #number (e.g. "working on #7"). Move cards to
reflect progress. Use `addComment` for decisions and blockers.
```

See [AGENTS.md](AGENTS.md) for the full agent guidelines.

## How It Works

```
You (Browser)  <-->  Next.js App (localhost:3100)  <-->  SQLite file (data/tracker.db)
                     (launchd background service)              ^
AI Agent (Claude Code)  <-->  MCP Server  --------------------|
                              (auto-started by Claude Code)
```

- **Data lives in a SQLite file** on your machine. Stop everything, come back tomorrow — your data is still there.
- **The MCP server starts automatically** when Claude Code needs it (configured via `.mcp.json`). You don't run it manually.
- **The web UI** runs as a background service via launchd (port 3100) — always available, no manual startup. Use `npm run dev` (port 3000) only when developing the tracker itself.
- **No authentication** — this is a single-user local tool.

## MCP Surface

The tracker uses an **Essential + Catalog** pattern: 9 essential tools are always loaded in the agent's context. Extended tools (including `getBoard`, `searchCards`, `getRoadmap`) are discoverable via `getTools` and executable via `runTool` — this keeps the base context small while providing deep functionality on demand.

<!-- tracker:essentials:start -->
### Essential Tools (9)

| Tool | What it does |
| --- | --- |
| `briefMe` | One-shot session primer — handoff, diff, top work, blockers, open decisions, pulse. |
| `endSession` | Session wrap-up — saves handoff, links commits, reports touched cards, returns resume prompt. |
| `createCard` | Create a card in a column (by name). |
| `updateCard` | Update card fields; optional `intent`. |
| `moveCard` | Move a card to a column. Requires `intent`. |
| `addComment` | Add a comment to a card. |
| `checkOnboarding` | Detect DB state, list projects/boards, session-start discovery. |
| `getTools` | Browse extended tools by category. |
| `runTool` | Execute any extended tool by name. |
<!-- tracker:essentials:end -->

<!-- tracker:extended:start -->
### Extended Tools (by category)

| Category | Count | Tools |
| --- | --- | --- |
| `activity` | 1 | `listActivity` |
| `cards` | 5 | `bulkCreateCards`, `bulkMoveCards`, `bulkUpdateCards`, `createCardFromTemplate`, `deleteCard` |
| `checklist` | 3 | `addChecklistItem`, `bulkAddChecklistItems`, `toggleChecklistItem` |
| `comments` | 1 | `listComments` |
| `context` | 6 | `getCardContext`, `getMilestoneContext`, `getTagContext`, `listFacts`, `queryKnowledge`, `saveFact` |
| `decisions` | 3 | `getDecisions`, `recordDecision`, `updateDecision` |
| `discovery` | 13 | `auditBoard`, `getBoard`, `getCard`, `getRoadmap`, `getStats`, `getToolUsageStats`, `getWorkNextSuggestion`, `listBoards`, `listProjects`, `queryCards`, `renderStatus`, `searchCards`, `updateProjectPrompt` |
| `git` | 3 | `getCommitSummary`, `getGitLog`, `syncGitActivity` |
| `milestones` | 3 | `createMilestone`, `listMilestones`, `updateMilestone` |
| `notes` | 3 | `createNote`, `listNotes`, `updateNote` |
| `relations` | 3 | `getBlockers`, `linkCards`, `unlinkCards` |
| `scratch` | 1 | `scratch` |
| `session` | 3 | `listHandoffs`, `loadHandoff`, `saveHandoff` |
| `setup` | 4 | `createColumn`, `createProject`, `seedTutorial`, `setRepoPath` |
<!-- tracker:extended:end -->

### Prompts (8)

| Prompt | Purpose |
| --- | --- |
| `resume-session` | Load board state + last handoff + diff since then. Use at conversation start (alternative to `briefMe`). |
| `end-session` | Superseded — returns a pointer to the `endSession` essential tool. |
| `onboarding` | Guided setup — `tutorial` seeds a sample project, `quickstart` creates a real one. |
| `deep-dive` | Load focused context for deep work on a specific card. |
| `sprint-review` | Velocity, milestone progress, stale cards, blockers. |
| `plan-work` | Planning template for breaking work into cards and checklists. |
| `setup-project` | Step-by-step guide for setting up a new project on the tracker. |
| `holistic-review` | Review board against actual codebase — sync board state with reality. |

### Resources (5)

| Resource URI | What it provides |
| --- | --- |
| `tracker://board/{boardId}` | Full board state (browsable list) |
| `tracker://board/{boardId}/card/{number}` | Single card with all details |
| `tracker://board/{boardId}/handoff` | Latest session handoff |
| `tracker://project/{projectId}/decisions` | All project decisions |
| `status://project/{slug}` | Board-derived project status (replaces STATUS.md) |

Cards get sequential numbers per project (`#1`, `#2`, `#3`). Reference them in conversation — "working on #7", "move #12 to Done" — the agent resolves them automatically.

For detailed agent workflow guidelines, see [AGENTS.md](AGENTS.md).

## Session Lifecycle

The tracker is designed for multi-conversation workflows:

```
Conversation 1:
  briefMe → work on cards → endSession (saves handoff, links commits,
                                         returns resume prompt)

Conversation 2:
  briefMe → loads handoff + diff → picks up where you left off
```

**`briefMe`** returns a compact session primer: the last agent's handoff (what they worked on, findings, next steps, blockers), a diff of changes since then, the top 3 work-next candidates, active blockers, open decisions, and staleness warnings — in ~300-500 tokens.

**`endSession`** saves a structured handoff, runs `syncGitActivity` to link new commits referencing `#N`, reports which cards the agent touched since the last handoff, and returns a copy-pasteable resume prompt for the next conversation. It does **not** auto-move cards — the `moveCard` intent contract requires a human-readable reason on every transition, so cards should already match reality before wrapping up. A `/handoff` slash command calls the tool for you.

### Example agent workflow

```
Agent: [briefMe] → sees handoff from yesterday + 3 new changes + top work
Agent: [runTool getCardContext #4] → loads card + relations + decisions + commits
Agent: [moveCard #4 → "In Progress", intent: "starting auth impl"]
  ... writes the code ...
Agent: [runTool toggleChecklistItem] → checks off "Set up JWT middleware"
Agent: [runTool getCommitSummary #4] → sees 3 commits, 5 files changed
Agent: [runTool recordDecision] → "Used jose library for JWT — lightweight"
Agent: [moveCard #4 → "Review", intent: "tests green, ready for verify"]
Agent: [endSession summary: "...", nextSteps: [...]]  → handoff + commit linkage
```

You see all of this happen on your board in real-time via SSE.

## Working with Multiple Projects

One tracker instance can serve all your projects. Run the connect script from each:

```bash
cd ~/projects/my-saas-app
/path/to/project-tracker/scripts/connect.sh

cd ~/projects/api-service
/path/to/project-tracker/scripts/connect.sh
```

Create a separate **Project** in the tracker for each codebase:

```
Project Tracker
├── "my-saas-app"      → Board: "MVP Sprint"
├── "api-service"      → Board: "Bug Fixes"
└── "design-system"    → Board: "Components"
```

The cross-project **Dashboard** at `/dashboard` shows cards across all projects in one view.

## Multi-Agent Support

The tracker works with any MCP-compatible agent (Claude, Codex, etc.). Each agent identifies itself via the `AGENT_NAME` environment variable so you can tell who did what in the activity log.

**Using the connect script:**

```bash
# Default — agent name is "Claude"
/path/to/project-tracker/scripts/connect.sh

# Custom agent name
AGENT_NAME=Codex /path/to/project-tracker/scripts/connect.sh
```

**Manual `.mcp.json` config:**

```json
{
  "mcpServers": {
    "project-tracker": {
      "command": "/path/to/project-tracker/scripts/mcp-start.sh",
      "args": [],
      "env": {
        "AGENT_NAME": "Codex"
      }
    }
  }
}
```

Multiple agents can connect to the same tracker simultaneously — they share the same SQLite database. Comments, card moves, and activity entries are attributed to whichever agent made them. Session handoffs let agents pick up each other's work across conversations.

## Tags

Tags are freeform strings on each card. Use them to organize across projects:

| Pattern | Example | Purpose |
| --- | --- | --- |
| `feature:name` | `feature:auth` | Feature areas |
| `epic:name` | `epic:v2-launch` | Epics spanning cards/projects |
| Type | `bug`, `enhancement`, `debt` | Card types |
| Status | `blocked`, `needs-review` | Status flags |

No setup required — create tags as you go, like GitHub labels.

## Available Scripts

**Development**

| Script | Description |
| --- | --- |
| `npm run setup` | Interactive setup wizard (DB + tutorial + connect) |
| `npm run dev` | Start dev server with hot reload (auto-creates DB if missing) |
| `npm run build` | Production build |
| `npm run lint` | Check code with Biome |
| `npm run type-check` | TypeScript type checking |
| `npm run mcp:dev` | Run MCP server standalone (for testing) |

**Database**

| Script | Description |
| --- | --- |
| `npm run db:push` | Push schema changes to SQLite |
| `npm run db:seed` | Seed the tutorial project |
| `npm run db:studio` | Browse database with Prisma Studio |

**Background service (launchd, port 3100)**

| Script | Description |
| --- | --- |
| `npm run service:install` | Build and start as a background service |
| `npm run service:uninstall` | Stop and remove the service |
| `npm run service:start` | Start the service |
| `npm run service:stop` | Stop the service |
| `npm run service:enable` | Re-enable auto-start and start the service |
| `npm run service:disable` | Stop and prevent auto-start on login |
| `npm run service:status` | Check if the service is running |
| `npm run service:logs` | Tail service logs |
| `npm run service:update` | Rebuild and restart after code changes |

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| API | tRPC v11 + React Query v5 |
| Database | Prisma 7 + SQLite (via better-sqlite3) |
| Drag-and-drop | @dnd-kit |
| MCP | @modelcontextprotocol/sdk (stdio) |
| UI | Tailwind CSS 4 + shadcn/ui |
| Validation | Zod 4 |

## Project Structure

```
src/
├── app/(main)/                    # App routes (projects, boards, dashboard, notes)
├── components/
│   ├── board/                     # Board UI (columns, cards, detail sheet, toolbar)
│   ├── roadmap/                   # Roadmap visualization
│   └── ui/                        # Shared UI components (shadcn/ui)
├── server/
│   ├── services/                  # Business logic (ServiceResult pattern)
│   └── api/routers/               # tRPC routers
├── mcp/
│   ├── server.ts                  # MCP server (8 essential tools, 8 prompts)
│   ├── tool-registry.ts           # Extended tool catalog (72 tools, 14 categories)
│   └── tools/                     # Domain-split tool files
├── lib/                           # Schemas, utilities, templates
└── trpc/                          # tRPC React client
scripts/                           # Setup wizard, connect script, dev runner
prisma/schema.prisma               # Data model
```

See [CLAUDE.md](CLAUDE.md) for developer-facing project config and commands.

## Troubleshooting

### MCP server shows "failed" in Claude Code

Run `/mcp` in Claude Code to see server status. If project-tracker shows as failed:

1. **Test the server manually** from your project directory:
   ```bash
   /path/to/project-tracker/scripts/mcp-start.sh
   ```
   It should print "Project Tracker MCP server running on stdio" and wait. Ctrl+C to exit.

2. **Check dependencies are installed** in project-tracker:
   ```bash
   cd /path/to/project-tracker && npm install && npx prisma generate
   ```

3. **Restart Claude Code** — MCP servers are loaded at session start, not hot-reloaded.

### Using a custom Claude Code config directory

If you use an alternate config directory (e.g. `~/.claude-alt/`), the project-level `.mcp.json` should still work. If it doesn't, add the server to your global config at `~/.claude-alt/.claude.json`:

```json
{
  "mcpServers": {
    "project-tracker": {
      "type": "stdio",
      "command": "/path/to/project-tracker/scripts/mcp-start.sh",
      "args": []
    }
  }
}
```

### Database is empty after cloning

The SQLite database (`data/tracker.db`) is gitignored — each install starts fresh. Run `npm run setup` to create the database and optionally seed a tutorial project, or run `npm run dev` which auto-creates the database on first start.

### Schema version mismatch

If `briefMe` or `resume-session` shows a migration warning, run:

```bash
npx prisma db push
```

This adds any new tables (relations, decisions, handoffs, git links, scratchpad) without losing existing data.

## License

MIT
