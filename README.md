<div align="center">

<img src="docs-site/public/og.png" alt="Pigeon — carry context between AI coding sessions" width="900" />

# Pigeon

**A local-first kanban board that carries context between AI coding sessions.**

You see a board. The agent reads and writes the same board through MCP. Nothing leaves your machine.

[Documentation](https://2nspired.github.io/pigeon/) · [Quickstart](https://2nspired.github.io/pigeon/quickstart/) · [The session loop](https://2nspired.github.io/pigeon/workflow/) · [Why local-first?](https://2nspired.github.io/pigeon/why/)

[![License: MIT](https://img.shields.io/badge/license-MIT-1a73e8?style=flat-square)](LICENSE) [![MCP](https://img.shields.io/badge/MCP-stdio-3f51b5?style=flat-square)](https://modelcontextprotocol.io) [![Local-first](https://img.shields.io/badge/storage-SQLite%20on%20disk-444?style=flat-square)](docs/how-it-works.md)

<br />

<img src="docs-site/src/assets/screenshots/board-overview.png" alt="Pigeon board view with Backlog, In Progress, and Done columns. Cards show priority-colored stripes, tags, and stable card numbers." width="900" />

</div>

---

## What it is, in three sentences

Coding-agent conversations end. The question isn't *whether* — it's **what carries across the gap**. Pigeon's answer is the session loop: `briefMe` at session start (catch up), do the work, `saveHandoff` at session end (leave a trail), repeat.

The metaphor is in the name — agent A wraps a session with `saveHandoff`; the homing pigeon flies the message across the gap; agent B catches it at `briefMe` and starts in-context. Same SQLite file backs the kanban UI you drag cards around in and the MCP surface your agent calls. Nothing leaves your machine.

For the long-form design narrative — the two readers, the board, the `tracker.md` policy contract, the MCP surface — see [docs/how-it-works.md](docs/how-it-works.md).

## 60-second install

```bash
git clone https://github.com/2nspired/pigeon.git
cd pigeon
npm install
npm run setup            # creates the DB; optionally seeds the Learn Pigeon tutorial
npm run service:install  # macOS: registers a launchd service on :3100
                         # other platforms: npm run dev (foreground on :3000)
npm run doctor           # verifies the install (8-check diagnostic)
```

Then, from inside any project you want to track:

```bash
/path/to/pigeon/scripts/connect.sh
```

That writes a `.mcp.json` in the project's repo root. Start a new chat with your agent in that directory and ask it to run `briefMe`.

## Verify with `npm run doctor`

Pigeon ships its own install-health diagnostic — eight checks for legacy config drift, version skew, and database state, with copy-pasteable fix commands for any failure.

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

Run it after install and after every `git pull`. Exit code is `0` on green, `1` on any failure — CI-friendly.

## Documentation

The full docs site lives at **[2nspired.github.io/pigeon](https://2nspired.github.io/pigeon/)**.

**Start here**
- [Quickstart](https://2nspired.github.io/pigeon/quickstart/) — clone, install, connect, first `briefMe` call.

**Concepts**
- [How it works](docs/how-it-works.md) — the session loop, two readers, board, tracker.md, MCP surface.
- [Mental model](https://2nspired.github.io/pigeon/concepts/) — sessions, handoffs, the briefMe loop, the deprecation calendar.
- [Design rationale](https://2nspired.github.io/pigeon/why/) — why local-first, why MCP-native.

**How-to**
- [The session loop](https://2nspired.github.io/pigeon/workflow/) — the four moves: briefMe, work, saveHandoff (`/handoff`), resume.
- [Plan a card](https://2nspired.github.io/pigeon/plan-card/) — structured planning with the `planCard` tool.
- [Write a tracker.md](https://2nspired.github.io/pigeon/tracker-md/) — your project's policy contract.
- [Avoid anti-patterns](https://2nspired.github.io/pigeon/anti-patterns/) — common pitfalls and the fixes.

**Reference**
- [MCP tools](https://2nspired.github.io/pigeon/tools/) — every tool the agent can call (10 essentials + 60+ extended).
- [Commands](docs/commands.md) — every npm script with the moment you'd reach for it.
- [`docs/SURFACES.md`](docs/SURFACES.md) — `tracker.md` vs `CLAUDE.md` vs `AGENTS.md` cheat sheet.
- [`docs/token-tracking.md`](docs/token-tracking.md) — opt-in token cost capture, methodology, and the per-project Costs page.
- [AGENTS.md](AGENTS.md) — contributor reference for agent conventions.

## Releases & upgrades

- [CHANGELOG.md](CHANGELOG.md) — what changed in each release.
- [docs/UPDATING.md](docs/UPDATING.md) — what to run after `git pull` (`npm run service:update` alone is not always enough).
- [docs/VERSIONING.md](docs/VERSIONING.md) — semver + schema-version policy.
- [docs/MIGRATION-HISTORY.md](docs/MIGRATION-HISTORY.md) — pre-v6 tool renames (only useful when reading old transcripts).

## License

[MIT](LICENSE).
