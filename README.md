# Project Tracker

A local-first kanban board with MCP integration for AI-assisted development. Your AI coding agent reads and updates the board while you work together — both of you stay in sync across conversations.

**The problem:** When working with AI coding agents, context gets lost between conversations. What was planned? What's done? What decisions were made? You end up re-explaining everything.

**The solution:** A shared workspace. You see cards, columns, and progress in the browser. Your agent sees structured context it can read and write through MCP tools. The board persists across conversations — the next session picks up exactly where the last one left off.

## What It Looks Like

- Kanban board with drag-and-drop
- Cards with priority, tags, checklists, comments, and activity log
- Card numbers (`#1`, `#2`) for easy reference in conversation
- Card templates (Bug Report, Feature, Spike, Tech Debt, Epic)
- Cross-project dashboard
- Notes scratch pad with promote-to-card
- Activity feed showing agent and human actions
- Parking Lot column for ideas that aren't actionable yet
- Project colors for quick visual identification
- Auto-polling — board updates every 3 seconds when agents make changes
- Multi-agent support (Claude, Codex, etc.) via `AGENT_NAME` env var
- 16 MCP tools + 3 MCP prompts for agent workflows

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/2nspired/project-tracker.git
cd project-tracker
npm install
```

### 2. Set up the database

```bash
npx prisma generate
npx prisma db push
```

This creates a local SQLite database at `data/tracker.db`. No accounts, no cloud, no cost — everything runs on your machine.

### 3. Start the web UI

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see your boards.

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
At the start of each conversation, use the `start-session` prompt with the board ID.
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

Please run the connect script at /path/to/project-tracker/scripts/connect.sh from this directory to create the .mcp.json file. Then add a "Project Tracking" section to this project's CLAUDE.md explaining that the project is tracked via the project-tracker MCP tools, cards should be referenced by #number, and the agent should use the start-session prompt at the beginning of each conversation.
```

Replace `/path/to/project-tracker` with the actual path where you cloned this repo.

## What the Agent Can Do

### MCP Tools (16)

| Tool | What it does |
| --- | --- |
| `listProjects` | See all projects |
| `getBoard` | Full board state — columns, cards, checklists |
| `listCards` | Cards with filters (tag, priority, assignee) |
| `searchCards` | Search across all projects by text or tag |
| `createCard` | Create a card in a column (by column name) |
| `bulkCreateCards` | Create multiple cards at once (for planning) |
| `createCardFromTemplate` | Create from template (Bug, Feature, Spike, Tech Debt, Epic) |
| `updateCard` | Update any card fields |
| `moveCard` | Move to column by name (e.g. "In Progress") |
| `deleteCard` | Remove a card |
| `addChecklistItem` | Add a sub-task to a card |
| `toggleChecklistItem` | Check/uncheck a sub-task |
| `addComment` | Add a note — decisions, blockers, context |
| `listComments` | Read all comments on a card |
| `createColumn` | Add a new column to a board |
| `createProject` | Set up a new project with a default board |

### MCP Prompts (3)

| Prompt | Purpose |
| --- | --- |
| `start-session` | Structured overview of board state + suggested actions. Use at conversation start. |
| `plan-work` | Planning template for breaking work into cards and checklists. |
| `setup-project` | Step-by-step guide for setting up a new project. Reads docs, creates cards, configures CLAUDE.md. |

### Card References

Cards get sequential numbers per project (`#1`, `#2`, `#3`). Use these in conversation:

- "Working on #7"
- "Move #12 to Done"
- "Add a checklist item to #3"

The agent resolves `#number` references automatically — no UUIDs needed.

## Example Agent Workflow

```
Agent: [calls getBoard] → sees "#4 Add user auth" in To Do
Agent: [calls moveCard #4 → "In Progress"]
Agent: [calls addChecklistItem #4] → "Set up JWT middleware"
Agent: [calls addChecklistItem #4] → "Create login endpoint"
  ... writes the code ...
Agent: [calls toggleChecklistItem] → checks off "Set up JWT middleware"
Agent: [calls addComment #4] → "Used jose library — expires in 7d"
  ... finishes ...
Agent: [calls moveCard #4 → "Done"]
```

You see all of this happen on your board in real-time (3-second polling).

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

Multiple agents can connect to the same tracker simultaneously — they all share the same SQLite database. Comments, card moves, and activity entries are attributed to whichever agent made them.

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
| `npm run dev` | Start web UI (Turbopack) |
| `npm run build` | Production build |
| `npm run db:push` | Push schema changes to SQLite |
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
│       └── timeline/              # Card timeline view
├── components/board/              # Board UI (columns, cards, detail sheet, toolbar)
├── server/
│   ├── services/                  # Business logic (ServiceResult pattern)
│   └── api/routers/               # tRPC routers
├── mcp/
│   └── server.ts                  # MCP server (16 tools, 3 prompts)
├── lib/
│   ├── schemas/                   # Zod validation
│   └── card-templates.ts          # Card templates
└── trpc/                          # tRPC React client
scripts/
└── connect.sh                     # Connect any project to the tracker
prisma/schema.prisma               # Data model
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

The SQLite database (`data/tracker.db`) is gitignored — each install starts fresh. Run `npx prisma db push` to create the tables, then create your first project through the web UI or MCP tools.

## License

MIT
