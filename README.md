# Pigeon

Pigeon carries context between your AI sessions. A local-first kanban board for you and your AI coding agent — SQLite on disk, MCP over stdio, no cloud.

**Docs: [2nspired.github.io/pigeon](https://2nspired.github.io/pigeon/)**

## What it is

When you work with a coding agent, context evaporates between conversations. You re-explain what was planned, what's done, what was decided. Pigeon is the homing pigeon for that context — the agent releases it at session end, the next agent catches it at session start.

Pigeon gives you and the agent a shared workspace:

- **You see a kanban board** — cards, columns, priorities, activity, drag-and-drop.
- **The agent reads and writes the same board** via MCP tools — `createCard`, `moveCard`, `addComment`, and more.
- **Sessions hand off cleanly** — `endSession` writes a structured handoff; the next chat calls `briefMe` and picks up exactly where the last one stopped.

Nothing leaves your machine. The database is a single SQLite file you own.

## 60-second install

```bash
git clone https://github.com/2nspired/pigeon.git
cd project-tracker
npm install
npm run setup          # creates the DB, optionally seeds a tutorial
npm run service:install  # macOS: UI on localhost:3100 as a background service
                         # or: npm run dev for a foreground dev server on :3000
```

After `git pull`, see [docs/UPDATING.md](docs/UPDATING.md) for the upgrade steps — `npm run service:update` alone is not always enough. Upgrading from v4.x? Run `npm run migrate-rebrand` once after pulling v5.0 to migrate the tutorial project's name and your connected projects' `.mcp.json` keys.

Then, from inside any project you want to track:

```bash
/path/to/pigeon/scripts/connect.sh
```

That's it. Start a new chat in that project and ask your agent to run `briefMe`.

Full walkthrough, diagrams, and design rationale: **[docs site](https://2nspired.github.io/pigeon/)**.

## Tech stack

Next.js 16 + React 19 · Prisma 7 + SQLite · tRPC v11 · shadcn/ui + Tailwind 4 · `@modelcontextprotocol/sdk` (stdio).

## MCP surface

<!-- tracker:essentials:start -->
### Essential Tools (10)

| Tool | What it does |
| --- | --- |
| `briefMe` | One-shot session primer — handoff, diff, top work, blockers, recent decisions, pulse. |
| `endSession` | Session wrap-up — saves handoff, links commits, reports touched cards, returns resume prompt. |
| `createCard` | Create a card in a column (by name). |
| `updateCard` | Update card fields; optional `intent`. |
| `moveCard` | Move a card to a column. Requires `intent`. |
| `addComment` | Add a comment to a card. |
| `registerRepo` | Bind a git repo path to a project (call after briefMe returns needsRegistration). |
| `checkOnboarding` | Detect DB state, list projects/boards, session-start discovery. |
| `getTools` | Browse extended tools by category. |
| `runTool` | Execute any extended tool by name. |
<!-- tracker:essentials:end -->

50+ extended tools (cards, checklist, context, decisions, discovery, git, milestones, notes, relations, session, setup) are discoverable via `getTools` and executable via `runTool`. See the [MCP tools reference](https://2nspired.github.io/pigeon/tools/) for the full catalog.

## Scripts

| Script | Description |
| --- | --- |
| `npm run setup` | Interactive setup wizard (DB + tutorial + connect) |
| `npm run dev` | Dev server with hot reload on :3000 |
| `npm run build` | Production build |
| `npm run lint` | Biome check |
| `npm run type-check` | TypeScript |
| `npm run mcp:dev` | Run MCP server standalone |
| `npm run db:push` | Push schema changes |
| `npm run db:seed` | Seed tutorial project |
| `npm run db:studio` | Prisma Studio |
| `npm run service:*` | macOS background service (install, start, stop, logs, update) |
| `npm run release` | Verify version agreement, run quality gates, tag + push (see `docs/VERSIONING.md`) |
| `npm run docs:dev` | Dev the docs site on :4321 |
| `npm run docs:build` | Build the docs site |

## Docs

- [Quickstart](https://2nspired.github.io/pigeon/quickstart/)
- [The session loop](https://2nspired.github.io/pigeon/workflow/)
- [Design rationale](https://2nspired.github.io/pigeon/why/)
- [Anti-patterns](https://2nspired.github.io/pigeon/anti-patterns/)
- [MCP tools reference](https://2nspired.github.io/pigeon/tools/)
- [docs/SURFACES.md](docs/SURFACES.md) — when to use `tracker.md` vs `CLAUDE.md` vs `AGENTS.md`
- [AGENTS.md](AGENTS.md) — contributor guide for agent conventions
- [CLAUDE.md](CLAUDE.md) — developer-facing project config

### Releases & upgrades

- [CHANGELOG.md](CHANGELOG.md) — what changed in each release
- [docs/UPDATING.md](docs/UPDATING.md) — what to run after `git pull`
- [docs/VERSIONING.md](docs/VERSIONING.md) — semver + schema-version policy

## License

MIT
