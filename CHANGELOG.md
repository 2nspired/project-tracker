# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/) — see `docs/VERSIONING.md` for the rules we apply.

Each release links to the tracker card(s) that drove it; the tracker is the single source of truth for rationale.

## [Unreleased]

## [4.0.0] — 2026-04-29

The "Up Next" column is removed. Position-in-Backlog now expresses the human-priority queue: the top 3 cards in Backlog surface as `source: "pinned"` in `briefMe.topWork`, ahead of score-ranked cards. (#97)

This is a MAJOR bump because it requires a one-time data migration the user must run manually, in a specific order, before the new server starts. (See `docs/VERSIONING.md`.)

### Migration — REQUIRED before restarting the service

The new code expects existing Up Next columns to be migrated. If you skip the migration, cards still in old Up Next columns will get classified as `source: "scored"` in `briefMe.topWork` (deprioritized but not lost) and the column will keep rendering until you delete it manually.

**Order matters** — run with the web service stopped so SQLite isn't being written from two processes:

```bash
git pull
npm install

# 1. Stop the launchd web service (it holds an open SQLite handle).
npm run service:stop

# 2. Back up the DB before a destructive operation.
cp data/tracker.db data/tracker.db.pre-4.0.0

# 3. Review what the migration plans to do.
npx tsx scripts/migrate-remove-up-next.ts --dry-run

# 4. Apply. For each board with a "todo"-role column:
#    - moves its cards to the TOP of Backlog (preserving relative order)
#    - shifts existing Backlog cards down by N positions
#    - deletes the now-empty Up Next column
#    - re-positions remaining columns contiguously from 0
#    Idempotent — re-running is a no-op once Up Next is gone.
npx tsx scripts/migrate-remove-up-next.ts

# 5. Rebuild + restart the web service with the new code.
npm run service:update

# 6. Restart any connected MCP agent so it picks up the new briefMe shape.
```

If something looks wrong after step 4, restore the backup and stop:

```bash
cp data/tracker.db.pre-4.0.0 data/tracker.db
```

No `db:push` is needed — the Prisma schema didn't change. Only Column and Card rows are touched.

### Removed

- **Up Next column** from the default board template. New boards are created with `Backlog → In Progress → Done → Parking Lot` (plus `Review` on boards that had it). (#97)
- **`todo` column role** from `src/lib/column-roles.ts`. The role string is no longer recognized; existing columns with `role="todo"` are migrated to data inside Backlog and the column is deleted by the migration script. (#97)
- **`next` horizon** (mapped from the old `todo` role). `Horizon` is now `"now" | "later" | "done"`. The roadmap view drops the "Next" band; the dashboard horizon strip is 3 cells instead of 4. (#97)
- **`up_next` count** from the `/api/state` board response. (See "Changed" for the schema bump.) (#97)

### Changed — breaking

- **`briefMe.topWork[].source` enum** changed from `"active" | "todo" | "scored"` to `"active" | "pinned" | "scored"`. Anything that pattern-matches on `"todo"` (statusline tools, custom dashboards) needs to migrate. The `"pinned"` tier is the top 3 positions of Backlog by drag order; everything else in Backlog is `"scored"`. (#97)
- **`/api/state` schema** `1.0` → `1.1`. The `boards[].counts.up_next` field is removed. Consumers should switch to `boards[].counts.backlog` for total queued work; there is no equivalent for "what's pinned" at this layer (use `briefMe` for that). (#97)
- **`MCP_SERVER_VERSION`** `3.0.0` → `4.0.0`.
- **Default board columns** in 4 spots: `src/server/services/board-service.ts`, `src/lib/onboarding/seed-runner.ts`, `scripts/register-repo.ts`, `src/mcp/extended-tools.ts`. Any tool description or doc that referenced "Up Next" as a column name was updated to use "Backlog" or "In Progress".

### Added

- **`source: "pinned"` tier** in `briefMe.topWork`. Top 3 positions of any column with `role="backlog"` are tiered ahead of score-ranked Backlog cards. Pin threshold (3) is hardcoded — matches the topWork slice size. (#97)
- **`scripts/migrate-remove-up-next.ts`** with `--dry-run` flag. Idempotent. Defensive against orphaned project relations and boards missing a Backlog column. (#97)
- **`scripts/smoke-remove-up-next-migration.ts`** — 14 assertions covering positioning, column deletion, idempotency, and the empty-Up-Next case. (#97)
- **`scripts/smoke-pinned-topwork.ts`** — 6 assertions covering pinned-tier ranking, threshold respect, and active-over-pinned precedence. (#97)
- **Decision record** `ed467d3b-5480-4b01-9402-25eaa3356e0a` capturing the rationale (column-as-metadata anti-pattern, naming collision with the `priority` field, position-as-pin alignment with universal kanban intuition).

### Notes for tutorial users

The "Learn Project Tracker" tutorial board is also migrated: the five tutorial cards previously seeded into Up Next now sit at the top of Backlog (positions 0-4), and the "Understanding Columns" + "Set Card Priorities" cards have rewritten blurbs that teach position-as-pin instead of column-as-pin. If you re-seed the tutorial after upgrade (`npm run db:seed`), you get the new layout straight away.

## [3.0.0] — 2026-04-19

Destructive tail of the Note+Claim cutover (#86). Five legacy tables drop; the unified `Claim` + extended `Note` are the only knowledge surfaces left. No wire-shape changes to MCP tools or tRPC routers — adapters were landed in earlier commits.

### Migration — REQUIRED before `db:push`

Run the backfill once more before applying the 3.0.0 schema, even if you ran it on 2.4.0:

```bash
npx tsx scripts/migrate-notes-claims.mts
npm run db:push   # drops the 5 legacy tables
```

The backfill is idempotent — rows already migrated are skipped. The script now reads legacy tables via raw SQL so it survives the drop.

### Removed

- `SessionHandoff` table — replaced by `Note(kind="handoff")`. (#86)
- `Decision` table — replaced by `Claim(kind="decision")`. (#86)
- `PersistentContextEntry` table — replaced by `Claim(kind="context")`. (#86)
- `CodeFact` table — replaced by `Claim(kind="code")`. (#86)
- `MeasurementFact` table — replaced by `Claim(kind="measurement")`. (#86)

### Changed

- `SCHEMA_VERSION` 8 → 9.
- `MCP_SERVER_VERSION` 2.5.0 → 3.0.0.
- `getCard` MCP tool now reads decisions from `Claim` (same response shape — `{id, title, status}`).

### Added

- `docs/VERSIONING.md`, `docs/UPDATING.md`, this CHANGELOG. (#101)
- `scripts/release.ts` — version-agreement + tag automation. (#101)

## [2.5.0] — 2026-04-17

The Note table widens to carry any author/kind/metadata payload. Still additive — legacy shape-only callers continue to work.

### Added

- `Note` table gains `kind`, `author`, `cardId`, `boardId`, `metadata`, `expiresAt` as optional columns. (#86)
- `createNote` / `listNotes` / `updateNote` tools accept the new fields; `listNotes` filters by `kind`, `cardId`, `boardId`, `author`. (#86)
- tRPC `note.list` accepts the same filter set.

### Changed

- `SCHEMA_VERSION` 6 → 7.
- `MCP_SERVER_VERSION` 2.4.0 → 2.5.0.

## [2.4.0] — 2026-03 (Claim table shipped)

First cut of the unified knowledge primitive — the `Claim` row type, with MCP tools to write and list.

### Added

- `Claim` table — `kind`, `projectId`, `statement`, `body`, `evidence` (JSON), `payload` (JSON), `author`, `cardId`, `status`, `supersedesId`, `supersededById`, `recordedAtSha`, `verifiedAt`, `expiresAt`. (#86)
- `saveClaim`, `listClaims` MCP tools. (#86)

### Changed

- `SCHEMA_VERSION` 5 → 6.
- `MCP_SERVER_VERSION` 2.3.0 → 2.4.0.

## [2.3.0] — 2026-02 (session continuity)

### Added

- `endSession` essential MCP tool — wraps handoff save + summary emission for clean agent shutdown. (#62)
- `briefMe` essential tool (session primer with pulse, handoff, top work, open decisions).

### Changed

- `MCP_SERVER_VERSION` 2.2.0 → 2.3.0.

## Before 2.3.0

Earlier history is captured in the git log. Highlights:

- Phase 3 ship (UI: command palette, SSE real-time updates, optimistic UI).
- AI Context Engine (20 tools, 5 models, MCP resources, version detection).
- Initial local-first kanban board with MCP integration.

Reconstructed entries below this point are best-effort; treat git log as authoritative.

[Unreleased]: https://github.com/2nspired/project-tracker/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/2nspired/project-tracker/releases/tag/v4.0.0
[3.0.0]: https://github.com/2nspired/project-tracker/releases/tag/v3.0.0
[2.5.0]: https://github.com/2nspired/project-tracker/releases/tag/v2.5.0
[2.4.0]: https://github.com/2nspired/project-tracker/releases/tag/v2.4.0
[2.3.0]: https://github.com/2nspired/project-tracker/releases/tag/v2.3.0
