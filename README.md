# Project Tracker

A local-first kanban board with MCP integration for AI-assisted development. Your AI coding agent reads and updates the board while you work together — both of you stay in sync across conversations.

**The problem:** When working with AI coding agents, context gets lost between conversations. What was planned? What's done? What decisions were made? You end up re-explaining everything.

**The solution:** A shared workspace with persistent memory. You see cards, columns, and progress in the browser. Your agent sees structured context it can read and write through MCP tools. Session handoffs carry context between conversations — the next session picks up exactly where the last one left off.

## What It Looks Like

- Kanban board with drag-and-drop
- Cards with priority, tags, checklists, comments, and activity log
- Card numbers (`#1`, `#2`) for easy reference in conversation
- Card templates (Bug Report, Feature, Spike, Tech Debt, Epic)
- Card dependencies — blocks, related, parent/child relationships with blocked indicators
- Architectural decision records linked to cards
- Git commit auto-linking — commits referencing `#N` are linked to cards
- Session handoffs — agents save context for the next conversation
- Agent scratchpad — ephemeral working memory that auto-expires
- Roadmap view with milestone horizons and river flow visualization
- Cross-project dashboard
- Notes scratch pad with promote-to-card
- Activity feed showing agent and human actions
- Parking Lot column for ideas that aren't actionable yet
- Project colors for quick visual identification
- Real-time updates via SSE — board refreshes instantly when agents make changes (falls back to polling)
- Multi-agent support (Claude, Codex, etc.) via `AGENT_NAME` env var
- TOON encoding for ~40% token savings in agent responses
- Board filtering — fetch specific columns, exclude Done, summary mode for lightweight views
- Bulk operations — update cards, add checklists, set milestones in batch
- Board audit — find cards missing priority, tags, milestones, or checklists
- Schema version detection with migration hints

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

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see your boards. If the database doesn't exist yet, `npm run dev` creates it automatically.

> **Note:** The web UI is optional. The MCP server works independently — your agent can use the board even without the browser open. But the UI is where you'll visually track progress.

### 4. Connect your project

From your project directory, run the connect script:

```bash
/path/to/project-tracker/scripts/connect.sh
```

This creates a `.mcp.json` in your project that tells your agent where to find the tracker's MCP server. That's it — next time you start a conversation in that project, the tracker tools are available.

For non-Claude agents, set the agent name:

```bash
AGENT_NAME=Codex /path/to/project-tracker/scripts/connect.sh
```

### 5. Add tracking instructions to your project (optional)

Add this to your project's agent instructions file (`CLAUDE.md`, `AGENTS.md`, etc.) so the agent knows to use the board:

```markdown
## Project Tracking

This project is tracked in the Project Tracker board.
Use the `project-tracker` MCP tools to read and update the board.
Use the `resume-session` prompt with the board ID at the start of each conversation.
Use `end-session` before wrapping up to save handoff for the next session.
Reference cards by #number in conversation (e.g. "working on #7").
```

See [AGENTS.md](AGENTS.md) for the full shared agent guidelines (column definitions, workflow conventions, efficiency tips).

## How It Works

```
You (Browser)  <-->  Next.js App  <-->  SQLite file (data/tracker.db)
                                              ^
AI Agent (Claude Code)  <-->  MCP Server  ----┘
                              (auto-started by Claude Code)
```

- **Data lives in a SQLite file** on your machine. Stop everything, come back tomorrow — your data is still there.
- **The MCP server starts automatically** when Claude Code needs it (configured via `.mcp.json`). You don't run it manually.
- **The web UI** (`npm run dev`) is for you to visually browse boards. It's optional but useful.
- **No authentication** — this is a single-user local tool.

## Setting Up with Claude Code (Prompt)

If you'd rather have Claude set things up for you, paste this prompt into Claude Code from your project directory:

```
I want to connect this project to my Project Tracker board.

The project tracker is installed at: /path/to/project-tracker

Please run the connect script at /path/to/project-tracker/scripts/connect.sh from this directory to create the .mcp.json file. Then add a "Project Tracking" section to this project's CLAUDE.md explaining that the project is tracked via the project-tracker MCP tools, cards should be referenced by #number, and the agent should use the resume-session prompt at the beginning of each conversation and end-session before wrapping up.
```

Replace `/path/to/project-tracker` with the actual path where you cloned this repo.

## What the Agent Can Do

The tracker uses an **Essential + Catalog** pattern: 10 essential tools are always loaded in the agent's context. 45 additional tools are discoverable via `getTools` and executable via `runTool` — this keeps the base context small while providing deep functionality on demand.

### Essential MCP Tools (10)

| Tool | What it does |
| --- | --- |
| `getBoard` | Board state with filtering — `columns` to fetch specific columns, `excludeDone` to skip Done/Parking, `summary` for lightweight view. TOON format by default. |
| `createCard` | Create a card in a column (by name); auto-creates milestones |
| `updateCard` | Update any card fields |
| `moveCard` | Move to column by name (e.g. "In Progress") |
| `addComment` | Add a comment — decisions, blockers, context |
| `searchCards` | Search across all projects by text or tag |
| `getRoadmap` | Cards grouped by milestone and horizon (now/next/later/done) |
| `checkOnboarding` | Detect setup state + return project/board list inline — one call to get started |
| `getTools` | Browse 51 extended tools by category |
| `runTool` | Execute any extended tool by name |

### Extended Tool Categories (51 tools)

| Category | Tools | What they do |
| --- | --- | --- |
| `discovery` | 8 | List projects/boards/cards, stats, smart queries, board audit, similarity search, work-next suggestions |
| `cards` | 5 | Bulk create, bulk update, templates, bulk move, delete |
| `checklist` | 4 | Add, bulk add, toggle, delete checklist items |
| `comments` | 2 | List and delete comments |
| `milestones` | 5 | Create, update, set (by ID or name), bulk set, list with completion % |
| `notes` | 4 | Create, update, list, delete project notes |
| `activity` | 1 | View recent activity history |
| `setup` | 4 | Create projects, columns, set repo path, seed tutorial |
| `relations` | 3 | Link/unlink cards, get blockers |
| `session` | 3 | Save/load handoffs, board diff |
| `decisions` | 3 | Record, list, update architectural decisions |
| `scratch` | 4 | Set, get, list, clear ephemeral agent notes |
| `git` | 4 | Sync commits, get log, code map, card commits |
| `context` | 1 | Focus context bundles (card/milestone/tag scope) |

### MCP Prompts (8)

| Prompt | Purpose |
| --- | --- |
| `resume-session` | Load board state + last handoff + diff since then. Use at conversation start. |
| `end-session` | Review board accuracy, save handoff, clean up. Use before wrapping up. |
| `onboarding` | Guided setup — `tutorial` seeds a sample project, `quickstart` creates a real one. |
| `deep-dive` | Load focused context for deep work on a specific card. |
| `sprint-review` | Velocity, milestone progress, stale cards, blockers. |
| `plan-work` | Planning template for breaking work into cards and checklists. |
| `setup-project` | Step-by-step guide for setting up a new project on the tracker. |
| `holistic-review` | Review board against actual codebase — sync board state with reality. |

### MCP Resources (4)

| Resource URI | What it provides |
| --- | --- |
| `tracker://board/{boardId}` | Full board state (browsable list) |
| `tracker://board/{boardId}/card/{number}` | Single card with all details |
| `tracker://board/{boardId}/handoff` | Latest session handoff |
| `tracker://project/{projectId}/decisions` | All project decisions |

### Card References

Cards get sequential numbers per project (`#1`, `#2`, `#3`). Use these in conversation:

- "Working on #7"
- "Move #12 to Done"
- "Add a checklist item to #3"

The agent resolves `#number` references automatically — no UUIDs needed.

## Session Lifecycle

The tracker is designed for multi-conversation workflows:

```
Conversation 1:
  resume-session → work on cards → end-session (saves handoff)

Conversation 2:
  resume-session → loads handoff + diff → picks up where you left off
```

**`resume-session`** loads the board state, the last agent's handoff (what they worked on, findings, next steps, blockers), and a diff of changes since then. The agent is immediately productive without re-explaining context.

**`end-session`** walks the agent through a checklist: review board accuracy, move completed cards, update checklists, save a handoff with context for the next session, and add comments on cards with important information.

## Example Agent Workflow

```
Agent: [resume-session] → sees handoff from yesterday + 3 new changes
Agent: [getFocusContext #4] → loads card + relations + decisions + commits
Agent: [moves #4 → "In Progress"]
  ... writes the code ...
Agent: [toggleChecklistItem] → checks off "Set up JWT middleware"
Agent: [syncGitActivity] → links new commits to cards
Agent: [recordDecision] → "Used jose library for JWT — lightweight, no deps"
Agent: [end-session] → saves handoff for next conversation
```

You see all of this happen on your board in real-time via SSE.

## Connecting Multiple Projects

One tracker instance can serve all your projects. Run the connect script from each project:

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
├── "api-service"       → Board: "Bug Fixes"
└── "design-system"     → Board: "Components"
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

Multiple agents can connect to the same tracker simultaneously — they all share the same SQLite database. Comments, card moves, and activity entries are attributed to whichever agent made them. Session handoffs let agents pick up each other's work across conversations.

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

| Script | Description |
| --- | --- |
| `npm run setup` | Interactive setup wizard (DB + tutorial + connect) |
| `npm run dev` | Start web UI (auto-creates DB if missing) |
| `npm run build` | Production build |
| `npm run db:push` | Push schema changes to SQLite |
| `npm run db:seed` | Seed the tutorial project |
| `npm run db:studio` | Browse database with Prisma Studio |
| `npm run mcp:dev` | Run MCP server standalone (for testing) |
| `npm run lint` | Check code with Biome |
| `npm run type-check` | TypeScript type checking |

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
├── app/(main)/                    # App routes
│   ├── page.tsx                   # Home (project list)
│   ├── dashboard/                 # Cross-project dashboard
│   ├── notes/                     # Notes scratch pad
│   └── projects/[id]/boards/[id]/ # Kanban board
│       ├── timeline/              # Card timeline view
│       └── roadmap/               # Milestone roadmap view
├── components/
│   ├── board/                     # Board UI (columns, cards, detail sheet, toolbar)
│   └── roadmap/                   # Roadmap visualization components
├── server/
│   ├── services/                  # Business logic (ServiceResult pattern)
│   └── api/routers/               # tRPC routers
├── mcp/
│   ├── server.ts                  # MCP server (10 essential tools, 8 prompts)
│   ├── tool-registry.ts           # Extended tool catalog (51 tools, 14 categories)
│   ├── extended-tools.ts          # Core extended tools
│   ├── tools/                     # Domain-split tool files
│   │   ├── relation-tools.ts      # Card dependencies
│   │   ├── session-tools.ts       # Session handoff + diff
│   │   ├── decision-tools.ts      # Architectural decisions
│   │   ├── scratch-tools.ts       # Agent scratchpad
│   │   ├── git-tools.ts           # Git commit linking
│   │   ├── query-tools.ts         # Smart queries
│   │   ├── context-tools.ts       # Focus context bundles
│   │   └── onboarding-tools.ts    # Tutorial project seeding
│   ├── resources.ts               # 4 MCP resources
│   ├── git-utils.ts               # Git child_process wrapper
│   ├── toon.ts                    # TOON compact encoding
│   └── utils.ts                   # Shared helpers, version detection
├── lib/
│   ├── schemas/                   # Zod validation
│   ├── onboarding/                # Teaching project data + seed runner
│   └── card-templates.ts          # Card templates
└── trpc/                          # tRPC React client
scripts/
├── connect.sh                     # Connect any project to the tracker
├── setup.ts                       # Interactive setup wizard
└── dev.ts                         # Smart dev script (auto-creates DB)
prisma/
├── schema.prisma                  # Data model (15 models)
└── seed.ts                        # CLI seed entry point
data/tracker.db                    # SQLite database (gitignored)
AGENTS.md                          # Shared agent guidelines (all agents)
CLAUDE.md                          # Claude-specific project config
```

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

If `resume-session` shows a migration warning, run:

```bash
npx prisma db push
```

This adds any new tables (relations, decisions, handoffs, git links, scratchpad) without losing existing data.

## License

MIT
