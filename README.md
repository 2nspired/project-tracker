<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs-site/public/pigeon-logo-dark.png">
  <img src="docs-site/public/pigeon-logo-light.png" alt="Pigeon" width="240" />
</picture>

# Pigeon

**The only kanban that's also an MCP server. Your AI agents read and write the board the way you do — and Pigeon makes their cost legible.**

You see a board. The agent reads and writes the same board through MCP. Nothing leaves your machine.

[Documentation](https://2nspired.github.io/pigeon/) · [Quickstart](https://2nspired.github.io/pigeon/quickstart/) · [The session loop](https://2nspired.github.io/pigeon/workflow/) · [Why local-first?](https://2nspired.github.io/pigeon/why/)

[![License: MIT](https://img.shields.io/badge/license-MIT-1a73e8?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-6.2.1-1a73e8?style=flat-square)](CHANGELOG.md)
[![Build](https://img.shields.io/github/actions/workflow/status/2nspired/pigeon/check.yml?branch=main&style=flat-square&label=build)](https://github.com/2nspired/pigeon/actions/workflows/check.yml)
[![MCP](https://img.shields.io/badge/MCP-stdio-3f51b5?style=flat-square)](https://modelcontextprotocol.io)
[![Local-first](https://img.shields.io/badge/storage-SQLite%20on%20disk-444?style=flat-square)](https://2nspired.github.io/pigeon/concepts/)
[![Schema](https://img.shields.io/badge/schema-v15-444?style=flat-square)](docs/VERSIONING.md)

<br />

<img src="docs-site/src/assets/screenshots/board-overview.png" alt="Pigeon board view with Backlog, In Progress, and Done columns. Cards show priority-colored stripes, tags, and stable card numbers." width="900" />

</div>

---

## What it is, in three sentences

Coding-agent conversations end. The question isn't *whether* — it's **what carries across the gap**. Pigeon's answer is the session loop: `briefMe` at session start (catch up), do the work, `saveHandoff` at session end (leave a trail), repeat.

The metaphor is in the name — agent A wraps a session with `saveHandoff`; the homing pigeon flies the message across the gap; agent B catches it at `briefMe` and starts in-context. Same SQLite file backs the kanban UI you drag cards around in and the MCP surface your agent calls. Nothing leaves your machine.

For the long-form design narrative — the two readers, the board, the `tracker.md` policy contract, the MCP surface — see [Concepts](https://2nspired.github.io/pigeon/concepts/).

## 30-second demo

<!-- TODO(user): supply a 15–30s demo GIF/MP4 of the session loop (briefMe → make a card change → /handoff). Place at docs/assets/demo.gif and replace the ASCII diagram below with: <img src="docs/assets/demo.gif" alt="Pigeon session loop demo" width="900" />. -->

The session loop, end-to-end:

```text
  ┌──────────────┐    briefMe       ┌────────────────┐    saveHandoff   ┌──────────────┐
  │  fresh chat  │ ───────────────► │   do the work  │ ───────────────► │  next chat   │
  │  (agent B)   │   load board,    │   move cards,  │   /handoff       │  (agent C)   │
  │              │   handoff, top   │   addComment,  │   wraps with     │              │
  │              │   work, blockers │   updateCard   │   summary +      │              │
  │              │                  │                │   commits        │              │
  └──────────────┘                  └────────────────┘                  └──────────────┘
         ▲                                                                      │
         └──────────────────────────────────────────────────────────────────────┘
                          briefMe again — the loop closes
```

You see the same board the agent does. Drag cards in the UI; the agent's next `briefMe` will reflect the change. The agent moves a card; you see it move on screen.

## Pigeon vs. the alternatives

How Pigeon stacks up against what people actually use today for tracking AI-assisted work:

| Dimension | Pigeon | GitHub Projects | Linear | Notion DB | Plain spreadsheet |
| :-- | :-: | :-: | :-: | :-: | :-: |
| Local-first (your data on your disk) | yes | no | no | no | yes (file) |
| AI-native (agents read/write via MCP) | yes | unclear | unclear | unclear | no |
| Free / self-hosted | yes | free w/ GitHub | freemium | freemium | yes |
| Multi-user collaboration | no (solo) | yes | yes | yes | yes (shared file) |
| Opinionated workflow (session loop, intent, handoffs) | yes | no | partial | no | no |
| MCP server out of the box | yes | no | no | no | no |
| Cost legibility for AI work | yes (Costs page) | no | no | no | no |

Notes on "unclear" entries: GitHub Projects, Linear, and Notion all have public APIs that an MCP server *could* be built against, and community MCP shims exist for some — but none ship a first-party MCP server that's the canonical surface for AI agents. Pigeon is built MCP-first.

## Who's it for

Pigeon is built for two readers — see [Pigeon ICP](https://2nspired.github.io/pigeon/why/) for the long version.

- **Indie dev or consultant juggling parallel projects.** You bounce between three repos in a day, each with its own context. Pigeon gives every project a board the agent can resume from cold — no more "tell me again what we were doing" at the start of every chat.
- **Product Owner running an AI-assisted team.** You don't write the code, but you need to know what got done, how much it cost, and whether the work is converging. Pigeon's Costs page shows attributable spend per card; the board shows what's in flight without you having to ping the agent.

## 60-second install

Common setup, every platform:

```bash
git clone https://github.com/2nspired/pigeon.git
cd pigeon
npm install
npm run setup            # interactive: creates the DB, optionally seeds the Learn Pigeon tutorial
```

Then start the UI — pick the block for your platform:

**macOS** — installs a persistent launchd service on `:3100`, always available, restarts on crash:

```bash
npm run service:install
npm run doctor           # verifies the install (8-check diagnostic)
```

**Linux / Windows / WSL** — runs the foreground dev server on `:3000` (you re-run it each shell):

```bash
npm run dev              # leave running; open http://localhost:3000
npm run doctor           # in a second terminal — verifies the install
```

Then, from inside any project you want to track:

```bash
/path/to/pigeon/scripts/connect.sh
```

That writes a `.mcp.json` in the project's repo root, installs Pigeon's slash commands, and installs the Stop hook. Start a new chat with your agent in that directory and ask it to run `briefMe`.

## What you get after install

- A kanban board at `localhost:3100` (macOS) or `localhost:3000` (other platforms) — drag cards around, see priority stripes, filter by tag.
- An MCP server your agent calls — `briefMe`, `moveCard`, `addComment`, `saveHandoff`, plus 65+ extended tools (`planCard`, `recordDecision`, search, costs).
- A Costs page — per-card attributed spend, top-N expensive sessions, briefMe-vs-naive savings, project-wide MCP overhead.
- An 8-check doctor (`npm run doctor`) — exit code `0` on green, `1` on any failure. CI-friendly.

```text
Pigeon Doctor — install health check
────────────────────────────────────
✓ MCP registration             PASS
✓ Hook drift                   PASS
✓ launchd label                PASS
✓ Connected repos              PASS
✓ Server version               PASS
✓ Per-project tracker.md       PASS
✓ WAL hygiene                  PASS
✓ FTS5 sanity                  PASS

8 pass
All checks passed.
```

Run it after install and after every `git pull`. Stuck on something the doctor doesn't fix? See the **[Troubleshooting page](https://2nspired.github.io/pigeon/troubleshooting/)** — one page covering MCP not connecting, `briefMe` failing on missing `repoPath`, schema drift, FTS5 half-state, launchd label drift, stop-hook silently no-op'ing, old tool names, `_versionMismatch`.

## Documentation

Two surfaces, different audiences:

- **[2nspired.github.io/pigeon](https://2nspired.github.io/pigeon/)** — the public docs site. First-time readers, narrative concepts, quickstart.
- **[`docs/README.md`](docs/README.md)** — the in-repo doc tree. Contributors and operators of a local Pigeon checkout: architecture, data model, attribution engine, operating runbook.

When the two disagree, the site wins for *concepts*; the in-repo tree wins for *implementation detail* (cited by file:line).

**Most-asked entry points**

- [Quickstart](https://2nspired.github.io/pigeon/quickstart/) — clone, install, connect, first `briefMe` call.
- [The session loop](https://2nspired.github.io/pigeon/workflow/) — the four moves: briefMe, work, saveHandoff (`/handoff`), resume.
- [MCP tools](https://2nspired.github.io/pigeon/tools/) — every tool the agent can call (10 essentials + 65+ extended).
- [Cost tracking](https://2nspired.github.io/pigeon/costs/) — what the Costs page records, how attribution works, and the savings/overhead math.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the three-layer rule and where new code goes.
- [AGENTS.md](AGENTS.md) — contributor reference for agent conventions.

## Releases & upgrades

- [RELEASES.md](RELEASES.md) — what shipped, in plain language (3–5 bullets per release).
- [CHANGELOG.md](CHANGELOG.md) — every change with card and PR refs.
- [docs/UPDATING.md](docs/UPDATING.md) — what to run after `git pull` (`npm run service:update` alone is not always enough).
- [docs/VERSIONING.md](docs/VERSIONING.md) — semver + schema-version policy.
- [docs/MIGRATION-HISTORY.md](docs/MIGRATION-HISTORY.md) — pre-v6 tool renames (only useful when reading old transcripts).

## License

[MIT](LICENSE) — © 2026 Thomas Trudzinski / 2nspired.
