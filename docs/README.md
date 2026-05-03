# Pigeon `/docs` index

Pigeon is a local-first kanban board that carries context between AI coding sessions (see top-level [`README.md`](../README.md)). This folder is the in-repo doc tree — the lower-level companion to the public docs site at [2nspired.github.io/pigeon](https://2nspired.github.io/pigeon/). The site is for first-time readers; this folder is for contributors and operators of a local Pigeon checkout.

When the two disagree, the site wins for *concepts* and this folder wins for *implementation detail* — the site is curated, this folder cites code by file:line.

## Read order

Pick the entry point that matches what you're trying to do. None of these are long.

### Start here

- [`AGENT-GUIDE.md`](AGENT-GUIDE.md) — the project-agnostic guide for any AI agent (Claude, Codex, etc.) using Pigeon. Session lifecycle (`briefMe` / `saveHandoff`), column conventions, the `intent` requirement on writes, worktrees.
- [`SURFACES.md`](SURFACES.md) — `tracker.md` vs `CLAUDE.md` vs `AGENTS.md`. Three Markdown surfaces at the root of a connected project, each with a different reader and lifecycle.

### Build here (contributor reference)

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the three-layer rule: `src/lib/services` (pure logic) ↔ `src/server` (tRPC adapters) ↔ `src/mcp` (separate process). The `ServiceResult<T>` pattern, the boundary lint, where new code goes.
- [`DATA-MODEL.md`](DATA-MODEL.md) — narrative tour of `prisma/schema.prisma` grouped by domain (board / knowledge / token-tracking / system).
- [`ATTRIBUTION-ENGINE.md`](ATTRIBUTION-ENGINE.md) — the v6.3 5-tier session-attribution heuristic that backs the Costs page. Signal column, multi-In-Progress orchestrator gate, three-bucket gap UX.

### Operate here (running a local copy)

- [`UPDATING.md`](UPDATING.md) — what to do after `git pull`. The short version is `npm run service:update`; this doc has the long version including MAJOR-bump backups and rollback.
- [`commands.md`](commands.md) — every npm script Pigeon ships, with the moment you'd reach for it.
- [`token-tracking.md`](token-tracking.md) — operator setup for the Stop hook that feeds `TokenUsageEvent`. Pairs with the in-app `TokenTrackingSetupDialog`.

### Reference

- [`VERSIONING.md`](VERSIONING.md) — the semver triggers we actually apply (MAJOR / MINOR / PATCH) and the three version carriers that must agree.
- [`MIGRATION-HISTORY.md`](MIGRATION-HISTORY.md) — pre-v6 tool renames and removed surfaces. Look here when an old transcript or prompt references a tool name that no longer resolves.
- [`archive/`](archive/) — shipped RFCs and completed migration notes, kept for forensic reference.

## Cross-references at a glance

| Topic | Lives in |
|---|---|
| "How do I start a session?" | [`AGENT-GUIDE.md`](AGENT-GUIDE.md) |
| "Where does this new file go?" | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| "What does the `signal` column mean?" | [`ATTRIBUTION-ENGINE.md`](ATTRIBUTION-ENGINE.md) |
| "What's `Claim` for vs `Note`?" | [`DATA-MODEL.md`](DATA-MODEL.md) |
| "Should I bump MAJOR or MINOR?" | [`VERSIONING.md`](VERSIONING.md) |
| "How do I install the launchd service?" | [`commands.md`](commands.md) |
| "How does the Stop hook find my project?" | [`token-tracking.md`](token-tracking.md) |
| "What was renamed in v5/v6?" | [`MIGRATION-HISTORY.md`](MIGRATION-HISTORY.md) |

## Contributing edits

- These docs are written for an audience of one (Thomas) plus AI agents reading the repo. Signal-dense beats friendly.
- Cite code by file:line — `src/lib/services/attribution.ts:90` not "the attribution module."
- The docs site (`docs-site/`) is the marketing-shaped front door; only edit it for narrative copy, screenshots, or routing. Implementation detail belongs here.
- See [`VERSIONING.md`](VERSIONING.md#versioning) for which doc edits trigger which semver bump.
