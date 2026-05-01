# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/) — see `docs/VERSIONING.md` for the rules we apply.

Each release links to the tracker card(s) that drove it; the tracker is the single source of truth for rationale.

## [Unreleased]

### Added

- **CI: CHANGELOG `[Unreleased]` enforcement workflow** (`.github/workflows/changelog.yml`). PRs that touch `src/`, `prisma/`, `scripts/`, `docs/`, `docs-site/`, or `package.json` must update the `## [Unreleased]` section or apply a `skip-changelog` label. Documented co-located with the cadence rule in `docs/VERSIONING.md`. (#177)

### Changed

- Header "MCP" pill renamed to "Commands" (`Command` icon); popover/sheet title and copy lead with slash commands. Cmd-K search pill gains a tooltip pointing at `?` for the full catalog. (#156)

## [5.2.0] — 2026-04-30

Bundles ~24 PRs of UI, governance, and infra work since v5.1.0. Headline change is the **`endSession` → `saveHandoff` rename** (closes the slash-command/tool naming gap that drove two adoption-friction reports). Other threads: Pigeon brand rollout (logo, favicons, OG cards), in-app token tracking setup + Pulse cost surfacing, MCP tool catalog (header popover + Cmd-K palette + slash commands), TagManager UI with governance hints, and a Done-column ship-date sort that finally matches user expectation.

The slash command `/handoff` is unchanged. Humans keep typing `/handoff`; it now invokes `saveHandoff` under the hood instead of `endSession`. (#151, #152)

### Why now

Two adoption-friction reports landed in the same week — both traced to the same naming gap. The slash command and the underlying tool had different names, so users learning the loop kept tripping over which to invoke when. Renaming the tool to match the slash-command verb closes the gap before more docs ossify around the old name. The rest of this release is the accumulated work that piled up between v5.1.0 and now — backfilled in one cut to restore the CHANGELOG-as-async-signal contract.

### Schema

`SCHEMA_VERSION` 11 → 12. The bump comes from the new `Tag.state` column added by the TagManager work (#170). After pulling, run `npm run db:push` to apply.

### Added

- **TagManager UI sheet** (`src/components/tag/tag-manager.tsx`) — project-scoped tag governance surface, parallel to MilestoneManager. Sorts by usage desc; renders Singleton + Near-miss governance hint badges; AlertDialog (not `window.confirm`) for both merge and delete; disabled Delete with tooltip on any tag with usage > 0. Click a "Near-miss" badge to open the merge dialog with the peer pre-selected as the destination. Entry points: project-page boards-tab "Manage tags" button, tag-combobox dropdown footer link "Manage tags →". (#170)
- **`tag.delete` tRPC procedure** + **`deleteTag` MCP extended tool.** Orphan-only — non-orphan attempts return `USAGE_NOT_ZERO` (BAD_REQUEST) with the merge hint in the message. Atomic against concurrent CardTag inserts via a single conditional `DELETE … WHERE NOT EXISTS` — no TOCTOU window between a count and a delete. (#170)
- **`Tag.state` schema column** (`"active" | "archived"`, default `"active"`). Forward-compat for an archive flow; the column lands now to avoid a later destructive migration. (#170)
- **`tagService.merge` cross-project + archived-source guards.** Pure `validateMergeGuards` helper; the entire merge wraps in a transaction so a guard failure mid-rewrite rolls back any partial state. (#170)
- **MCP tool catalog UI — header popover + Cmd-K Essentials group** (#142). Searchable list of every registered MCP tool with category, description, and copyable invocation snippet. Cmd-K palette gains an Essentials group surfacing the 10 tools an agent needs to learn first.
- **Slash commands surfaced in MCP catalog + Cmd-K palette** (#152). `/plan-card`, `/handoff`, `/brief-me` etc. now show alongside MCP tools so the discovery surface is unified.
- **MCP catalog — mobile Sheet variant** (#145). Below the breakpoint the popover swaps to a full-height Sheet; same content, no truncation.
- **Empty-state CTA on card token cost section** (#147). When a card has zero tracked sessions, shows a one-click setup link instead of a blank panel.
- **Briefings Sheet** (#144) — right-slide Sheet matching the Sessions structure; renders the latest handoff plus diff-since-last with deep links into touched cards.
- **Pulse strip surfaces token cost + popover depth** (#148). Top-of-board pulse adds a per-session cost number with a popover breakdown by model and by tool.
- **In-app token tracking setup dialog with verify diagnostics** (#153). Walk-through dialog that writes the Stop hook into `~/.claude/settings.json` and runs a verification round-trip — replaces the previous copy-paste-this-block flow.
- **Board audit conventions + `auditBoard` taxonomy signals** (#163). New MCP tool surfaces tag/milestone drift, orphan cards, and stale columns in one report.
- **Pigeon brand rollout** — pigeon-with-sunglasses logo + favicon set + OG card (#150 / #87 / #89 / #99). Replaces the placeholder favicons and meta images that survived the v5.0 rebrand.
- **World-class docs overhaul + portfolio-grade README** (#80). Astro Starlight site rewrite; quickstart, why, anti-patterns, and per-tool reference pages.
- **CI: MCP registration check workflow** (#146). Extracts the tool registration into a barrel + adds a CI gate so a tool added to a registry but missing from the catalog fails the build.

### Changed

- **Essential tool `endSession` → `saveHandoff`.** Same shape, same semantics. Essential tool count stays at 10. Tool description, MCP catalog row, and onboarding strings updated.
- **`/handoff` slash command** now calls `saveHandoff`. No user-facing change to the keystroke.
- **Mid-session checkpoint pattern documented.** `saveHandoff({ syncGit: false })` writes a handoff snapshot without running `syncGitActivity` or producing a touched-cards report — useful for "save my place" mid-session without the end-of-session ceremony. The flag existed pre-rename; the name change makes the pattern legible.
- **Docs rewritten for the new name.** README, AGENTS.md, CLAUDE.md, every relevant page in `docs-site/`, the `/handoff` slash-command skill body, and the `142-mcp-command-palette` design spec.
- **`tag.list` / `listTags` return shape gains `_governanceHints` per row** (additive, optional). `singleton: true` when usageCount === 1; `possibleMerge: [{ id, label, distance }]` for peers within Levenshtein ≤ 2 of the tag's slug. Hints are emitted only when meaningful — agents must not treat missing fields as empty arrays. (#170)
- **`tag.list` / `listTags` accept an optional `state` filter** (`"active" | "archived"`, defaults to `"active"`). Existing callers passing only `{ projectId }` keep working; partial-key React Query invalidations still match. (#170)
- **Done column sorted by ship date.** `Card.completedAt` is set when a card moves to Done and used as the sort key, replacing position-based ordering that drifted with sibling moves (#174).
- **Position updates skip `updatedAt` bumps on unchanged siblings** (#175). Moving one card no longer dirties every other card in the column — keeps "recently changed" filters meaningful.
- **CI bumped to actions/checkout + setup-node v5 (Node 24)** (#96). Eliminates the Node 20 deprecation warnings from every workflow run.

### Fixed

- **Token tracking Stop hook command-style for Claude Code 2.1.x** (#97). The old `mcp_tool` hook shape silently no-ops on CC 2.1.x; switched to command-style hook so Stop events actually fire.
- **Lint baseline cleared.** 16 pre-existing biome errors that were blocking CI (#149) plus typography/spacing inconsistencies in the token tracking setup dialog (#94, #91, #155).

### Deprecated

- **`endSession` as a callable tool.** Retained as a non-breaking alias through v5.x. Calling it forwards to `saveHandoff` and returns a `_deprecated` warning in the response payload pointing at the new name. **Removed in v6.0.0.** Migration: update agent prompts, custom hooks, and any wrapper scripts to call `saveHandoff` directly.

### Chore

- **Gitignore `.claude/scheduled_tasks.lock` runtime** (#98) — was getting committed accidentally on agents that ran the scheduler.

### Migration

No required action for end users beyond running the schema push. Pulling v5.2 leaves `/handoff` working as before. Custom integrations that call the MCP tool directly should switch from `endSession` → `saveHandoff` before v6.0; the deprecation warning surfaces in every call until they do.

```bash
npm install
npm run db:push      # picks up SCHEMA_VERSION 11 → 12 (Tag.state column)
npm run service:update
npm run doctor       # unchanged check set; verifies the install is healthy
```

## [5.1.0] — 2026-04-29

First post-rebrand release. Focus: install-health diagnostics (so the v5.0 migration's foot-guns are detectable in one command instead of one-at-a-time discovery in production), plus rebrand-drift cleanup the v5.0 PR missed.

### Added

- **`pigeon doctor` — install health check** (#140)
  - New MCP tool `doctor` (category `diagnostics`) and `npm run doctor` CLI wrapper. Same check set, two transports.
  - Eight checks, each returning `{ status, message, fix? }` with copy-pasteable fix commands:
    1. **MCP registration** — `mcpServers.pigeon` vs legacy `project-tracker` in `~/.claude.json` and `~/.claude-alt/.claude.json` (and `$CLAUDE_CONFIG_DIR` if set).
    2. **Hook drift** — finds `mcp_tool` hooks that still reference `"server": "project-tracker"`. These silently no-op post-rename — no error, just dropped data. The v5.0 doc warned about this; the doctor catches it.
    3. **launchd label** — confirms `com.2nspired.pigeon` is loaded; flags stale `com.2nspired.project-tracker`.
    4. **Connected repos** — for each `Project.repoPath`, verifies `.mcp.json` uses the new `pigeon` key.
    5. **Server version** — running service version (via new `/api/health` endpoint) vs `package.json`. Catches users who forgot `npm run service:update` after `git pull`.
    6. **Per-project `tracker.md`** — exists at `repoPath/tracker.md` and is non-empty for every connected project.
    7. **WAL hygiene** — flags non-trivial `tracker.db-wal` size (≥4 MiB) that triggers Prisma's phantom-drop foot-gun observed during the v5.0 migration. Fix: `PRAGMA wal_checkpoint(TRUNCATE)`.
    8. **FTS5 sanity** — verifies `knowledge_fts` virtual table and all four shadow tables (`_data`, `_idx`, `_docsize`, `_config`) are present together. Flags any half-state.
  - CLI exits 0 when nothing failed (warnings are OK), 1 when at least one check is in `fail`.
  - Pretty CLI output with status glyphs (`✓` `!` `✗` `·`), aligned columns, and per-check fix lines. `NO_COLOR=1` disables color.
  - Implementation: `src/lib/doctor/` (8 checks + runner + types) — checks are pure functions where possible, accepting fs paths or db queries as parameters so they're directly unit-testable. 22 unit tests cover legacy / current / missing / malformed fixtures via temp-dir JSON.
- **`/api/health` endpoint** — returns `{ ok: true, version, brand: "pigeon" }`. Used by the doctor's server-version check; cheap enough that any consumer can poll.
- **`MIGRATING-TO-PIGEON.md`** — Step 5 now recommends `npm run doctor` as the post-migration verifier; the previous manual `briefMe` smoke check moved to a fallback.

### Fixed

- **Rebrand drift the v5.0 PR missed:**
  - `README.md` — `cd project-tracker` → `cd pigeon` after `git clone` (the first command broke for fresh installs).
  - `docs-site/src/content/docs/quickstart.mdx` — same fix.
  - `docs-site/src/content/docs/index.mdx` — frontmatter `title: Project Tracker` → `title: Pigeon`; alt-text and body copy updated.
  - `docs-site/src/content/docs/why.mdx` — opening line referenced the old brand.
  - `docs-site/src/content/docs/anti-patterns.mdx` — frontmatter description.
- **`MIGRATING-TO-PIGEON.md`:**
  - Promoted the "clear `projectPrompt` before pulling v5.0" warning from a sub-bullet to its own ⚠️ STOP-banner H3. It's the only data-loss path in the migration; depth needed to match consequence.
  - Added explicit "how to find your projectId" pointer (`runTool('listProjects')`) in the projectPrompt cleanup.
  - TL;DR now shows `npm run doctor` as the verification step, not just a printed checklist hand-wave.
- **`CHANGELOG.md`:**
  - v5.0 entry referenced the deprecation field as `_deprecation`. Actual field name is `_brandDeprecation` (per `src/mcp/server.ts:741`). Corrected.
  - `[Unreleased]` link footer compared from `v4.0.0`; rebased to `v5.1.0...HEAD`. Added missing `[5.1.0]`, `[5.0.0]`, `[4.2.0]`, `[4.1.0]` link references.

### Changed

- `package.json` `version` 5.0.0 → 5.1.0.

### Migration

No required migration. v5.1 is purely additive — no schema change, no breaking API. After pulling:

```bash
npm install
npm run service:update
npm run doctor       # verify the install
```

If `doctor` reports any `fail` results, follow the printed fix commands. Most v5.0-migration foot-guns now surface as a single fail line with a one-line fix.

## [5.0.0] — 2026-04-29

Major release: rebrand to **Pigeon** + drop the legacy `projectPrompt` DB column. Builds on the v4.2 taxonomy + token-tracking baseline.

### Rebrand: project-tracker → Pigeon (#108)

The tool is renamed to **Pigeon** — local-first kanban that carries context between AI sessions like a homing pigeon carrying a message. The metaphor: agents release at `endSession`, the next agent catches at `briefMe`.

**Why now.** The 2026 kanban-with-MCP space is crowded (Vibe Kanban, Kanbo, VS Code Agent Kanban, getbaton.dev, BatonAI). "project-tracker" reads as generic infrastructure; Pigeon names the differentiator.

**Non-breaking via dual-bin.** The MCP server registers under the new name `pigeon` (entrypoint `scripts/pigeon-start.sh`) but keeps the legacy `mcp-start.sh` working under brand alias `project-tracker`. Existing `mcpServers.project-tracker` config keys keep functioning; `briefMe` and `checkOnboarding` responses include a `_deprecation` field nudging migration. Alias removed in v6.0.

#### Migration — required after pulling v5.0

Full walkthrough: [docs/MIGRATING-TO-PIGEON.md](docs/MIGRATING-TO-PIGEON.md). TL;DR:

```bash
npm install
npm run migrate-rebrand    # one-shot: tutorial DB rename, .mcp.json key rewrites
npm run service:update
```

`migrate-rebrand` is idempotent. It updates:

1. The tutorial project name "Learn Project Tracker" → "Learn Pigeon" (cards, milestone, best-practices note).
2. Every `.mcp.json` in projects you've connected (via `Project.repoPath`) — rewrites `"project-tracker"` key → `"pigeon"`, swaps `mcp-start.sh` → `pigeon-start.sh` in the command path.

Then it prints a final checklist for steps it deliberately doesn't auto-execute:

- **launchd label rename.** `SERVICE_LABEL` changed from `com.2nspired.project-tracker` to `com.2nspired.pigeon`. To migrate, run `npm run service:uninstall && npm run service:install`. Old logs at `~/Library/Logs/project-tracker/` can be deleted by hand.
- **`~/.claude.json` MCP key rename.** The script does NOT auto-edit your Claude Code config (that file lives outside the repo and we don't want to silently rewrite it). Open it, rename `mcpServers.project-tracker` → `mcpServers.pigeon`, swap the script path to `pigeon-start.sh`. The legacy key still works during v5.x with a deprecation warning.

#### What changed in code

- New canonical entrypoint: `scripts/pigeon-start.sh` (sets `MCP_SERVER_BRAND=pigeon`).
- Legacy entrypoint: `scripts/mcp-start.sh` (sets `MCP_SERVER_BRAND=project-tracker`, emits stderr deprecation notice).
- `src/mcp/server.ts` reads `MCP_SERVER_BRAND` to set the SDK `name` field and inject a `_brandDeprecation` field into `briefMe` / `checkOnboarding` responses when legacy.
- All user-visible Pigeon strings updated: web UI header, browser title, CLI banners, slash command descriptions, README/CLAUDE.md/AGENTS.md/docs.
- Tutorial seed (`src/lib/onboarding/teaching-project.ts`) renamed; new installs get "Learn Pigeon".
- `package.json` `name` → `pigeon-mcp` (npm `pigeon` is squatted by an abandoned 2013 package).
- Tutorial seed handoff finding "Board has 5 columns" → "4 columns" (drive-by fix; v4.0.0 removed Up Next).

#### Out of scope (deferred)

- Removing the `project-tracker` alias / `mcp-start.sh` — v6.0.
- Renaming `tracker.db` filename, `tracker.md` filename, Prisma table names, `tracker://` MCP resource URIs, `TUTORIAL_SLUG = "learn-project-tracker"` — permanent (DB idempotency / public API).
- Internal `TrackerPolicy` type names and similar internal symbols — internal-only.

### Removed

- **`Project.projectPrompt` DB column** (#129) — the legacy column shipped in Phase 1 of the shared-surface migration. The `migrateProjectPrompt` tool wrote a `tracker.md` from the column's value (v4.0); the column has been deprecated since v4.1 with a `briefMe` warning whenever content remained. v5.0 drops the column entirely. `tracker.md` is the only project orientation surface going forward.
- **`migrateProjectPrompt` MCP tool** (#129) — its purpose was to migrate FROM the column TO `tracker.md`. With the column gone, the tool is non-functional; removed.
- **`updateProjectPrompt` MCP tool** (#129) — wrote to the dropped column. Edit `tracker.md` directly instead.
- **`SCHEMA_VERSION`** bumps from 10 → 11 to drop the `project_prompt` column. Run `npm run db:push` after pulling.

### Migration — required before pulling v5.0

For each project that still has content in the `projectPrompt` column, follow the v4.1 → v5.0 migration path documented in [docs/MIGRATING-TO-PIGEON.md](docs/MIGRATING-TO-PIGEON.md). TL;DR:

1. Run `briefMe()` — if the response includes a `_warnings[]` entry mentioning `projectPrompt`, **stop and migrate first.**
2. `runTool({ tool: "migrateProjectPrompt", params: { projectId } })` (on v4.x — the tool is gone in v5.0).
3. Review the new `tracker.md`, commit it.
4. Clear the DB column via Prisma Studio or the v4.x `updateProjectPrompt` tool.
5. Then pull v5.0.

Anything still in the column when you pull v5.0 is lost when the column drops. Schema migration applies cleanly via `npm run db:push`.

## [4.2.0] — 2026-04-29

Taxonomy primitives rework lands as the headliner: tags promote from a JSON-string array to a project-scoped `Tag` entity joined via `CardTag`, and milestones gain governance hints + a `mergeMilestones` admin tool. MCP write paths accept new strict params (`tagSlugs`, `milestoneId`) **alongside** the legacy ones (`tags`, `milestoneName`), with deprecation warnings and `_didYouMean` near-miss hints — v5.0.0 will drop the legacy params and the `Card.tags` JSON column. (#89, #134)

This release is purely additive on top of v4.1.0 — no destructive migration is required. `SCHEMA_VERSION` bumps from 9 → 10 to add the new `Tag`, `CardTag`, `AppSettings`, and `TokenUsageEvent` tables (plus `Milestone.state`), so **run `npm run db:push` after pulling** before restarting the service. The optional `migrateTags` MCP tool backfills the new tag junction from existing JSON tags when you're ready.

### Added

- **Taxonomy primitives** (#89, #134, PR #62)
  - New `Tag` (slug-immutable / label-mutable, project-scoped) and `CardTag` composite-PK junction.
  - New `Milestone.state` column (`active` | `archived`); case-insensitive `resolveOrCreate` normalization.
  - `mergeMilestones` MCP admin tool; `_governanceHints` (singletons + near-name neighbours) on `listMilestones`.
  - `migrateTags` MCP tool — idempotent JSON-to-junction backfill, preserves canonical label casing.
  - MCP write paths (`createCard`, `updateCard`, `bulkCreateCards`, `bulkUpdateCards`) accept `tagSlugs` + `milestoneId` alongside legacy `tags` + `milestoneName`. Legacy params emit a `_deprecated` warning with `_didYouMean` near-miss hints.
  - SSE event invalidation for tag + milestone events; project-scoped event channels.
  - `TagCombobox` and `MilestoneCombobox` UI components (Popover + Command) replace the raw text input + Select-with-sentinel pattern in the card detail sheet.
  - AGENTS.md documents the canonical milestone definition ("a milestone is a release horizon") and the dual-track param contract.
- **Token tracking** (#96, PR #64)
  - `AppSettings` singleton (JSON pricing) + `TokenUsageEvent` schema with the 5-column token split (input, output, cacheRead, cacheCreation1h, cacheCreation5m). Indexed on `sessionId`, `projectId`, `(projectId, recordedAt)`, `cardId`.
  - Verified Anthropic + OpenAI default pricing (last verified 2026-04). Unknown models fall back to `__default__` (zero rates) — surfaces as $0 instead of NaN.
  - Token-usage service (ServiceResult pattern) with `recordManual`, `recordFromTranscript` (idempotent on `sessionId`, streams parent + sub-agent JSONL), and 5 summary queries (project, session, card full-attribution, milestone, pricing).
  - `recordTokenUsage` and `recordTokenUsageFromTranscript` MCP tools (extended, behind `getTools` browse — zero system-prompt cost when not in use).
  - Stop-hook config in AGENTS.md uses `type: "mcp_tool"` with `${transcript_path}` / `${session_id}` / `${cwd}` substitution.
  - `briefMe` returns a `tokenPulse` field (parallelized in the existing Promise.all; omitted when empty).
  - Per-session cost surfaces on cards.
- **Sessions sheet** (#135, PR #66)
  - Replaces the inline `SessionHistoryPanel` with a right-slide `SessionsSheet` mirroring the `ActivitySheet` pattern.
  - Markdown-rendered summaries with collapsible Working on / Findings / Next steps / Blockers sections; Blockers always open with a red tint, Next steps open when no blockers.
  - `#N` card-ref linkification across all fields (host-supplied `resolveCardRef` callback — sheet has zero API knowledge of card lookup).
  - Filter chips: All / Has blockers / per-agent (only when >1 agent has authored).
  - Project-wide total cost chip in the sheet header when token usage exists.

### Fixed

- **Parking Lot visible in list view** (#131, PR #63) — removes the hard-coded `!col.isParking` filter in `board-list-view.tsx`. View visibility now flows entirely through `hiddenRoles`: Sprint and Review still hide parking; Planning and Default surface it.

### Migration

No required migration. To opt in to the new tag junction:

```
mcp call migrateTags { projectId: "<id>" }
```

Idempotent — re-running is a no-op once the junction is populated. Legacy `Card.tags` JSON column still reads through during v4.x and is dropped in v5.0.0.

## [4.1.0] — 2026-04-29

`briefMe` now emits a deprecation warning whenever a project still has content in the legacy `projectPrompt` DB column. The column will be removed in v5.0.0; this release is the migration window.

### Why now

`migrateProjectPrompt` shipped in v4.0.0 (#126) and writes a `tracker.md` from the current `projectPrompt` value. v4.0.0 didn't actively warn users that the column was on its way out — this release closes that gap so anyone still on the legacy path gets a clear nudge before v5.0.0 lands.

### What changed

- `loadTrackerPolicy` now returns a `DEPRECATED` warning in `result.warnings` whenever `projectPrompt` is non-empty, regardless of whether `tracker.md` exists. (Previously it only fired when *both* were populated — the "no `tracker.md` yet" case shipped silent.)
- The warning surfaces as `_warnings[]` in `briefMe` output; agents already render this field, so no client-side change is needed.

### Migration — recommended before upgrading to v5.0.0

For each project with `projectPrompt` content:

```
# 1. Write the body to tracker.md (idempotent — aborts if file exists).
mcp call migrateProjectPrompt { projectId: "<id>" }

# 2. Review the new tracker.md, commit it.

# 3. Clear the DB column. From the web UI, edit the project's prompt to empty;
#    or via Prisma Studio, set Project.projectPrompt = null.
```

Once both steps are done, the deprecation warning stops firing for that project.

### Other

- `vitest.config.ts`: exclude `.claude/**` so leftover agent worktrees don't run duplicate tests.

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

[Unreleased]: https://github.com/2nspired/pigeon/compare/v5.2.0...HEAD
[5.2.0]: https://github.com/2nspired/pigeon/releases/tag/v5.2.0
[5.1.0]: https://github.com/2nspired/pigeon/releases/tag/v5.1.0
[5.0.0]: https://github.com/2nspired/pigeon/releases/tag/v5.0.0
[4.2.0]: https://github.com/2nspired/pigeon/releases/tag/v4.2.0
[4.1.0]: https://github.com/2nspired/pigeon/releases/tag/v4.1.0
[4.0.0]: https://github.com/2nspired/pigeon/releases/tag/v4.0.0
[3.0.0]: https://github.com/2nspired/pigeon/releases/tag/v3.0.0
[2.5.0]: https://github.com/2nspired/pigeon/releases/tag/v2.5.0
[2.4.0]: https://github.com/2nspired/pigeon/releases/tag/v2.4.0
[2.3.0]: https://github.com/2nspired/pigeon/releases/tag/v2.3.0
