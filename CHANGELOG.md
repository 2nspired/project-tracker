# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/) — see `docs/VERSIONING.md` for the rules we apply.

Each release links to the tracker card(s) that drove it; the tracker is the single source of truth for rationale.

## [Unreleased]

### Added

- **Semantic color tokens — `--success`, `--warning`, `--danger`, `--info`, `--accent-violet`** (#241). New CSS variables in `src/app/globals.css` (`:root` + `.dark`) registered as Tailwind v4 utilities through `@theme inline` so `text-success`, `bg-warning/10`, `border-l-danger`, `text-accent-violet`, etc. resolve like first-class color utilities. Pattern: GitHub Primer's `success.fg / attention.fg / danger.fg / accent.fg`. Light values target the ~600 step on the Tailwind palette (contrast-safe on white); dark values lift to ~400 so foreground text still reads on dark surfaces. The dev `/dev/design/foundations/colors` page picks up a new "Semantic" group — `src/components/design-system/token-registry.ts` lists the five tokens alongside the existing surfaces / brand / borders / charts / sidebar buckets. Closes part of #241.

### Changed

- **Roadmap and Timeline H1s now match the rest of the app's page-title scale (`text-2xl font-bold tracking-tight`)** (#239). Audit finding (design C1) from the v6.2 audit. Top-level page surfaces (Projects, Project detail, Dashboard, Notes) all use `text-2xl font-bold tracking-tight` for their H1, but `src/app/(main)/projects/[projectId]/boards/[boardId]/roadmap/page.tsx:56` and `.../timeline/page.tsx:77` were using `text-lg font-semibold` — a board-chrome pattern copied to two pages where it didn't belong. Result: navigating from Dashboard or Projects to a board's Roadmap or Timeline view caused the page title to visibly shrink, breaking the typography hierarchy a user has been calibrated to across the rest of the app. Fix is the two-class swap on those two `<h1>` elements; no other surfaces touched. Closes #239.
- **All "done / success / warning / danger / info" colors now flow through the five semantic vars instead of raw Tailwind palette steps** (#241). The audit (design C17 + C22) found the same "done" concept rendering as four different greens — `STATUS_TEXT.done` was `text-emerald-500`, `dashboard:191` was `text-emerald-600`, `savings-section` used `emerald-700/400`, `timeline:113,136` used `green-500`. Migration: `src/lib/priority-colors.ts` `STATUS_DOT / STATUS_TEXT / STATUS_BG / STATUS_BORDER / HORIZON_DOT / AGENT_COLOR / AGENT_DOT` re-mapped to the semantic tokens (e.g. `STATUS_TEXT.done = "text-success"`). Direct call-sites migrated in `src/app/(main)/dashboard/page.tsx`, `src/app/(main)/projects/page.tsx`, `src/app/(main)/projects/[projectId]/page.tsx`, `src/app/(main)/projects/[projectId]/boards/[boardId]/timeline/page.tsx`, `src/components/costs/{savings-section,savings-methodology-sheet,card-delivery-section,pricing-override-table,section}.tsx`, `src/components/board/{board-card,board-list-view,board-pulse,board-toolbar,card-create-inline,card-detail-sheet,handoffs-sheet,session-shell,token-tracking-setup-dialog,upgrade-panel}.tsx`, `src/components/roadmap/{horizon-band,milestone-card,milestone-manager,progress-ring,roadmap-view}.tsx`, `src/components/tag/tag-manager.tsx`, `src/components/layout/server-status-pill.tsx`, and `src/lib/work-next-score.ts` (the `scoreColor` helper). The unused `AGENT_COLOR_DARK` export was dropped (the semantic var auto-flips in dark, no `dark:` variant needed). `scripts/design-lint-baseline.json` shrinks from 101 raw-priority-color entries to **0** — only the eleven `arbitrary-text-size` / `raw-animate-pulse` entries remain (those are #240 / #244 scope, not #241). The `lint:design` ratchet now fails any new `text-(emerald|green|amber|orange|red)-\d+` outside `src/lib/priority-colors.ts` because there are no longer any grandfathered exceptions for that rule. Closes #241.
- **`getWorkNextSuggestion` MCP tool now uses the shared `computeWorkNextScore` from `src/lib/work-next-score.ts` instead of its own inline copy** (#230). `src/mcp/extended-tools.ts:1542` had a parallel `computeScore` function (with its own `PRIORITY_WEIGHT` table and field names `blockedByCount` / `blocksOtherCount`) that was algorithmically identical to the canonical `computeWorkNextScore` used by `briefMe.topWork` (`src/server/services/brief-payload-service.ts`) and the board views (`src/components/board/board-view.tsx`, `board-list-view.tsx`) — but the two would have drifted independently with any future tuning, surfacing different rankings for the same board to an agent calling `getWorkNextSuggestion` versus what `briefMe` shows. Audit finding (architecture #4) from the v6.2 audit. Refactor maps the existing Prisma query output (`relationsTo` / `relationsFrom` for `blocks`-typed relations) to the canonical `ScoreableCard` shape (`_blockedByCount` / `_blocksOtherCount`) and deletes the inline copy plus its local `PRIORITY_WEIGHT` table — net `-44` lines. The 35 vitest cases locking `computeWorkNextScore` behavior (#233) now apply to both surfaces; same input produces the same ranking from `briefMe.topWork` and `getWorkNextSuggestion`. Closes #230.

### Performance

- **MCP read-only tool calls no longer spawn `git rev-parse` or hit the DB for tracker.md policy resolution** (#232). `resolvePolicyForCall` (in `src/mcp/policy-enforcement.ts`) ran a `git rev-parse --show-toplevel` subprocess (3-second timeout) plus a Prisma project lookup on **every** tool call — including read-only ones like `briefMe`, `checkOnboarding`, `getTools`, `getBoard`, `searchCards`, `listProjects`, `listActivity`, `listMilestones`, `listNotes`, `listComments`, `getStats`, `getWorkNextSuggestion`, `doctor`, and the rest of the read-only extended tools across `src/mcp/tools/*.ts` (claim, context, decision, fact, git, instrumentation, knowledge, query, relation, session, status, summary, tag). Read-only tools cannot trigger an `intent_required_on` violation (the policy gate only blocks mutating calls), so the resolver work was wasted on every read. Architecture audit finding #14. Fix: `wrapEssentialHandler` (`src/mcp/instrumentation.ts`) now takes an optional `{ readOnlyHint?: boolean }` and short-circuits the resolver when set; the three read-only essential tools (`briefMe`, `checkOnboarding`, `getTools`) pass `{ readOnlyHint: true }` at registration. `executeTool` (`src/mcp/tool-registry.ts`) symmetrically skips the resolver when an extended tool's annotations carry `readOnlyHint: true` — automatically covering every read-only extended tool already annotated in `src/mcp/extended-tools.ts` and `src/mcp/tools/*.ts`. Mutating tools (e.g. `createCard`, `moveCard`, `deleteCard`, `addComment`, `saveHandoff`, `registerRepo`) keep the existing policy gate intact. Net effect: no per-call subprocess + Prisma roundtrip on read-heavy sessions (briefMe-driven session starts, board polling, knowledge searches), measurable latency improvement on read-heavy interactive flows. New unit test `src/mcp/__tests__/readonly-policy-skip.test.ts` (7 cases) mocks `resolvePolicyForCall` and asserts it is NOT called for read-only paths and IS called for mutating paths — locking the contract for both `wrapEssentialHandler` and `executeTool`. Closes #232.

### Tests

- **Locked behavior on three high-blast-radius pure functions ahead of the v6.2 refactor wave** (#233). Added vitest coverage for `computeWorkNextScore` (`src/lib/__tests__/work-next-score.test.ts`, 35 cases) — the primary `briefMe.topWork` ranking algorithm — covering blocked-sink (`-100 + priority weight`), priority weighting (URGENT/HIGH/MEDIUM/LOW/NONE), age decay clamped at 14 days, due-date urgency bands (overdue / ≤1d / ≤3d / ≤7d), checklist progress rounding, `_blocksOtherCount` bonus, `formatScore`, and `scoreColor`. Extended the existing `src/lib/__tests__/column-roles.test.ts` with `getHorizon` + `hasRole` blocks (20 new cases, 22 total) covering the role-driven path and the silently-breakable name-fallback path (`Done` / `In Progress` / `Review` / `Backlog` / `Parking Lot`) — pinning the case-insensitive matching rules and locking the early-return order (set role beats name). Added `src/lib/services/__tests__/staleness.test.ts` (30 cases) for the shared evaluator post-#228 — agent vs human age-decay thresholds (14/30 vs 30/60 days), measurement TTL precedence over age fallback, decision supersession (with and without replacement linked), and the file-cited git-shell-out path with `node:child_process.execFile` stubbed via `vi.mock`. The staleness file uses `// @vitest-environment node` because `node:child_process` mocks don't propagate to deep imports under the project default `jsdom` environment. No source files were modified — these tests document and lock current behavior. 87 new test cases; 391/391 tests pass; lint + type-check clean. Closes #233.

### Added

- **Four CI quality gates: pre-commit hook, design lint, coverage floor, boundary lint** (#255). Replaces aspirational quality bars with concrete checks that fail PRs at the moment of violation (decision `cc69ea4d-fb87-4933-b2f0-b44b8305c6d6`), so v6.3 doesn't need another 85-finding audit.
  - **`.husky/pre-commit`** — `lint-staged` (biome on staged files) → `lint:design` + `lint:boundary` → `docs:sync` + `catalog:sync` (auto-stages regenerated files, eliminating the "the script keeps changing files I have to stage" friction) → `type-check`. Fast checks first, slow last. `git commit --no-verify` still bypasses for emergencies.
  - **`scripts/lint-design.mjs`** (`npm run lint:design`) — fails on three regex matches: arbitrary `text-\[\d+(px|rem)\]` values (use the type scale), raw `text-(emerald|green|amber|orange|red)-\d+` outside `src/lib/priority-colors.ts` (use semantic vars), raw `animate-pulse` outside `src/components/ui/skeleton.tsx` (use `<Skeleton>`). Existing 96 violations recorded in `scripts/design-lint-baseline.json` and grandfathered (Stripe-style ratchet); new violations fail CI. Per-line escape: `// design-lint-allow:<rule> — <reason>`.
  - **`vitest.config.ts` coverage floor** (`npm run test:coverage`) — v8 provider, scoped to `src/lib/**/*.ts`, threshold 30% lines (post-#255 baseline 32.74% minus 2pp headroom; future cards ratchet up). PRs that drop coverage below the floor fail CI.
  - **`scripts/lint-boundary.mjs`** (`npm run lint:boundary`) — codifies decision `a5a4cde6-5d38-4ce2-9392-a89a14685516`: `src/server/` and `src/mcp/` cannot import each other; both consume `src/lib/`. 18 known `src/mcp/ → @/server/` imports remaining post-#228 are recorded in `scripts/boundary-lint-baseline.json` and grandfathered for v6.3 cleanup; new cross-imports fail. Per-line escape: `// boundary-lint-allow — <reason>`.
  - **CI workflow** — `.github/workflows/check.yml` extended: type-check → lint → lint:design → lint:boundary → docs:check → catalog:check → test:coverage.
  - **Contributor migration:** run `npm install` once after pulling — husky's `prepare` script wires up the hook automatically. No other action needed.
- **`/dev/design` route shell + Foundations / Colors page** (#237). Pigeon now ships a living design system at `/dev/design`, mounted as a top-level `(dev)` route group sibling to `(main)` and `(auth)` so it renders without product chrome (no app header, no command palette). The shell has a sticky top bar (Pigeon brand link + disabled search-input shell + Light/Dark/System tri-state toggle wired to the existing `next-themes` provider) and a left sidebar grouping Foundations (Colors, Typography, Spacing, Radius, Icons), Primitives (Button, Input, Badge, Card, Skeleton), Patterns (Step Section), and Surfaces. Each placeholder page renders a `<ComingSoon />` card rather than 404'ing, so the nav feels real while the implementations land in sibling v6.2 cards (#239–#244). The first foundation page — `/dev/design/foundations/colors` — is fully built: every CSS color token registered in `src/components/design-system/token-registry.ts` is rendered as a swatch in BOTH light and dark side-by-side (mounted via two off-screen probe elements with and without the `.dark` class, then resolved through `getComputedStyle(...).getPropertyValue('--name')` on each — so a token added to `globals.css` and listed in the registry shows up in both columns automatically with no value hardcoding). Each swatch supports click-to-copy on the `var(--name)` reference and on the resolved `oklch(...)` value, with a `sonner` toast confirming the copy. Pattern lineage: shadcn/ui docs (sidebar + content layout), GitHub Primer `primer.style/foundations/color` (swatch + name + value + copy), Linear `app.linear.app/design` (light + dark side-by-side rather than a single-mode toggle). Decision recorded under design-system constitution `21435b2a-7ab1-49fd-97ea-8120930de0ab`. New files: `src/app/(dev)/design/{layout,page}.tsx`, `src/app/(dev)/design/foundations/colors/page.tsx`, ten placeholder pages under `src/app/(dev)/design/{foundations,primitives,patterns,surfaces}/...`, and supporting components at `src/components/design-system/{token-registry,nav,sidebar,theme-mode-toggle,coming-soon,color-swatch,colors-grid}.{ts,tsx}`. Closes #237. (#237)
- **Pricing-table column headers now carry hover tooltips** (#226). Each header on the Costs page's `<PricingOverrideTable>` (`Model` / `Input/MTok` / `Output/MTok` / `Cache Read/MTok` / `Cache 1h/MTok` / `Cache 5m/MTok`) renders as a `<Tooltip>` trigger with a one-sentence explanation of what the rate represents — input vs. output, prompt cache read vs. write, 5m vs. 1h cache lifetime — so a first-time user doesn't have to cross-reference Anthropic API docs to read the table. Trigger is a keyboard-focusable `<button type="button">` (a11y) with a dotted underline + `cursor-help` cue; tooltip content caps at `max-w-xs` (320px). Mobile is unaffected (the desktop header row hides at `<sm` breakpoints; mobile uses inline labels next to each cell value). Closes #226. (#226)

### Changed

- **Three duplicated `isDoneColumn*` helpers consolidated into the canonical `hasRole(col, "done")` from `src/lib/column-roles.ts`** (#229). The same six-line role-or-name fallback existed in three places — `src/mcp/server.ts` (`isDoneColumnRow`), `src/mcp/extended-tools.ts` (`isDoneColumnLike`), and `src/server/services/card-service.ts` (`isDoneColumn`) — each independently maintainable and silently drift-prone. All three local helpers were deleted; the four call-sites (`moveCard` flows in card-service and the two MCP move/reflow paths) now use the shared `hasRole(col, "done")` from `src/lib/column-roles.ts`, which already backed `brief-payload-service.ts` and a dozen other call-sites. No behavior change — `hasRole` implements the same role-first / lowercase-name-fallback contract. Pure refactor, locked by the `column-roles` test block landed in #233. Closes #229.
- **BREAKING: dropped the legacy `Card.tags` JSON column — finished the v4.2 → v5 tag migration** (#227). `prisma/schema.prisma` carried `tags String @default("[]")` on `Card` since the pre-v4.2 schema. v4.2 introduced the canonical `Tag` + `CardTag` junction (decision: keep tags project-scoped, dedupe on slug, keep label mutable) and dual-synced both the JSON column and the junction so existing read paths kept working through the deprecation window. We're at v6.1.0 — well past v5 — and FTS was still parsing tag labels out of the JSON column rather than joining through `CardTag`, so every card mutation paid for two writes and search results lagged by one query when the column drifted from the junction. This card finishes the migration: `Card.tags` is gone from the schema, `src/server/fts/index.ts` `indexCard` and `rebuildIndex` join through `CardTag` for the `Tags: a, b` line in the indexed content, every write site (`src/server/services/card-service.ts` `create` + `update`, `src/mcp/extended-tools.ts` `bulkCreateCards` + `createCardFromTemplate` + `bulkUpdateCards` + `getWorkNextSuggestion`, `src/mcp/server.ts` `createCard` + `updateCard` + `holistic-review`, `src/mcp/resources.ts`, `src/mcp/tools/{discovery,query,context,status}-tools.ts`, `scripts/measure-toon-savings.ts`, `src/lib/onboarding/seed-runner.ts`) drops `tags: JSON.stringify(...)` from `db.card.create` / `db.card.update` calls and reads tag labels via `cardTags: { include: { tag: { select: { label: true } } } }` instead. The API surface for `card.getById`, `card.listAll`, `board.getFull`, and every MCP tool that returns cards now exposes `tags: string[]` (a label array) directly — UI components (`board-view`, `board-list-view`, `board-card`, `card-detail-sheet`, dashboard, timeline) drop their `JSON.parse(card.tags)` calls and consume the array directly. The seed runner now creates `Tag` + `CardTag` rows for the tutorial project's tag definitions, and `card-detail-sheet`'s optimistic update no longer round-trips tags through `JSON.stringify`. The `migrateTags()` one-shot backfill (`src/lib/services/migrate-tags.ts`) — defunct now that its source column is gone — is removed; `docs/MIGRATION-HISTORY.md` flags it as historical-only. Migration: `npm run service:update` runs `prisma db push` automatically and SQLite drops the column cleanly; the existing `data/backups/tracker-pre-*.db` mechanism (#214) covers rollback if needed. Closes #227.
- **`checkStaleness` / `formatStalenessWarnings` moved from `src/mcp/` to `src/lib/services/staleness.ts`, fixing a `src/server/` ↔ `src/mcp/` layer violation** (#228). `src/server/services/brief-payload-service.ts` was importing both helpers from `src/mcp/staleness.ts`, which itself imported the MCP-process `db` singleton from `src/mcp/db` — so the Next.js web server was implicitly depending on the MCP process's Prisma client through a transitive import chain. The file's own comment acknowledged the duplication tension but the actual import created the cross-process coupling. v6.2 architecture decision (`a5a4cde6-5d38-4ce2-9392-a89a14685516`) prohibits `src/server/` ↔ `src/mcp/` cross-imports; shared logic lives in `src/lib/services/` and accepts `db: PrismaClient` as a parameter, mirroring the existing `src/lib/services/handoff.ts` pattern. `checkStaleness(db: PrismaClient, projectId: string)` now takes db as its first arg; `formatStalenessWarnings` is pure formatting and moves verbatim. `src/mcp/staleness.ts` collapses to a thin shim that binds the local MCP `db` singleton — MCP call sites in `src/mcp/server.ts` and `src/mcp/tools/session-tools.ts` stay no-arg. Foundation card for three other v6.2 wave-1 architectural-cleanup cards. 306 tests pass; lint + type-check clean; `grep -r "from ['\"]@/mcp" src/server/` returns empty (acceptance criterion). Closes #228.
- **Costs surface simplified — board scope + sections-without-data deferred until attribution is automated** (#225). Two simplifications in one change, both rooted in the same prerequisite gap: automatic card-attribution of Stop-hook events isn't yet in place, so every `TokenUsageEvent` lands with `cardId: null`, which means **(a)** board-scoped queries deterministically return $0, and **(b)** every section that joins events through cards (`<SavingsSection>`'s baseline math, `<PigeonOverheadSection>`'s tool-call attribution, `<CardDeliverySection>`'s cost-per-shipped-card) renders an empty / not-yet-measured state. The v6.1.0 Costs lens stack (#200 phases 1a / 2a / 2c / 3) and v6.1.0 ancillary sections (#194, #195, #196) shipped ahead of that prerequisite. **Board scope:** `<CostsPage>` (`src/components/costs/costs-page.tsx`) ignores `boardId` for data and child rendering — drops the board-scoped queries, the `projectWideSummary` query, the `projectHasAnyData` fallback (#223), the `BOARD'S SHARE` summary cell, the `(project-wide)` scope badges, the cross-board caveat paragraph, and the conditional pricing-table hiding. Container widens `max-w-3xl` (768px) → `max-w-5xl` (1024px) to match other content surfaces. Board-page Costs link drops `&board=` (keeps `?from=` for the breadcrumb back-link). **Sections without data:** drops `<SavingsSection>`, `<PigeonOverheadSection>`, and `<CardDeliverySection>` from the rendered Costs page — those components remain in the codebase for revival once attribution lands but no longer occupy real estate while they have nothing to show. The page now renders just two sections that actually populate: `<SummaryStrip>` (lifetime cost, last 7 days sparkline, sessions count, tracking-since) and `<PricingOverrideTable>` (per-model pricing reference + override editor). `<PricingOverrideTable>`'s section step renumbered `05` → `01` to match its new position as the only numbered section. `<BoardPulse>` (`src/components/board/board-pulse.tsx`) reverts to project-wide cost queries (#224 reversal) — removes the `projectWideSummary` query, the attribution-gap branch in the popover, and the `showAttributionGap` rendering — restoring the simple `hasAnyCost` / `showCostSetupCta` form. The `boardId` prop on `<CostsPageProps>` is preserved (route plumbing intact) but unused. Verified live on the launchd service: navigation from Development Board → Costs renders `Lifetime cost $3970 · Last 7 days $3970 · Sessions 40 · Tracking since 2 days ago` + the pricing reference table — real, populated data instead of the previous five-section page where four sections were empty. 306 tests pass; lint clean. Closes #225, supersedes the board-mode-specific behavior added in #223 and #224.

### Fixed

- **`<BoardPulse>` no longer shows project-wide cost totals on a board-scoped surface, contradicting the board-mode Costs page** (#224). The inline pulse strip on the board page calls `flowMetrics({ boardId })` (board-scoped) but was calling `getDailyCostSeries({ projectId })` and `getProjectSummary({ projectId })` (project-wide) — so a board with 0 board-attributed events still surfaced the project's total cost as if it were the board's, and the popover's "Cost / completed card" computed `(project-wide cost) / (board-scoped completions)`, a ratio whose numerator and denominator don't share a scope. Visible regression: hovering Development Board pulse showed `$3935 spent · $38.20 / completed card` while the same board's Costs page (post-#223) correctly showed `$0.0 / 0 sessions / 0.0% Board's share`. Fix: pass `boardId` to both cost queries so the inline number and popover totals match the Costs page; add a separate project-wide `projectSummary` query used only to (a) gate the "Set up token tracking" CTA so it doesn't fire when events are flowing project-wide but aren't yet card-attributed (parallel to #223's `projectHasAnyData` gate), and (b) surface the attribution gap explicitly in the popover. New popover branch when board has $0 attributed cost but the project has events: renders an explicit "No token cost attributed to this board yet — events are flowing project-wide but haven't been tied to cards on this board" message with `This board: $0` / `Project-wide: $X` rows + a `View project totals →` link to the project Costs page. Closes #224.
- **Board-scoped Costs page no longer shows the global "Set up token tracking" empty state when the project has events but the current board doesn't** (#223). `<CostsPage>` (`src/components/costs/costs-page.tsx`) computed `hasNoData` against the board-scoped `projectSummary` query — so navigating from a Board page to its Costs view (`/projects/{id}/costs?board={boardId}`) on a project that has token data attributed to other boards (or to no card at all) fired the global empty-state CTA telling the user to "Set up token tracking". This contradicted the same dialog's own "RECORDING" status pill and the project-wide event count it surfaced (e.g. "events recorded: 54"), making the screen read jumbled — the page said "no events" while the dialog said "54 events". Fix: introduce `projectHasAnyData` that checks `projectWideSummary` in board mode (and `projectSummary` in project mode), and only fire `hasNoData` when the *project as a whole* is empty. In board mode with a populated project, render the regular sections — each already has its own board-scoped empty-state branch ("No board-attributed sessions yet — savings shown at project level → View project totals", "No Pigeon tool calls recorded yet", "Cost per shipped card · 185 cards shipped · No AI cost recorded · Token events are attributed via attributeSession or Stop hook with cardId"), which is the accurate framing for a "your hook is firing but events aren't tied to cards on this board" state. `isLoading` also now waits for `projectWideSummary` in board mode so the empty state doesn't flicker on first paint while the project-wide query lands. Closes #223.
- **`text-2xs` Tailwind utility no longer silently no-ops — renders at the intended ~11px instead of falling through to 16px** (#222). `src/app/globals.css:43-44` declared the small-metadata text token using the **Tailwind v3** namespace (`--font-size-2xs: 0.6875rem` + `--font-size-2xs--line-height: 0.875rem`). The project runs **Tailwind v4** (`tailwindcss ^4.2.2`), where the text-utility namespace is `--text-{name}`, not `--font-size-{name}`. The token therefore never registered as a `text-2xs` utility — every one of the ~133 call-sites across the codebase fell through to inherited body styles (`font-size: 16px / line-height: 24px`), making metadata labels render at the same size as body text. Most visibly broken: the **Costs-page `<PricingOverrideTable>`** column headers (`INPUT/MTOK`, `OUTPUT/MTOK`, `CACHE READ/MTOK` etc.) wrapped to two lines because they were typed for ~11px metadata labels but rendered at 16px; the **`<TokenTrackingSetupDialog>` column-strip headers and "Default: $X" baselines** rendered as body-size text, making the dialog content read overstuffed (and likely contributed to the misperception in #221 that the dialog itself was miscentered — investigation showed the dialog rect was always viewport-centered, but its contents looked broken). The bug has been latent since `746e858` ("UI consistency overhaul") — the token was added but the v4 namespace wasn't applied. This card renames `--font-size-2xs` → `--text-2xs` and `--font-size-2xs--line-height` → `--text-2xs--line-height` (two-line CSS change). No call-sites needed updating; the rename is invisible to consumers because the class name `text-2xs` is unchanged. Closes #222. (#222)
- **`<TokenTrackingSetupDialog>` no longer falsely reports `NOT CONFIGURED` for project-scoped Stop-hook installs** (#220). `resolveConfigCandidates()` in `src/server/services/token-usage-service.ts` was scanning only the user-scoped paths (`$CLAUDE_CONFIG_DIR/settings.json`, `~/.claude/settings.json`, `~/.claude-alt/settings.json`) — so any user whose Stop hook lived at `<repo>/.claude/settings.local.json` (the legacy paste path that pre-dated #217's `connect.sh` auto-install) opened the Costs-page setup dialog and saw a red "not configured" banner even while events were flowing. The project-scoped paths had been deliberately removed in the #206 housekeeping bundle on the (then-correct) reasoning that `path.resolve(".claude", ...)` would resolve against the *server's* cwd (the launchd install dir at runtime), not the user's repo. That justification went stale in #210 Phase 3 (PR-B), which set `WorkingDirectory=${PROJECT_DIR}` on the launchd plist (`scripts/service.ts:74-75`) so the service runs *from* the repo root in both dev and service mode — `path.resolve(cwd, ".claude", ...)` now correctly hits the user's repo. This card reinstates `<repo>/.claude/settings.json` and `<repo>/.claude/settings.local.json` in the candidate list, refactors `resolveConfigCandidates(cwd?: string)` to accept an injectable cwd so tests don't need `process.chdir`, and replaces the stale "intentionally not resolved" comment with a one-liner pointing at the launchd plist. Four new vitest cases lock the candidate list (project-scoped paths present, user-scoped paths present, `CLAUDE_CONFIG_DIR` override honored, dedupe when env override collides with a standard path). Closes #220.

### Removed

- **Orphaned Supabase auth scaffold + three unused dependencies** (#231, closes #262). Pigeon is local-first / MCP-driven and has no auth surface at runtime — the `(auth)` route group, the `src/utilities/supabase/` client wiring, and the `src/components/auth/` provider/logout components were leftovers from a pre-Pigeon experiment that compiled into the bundle but were never reachable. No root `src/middleware.ts` exists, so `src/utilities/supabase/middleware.ts` was never invoked; `<AuthProvider>` was defined but never mounted in any layout; `<LogoutButton>` was defined but never imported; the `(auth)` pages worked in isolation but nothing else in the app linked to `/login` or `/signup`, and there was no global auth gate. **Deleted:** `src/app/(auth)/` (login / signup / password-reset / email-confirm pages + server actions), `src/utilities/supabase/{client,server,middleware,admin}.ts`, `src/components/auth/{auth-provider,logout-button}.tsx`. **Uninstalled:** `@supabase/ssr`, `@supabase/supabase-js`, `@prisma/adapter-pg` (the Postgres adapter was confirmed unused — Pigeon ships SQLite via `@prisma/adapter-better-sqlite3`). Net `-622` packages from the lockfile. Resolves the #262 audit re-investigation that found the prior `@supabase/*`-as-zero-usage call had missed the orphaned scaffold. Closes #231 and #262.

## [6.1.0] — 2026-05-01

Bundles ~43 commits across two coherent threads since v6.0.0.

The headline user-visible feature is the **per-project Costs page lens stack** (`/projects/:projectId/costs`) — summary strip with sparkline (#193), Pigeon-overhead breakdown by tool (#194), the "Pigeon paid for itself" savings lens (#195), cost-per-shipped-card delivery view (#196), per-model pricing override table (#160 / #193), board-scoped filtering (#200 phases 1a / 2a / 2c / 3), and a long-form how-it-works docs page at `/costs/` (#207). First user-visible surface that cashes the token-tracking foundation.

The headline infra thread is the **upgrade-comms pipeline** that closes the loop on update-flow communication: server-status pill now shows host:port (#181), polls GitHub Releases for a new-version indicator (#182), surfaces the same outdated-install signal to agents via `briefMe._upgrade` (#210 PR-A), renders a "What's new in v{version}" panel sourced from the matching CHANGELOG section after each upgrade (#210 PR-B), backs up `data/tracker.db` before `prisma db push` on `service:update` (#214), and runs the 8-check doctor pass after restart with failures surfaced via briefMe `_upgradeReport` (#215). Plus `scripts/connect.sh` now installs slash commands (#147) and the Stop hook (#217) into target projects so per-machine setup is idempotent.

Underneath: token-tracking instrumentation upgrade (`ToolCallLog.responseTokens` for overhead math (#190), `attributeSession` MCP tool back-fills `cardId` on Stop-hook rows (#191), `recalibrateBaseline` + `Project.metadata` baseline persistence (#192)), four correctness fixes (#202–#205), one housekeeping bundle (#206), and a long-form `docs/token-tracking.md` reference (#197). Plus milestone Archive/Unarchive/Merge actions in `MilestoneManager` (#171), a project-agnostic agent best-practices guide at `docs/AGENT-GUIDE.md` + the `tracker://server/agent-guide` MCP resource (#164), `note.promoteToCard` (#185), the `endSession` → `saveHandoff` essential-tool rename's followup polish (Sessions sheet renamed to Handoffs, #188), and a roadmap-page crash fix (#218).

### Schema

`SCHEMA_VERSION` 13 → 14. Two additive columns landed under `[Unreleased]` without bumping the counter:

- `ToolCallLog.responseTokens` (`Int @default(0) @map("response_tokens")`) plus a new `@@index([sessionId, toolName])` (#190).
- `Project.metadata` (`String @default("{}")`) for `tokenBaseline` and other agent-writable JSON (#192).

Both are non-destructive — `prisma db push` applies cleanly. `service:update` covers this automatically (`ensureSchema()` from #134 runs `prisma db push` before build) and now also writes a pre-push DB backup (#214) to `data/backups/tracker-pre-v6.1.0.db`.

### Added

- **MilestoneManager surfaces v4.2 governance primitives in the UI** (#171). Per-row dropdown menu adds **Merge into…**, **Archive / Unarchive**, and **Delete** actions on `MilestoneManager.tsx`, surfacing `mergeMilestones` and `updateMilestone({ state: "archived" })` — previously MCP-only — to humans running the same triage pass agents do. **Show archived** toggle hides archived rows by default; revealed rows render with a muted Archived badge and an Unarchive action. Merge dialog reuses the destructive-confirm pattern from TagManager and surfaces `rewroteCount` in the success toast. Governance hints (`singletonAfterDays`, near-name `possibleMerge` pairs via Levenshtein ≤ 2) compute on the server in `milestoneService.list` (mirroring the MCP `listMilestones` tool so UI and agent see identical signals) and render inline as muted badges on flagged rows; clicking a near-miss badge preselects that peer in the merge dialog. New `milestone.merge` tRPC mutation wraps the existing `milestoneService.merge` (the same service path the MCP `mergeMilestones` tool already used — single source of truth, no MCP surface change). Unblocks human-driven cleanup so a board audit no longer requires dropping into MCP/Prisma Studio. Closes #171, spin-off from the #163 board audit. (#171)

- **Project-agnostic agent best-practices guide + `tracker://server/agent-guide` MCP resource** (#164). New `docs/AGENT-GUIDE.md` (front-matter `schema_version: 1`, opens with the north-star quote) extracts the universal "how to use Pigeon" guidance — column conventions (Backlog top-3 = pinned, In Progress limit, etc.), `intent` rules on writes, planCard four-section workflow, `addComment` for decisions, handoff cadence, efficiency tips — out of `AGENTS.md`'s contributor-mixed 417 lines into a portable file. New static MCP resource at `tracker://server/agent-guide` (modeled on `tracker://server/manifest`) does live `fs.readFile` of the doc at request time — no copy, no cache — so edits propagate without server restart. Resource is advertised in a new `STATIC_RESOURCES` array on `buildServerManifest()` for client discoverability (also lists the existing manifest URI). `scripts/print-connect-snippet.ts` now references the guide; `connect.sh`'s "already configured" branch reprints the live snippet plus a migration banner so existing adopters can refresh stale pasted snippets. `AGENTS.md`'s "## Project Tracking" copy-paste block collapsed from 26 lines to a 3-line preamble + link (the full snippet still lives in `print-connect-snippet.ts` — single source of truth, derived counts). Inventory disposition table at `docs/AGENT-GUIDE-inventory.md` classifies every AGENTS.md section as universal/project-only/both. Adoption friction is the project's #1 complaint — projects copy the connect-script snippet, and the guide is one fetch away from any agent. (#164)

- **`service:update` auto-backs-up `data/tracker.db` before `prisma db push`** (#214). Each run now copies the live DB (and any `-wal` / `-shm` sidecars) to `data/backups/tracker-pre-v<targetVersion>.db` *before* `ensureBuild()` runs, capturing the pre-upgrade state regardless of whether the schema diff ends up being destructive on this run. Console output names the absolute path and a human-formatted size (`Backed up DB → … (12.3 MiB)`) so the user has a one-line confirmation. Last 5 backups are kept; older ones (and their sidecars) are pruned in lockstep. Fresh installs (no `tracker.db` yet) no-op silently. New `src/lib/db-backup.ts` module owns the copy + prune logic; 11 vitest cases cover happy-path copy, sidecar handling, fresh-install null-return, prune-keeps-N (sorted by mtime), prune-no-op when under threshold, prune ignores non-matching filenames, sidecar deletion in lockstep, idempotent re-run for the same version, and the byte-formatter. Pairs with #215 — together they make `service:update` safer at both ends: backup before, doctor after. (#214)
- **`service:update` runs `doctor` and surfaces failures via briefMe `_upgradeReport`** (#215). After `npm run service:update` rebuilds + restarts the launchd service, it now runs the 8-check doctor pass automatically and writes `data/last-upgrade.json` (`{ completedAt, targetVersion, doctor }`). The next briefMe call surfaces a concise `_upgradeReport: { completedAt, targetVersion, summary, failed[] }` field — *only when* `summary.fail > 0 || summary.warn > 0`, so clean upgrades produce no payload noise. Reports older than 24h are stale-guarded out by the MCP handler. After surfacing (or after stale-skipping), the file is fire-and-forget cleared so the second briefMe in the session doesn't re-process it (one-shot semantics). `serverVersionCheck` carries a 1.5s timeout, so a still-booting service degrades to `status: "skip"` rather than producing a false fail — no race window to engineer around. New `src/lib/upgrade-report.ts` module owns the type + read/write/clear helpers; tests cover round-trip, missing/malformed-file null fallback, idempotent clear, and the brief-payload shape (`failed[]` populated only with fail+warn, `fix` key omitted when absent). Builds on the `_upgrade` pattern from #210 PR-A — reuses the conditional-spread idiom in `buildBriefPayload` and the `Promise.all` slot in the MCP handler. (#215)
- **"What's new in v{version}" panel above `<BoardPulse>`** (`<UpgradePanel>`). After every upgrade, the board renders a violet-tinted strip pulling the matching `## [<version>]` section out of `CHANGELOG.md` and rendering it via the shared `<Markdown>` component — the in-product surface that closes the loop on the upgrade flow (the agent-visible `_upgrade` field from PR-A names what to run, this surface tells the human what changed). Backed by a new `system.releaseNotes({ version })` tRPC procedure that reads `path.resolve("CHANGELOG.md")` (launchd plist sets `WorkingDirectory` to the repo root, so the same path works in dev and service mode), with a per-version in-memory cache keyed on the version string — CHANGELOG only changes on deploy, so no TTL is needed (a stale entry survives only until the next process restart, which `service:update` already triggers). Parser lives in `src/lib/changelog.ts#extractSection` — pure string-in / string-out so it's trivially testable, with a defensive semver-only input gate that excludes `[Unreleased]` and any regex-metachar input by construction. Dismiss button writes the current version to `localStorage["pigeon:upgrade-dismissed-version"]`; panel hides when the stored value matches the running version, reappears when `service:update` bumps the running version. Six new vitest cases on the parser (known-version extract, `[Unreleased]` exclusion, multi-version isolation, missing version → null, non-semver input rejection, end-of-file section). PR-B of the #210 split. (#210)
- **`_upgrade` field on briefMe payloads** — when the running install is behind the latest GitHub Release, briefMe now surfaces `_upgrade: { current, latest, isOutdated: true, commands: ["git pull", "npm run service:update"] }` so agents can prompt the human to upgrade in-conversation (the existing UI pill is human-only). MCP handler awaits `runVersionCheck()` alongside the boot/HEAD SHA reads in the same `Promise.all` and threads the result through `BriefPayloadOptions.upgradeInfo`; field is absent when in-sync, when offline / rate-limited / opt-out (`latest === null`), and when the caller skipped the version check (back-compat). The same 6h success / 10m failure cache from #182 covers both polls — each process keeps its own copy, worst-case drift is one TTL. Distinct from `_versionMismatch` (boot-vs-HEAD inside one checkout, dev-only signal). Opt-out: `PIGEON_VERSION_CHECK=off` must be set in *both* the Next.js and MCP process environments to fully disable. Four new vitest cases on `buildBriefPayload` lock the four states (outdated → present, in-sync → absent, undefined → absent, `latest: null` → absent). PR-A of the #210 split. (#210)
- **`scripts/connect.sh` installs slash commands into the target project.** Alongside writing `.mcp.json`, the connect script now copies Pigeon's `.claude/commands/*.md` (`/brief-me`, `/handoff`, `/plan-card`) into `<target>/.claude/commands/` so the front-door commands work in any connected project, not just inside the Pigeon repo. Install is idempotent — pre-existing files are left untouched on re-runs, so a user's local edits to a command survive future bind passes. Three call sites (already-configured early-exit, manual-merge instructions, fresh-install) all run the install so existing users picking up the change get the commands without having to recreate `.mcp.json`.
- **Costs page board-mode on-ramp + back-link precedence** (#200 Phase 2c). Closes the #200 stack. Three small nav-link wires that turn the existing surface into a coherent in-and-out flow: (1) the board page's Costs button now links to `/projects/{projectId}/costs?board={boardId}&from={boardId}` so the page opens in board scope and remembers the referrer; (2) the project page's Boards-tab header gains a `<DollarSign>` Costs entry next to "Manage tags" that links to project-wide costs (no `?board=`, no `?from=` — fresh entry into the project lens); (3) the `<CostsBreadcrumb>`'s first segment now honors `?from=<boardId>` — when set, the label reads the originating board's name and the href targets `/projects/{projectId}/boards/{fromBoardId}` instead of the project root, so a one-click return path home. Server-side resolution lives in a new `resolveFromBoard` helper alongside `resolveBoardScope`; the two have **deliberately different validation tiers**: `?board=` is a primary route param that 404s on cross-project / unknown ids (security: prevents probing other projects' board ids), while `?from=` is decorative (only affects the back-link) and silently falls back to project root on bad ids — a malformed referrer should never crash the page. The scope-switcher continues to update only `?board=` (not `?from=`); `?from=` is set once at link-construction time by the originating surface and is read-only thereafter. Two new vitest cases pin the breadcrumb's `fromBoard` rendering. (#200 Phase 2c)
- **Costs page board-scope UI + Statement frame** (`<CostsBreadcrumb>`, `<ScopeSwitcher>`, refactored `<SavingsSection>` Statement). Closes the #200 stack (1a backend → 2a route plumbing → 3 UI). The route now renders a sticky `Project Tracker / Costs / [Scope ▾]` breadcrumb above the page; the third segment is a Popover-anchored Command list (filterable, "All boards" reset row, active board gets a violet dot + `border-violet-500/30 bg-violet-500/[0.06]` pill) that's *hidden entirely* when the project has ≤1 board. Switcher uses `usePathname()` + `URLSearchParams` + `router.replace({ scroll: false })` rather than `useSearchParams` (the latter requires a Suspense boundary that would have broken `next build`); the boards list is fetched server-side via the existing `board.list` procedure (no new tRPC) and threaded as a `boards: { id, name }[]` prop, so the switcher never flashes empty on first paint. The "Pigeon paid for itself" section is now the page's anchor — Section grew an optional `tone="anchor"` variant (violet top accent line + faint bg tint), the headline scales `text-2xl sm:text-3xl md:text-4xl` to keep the dollar amount on one line at 375px, and a one-line formula caption (`$X gross  −  $Y overhead  =  $Z net`, emerald/amber on the net) sits above the existing diagnostic `<dl>` per Vercel's deployment-detail pattern. The Statement *supplements* the step-numbered Section (keeps the page's editorial rhythm with the lenses below) — it doesn't replace it. In board mode, `<SummaryStrip>`'s "Tracking since" cell flips to "Board's share" with a divide-by-zero guard (`projectTotal > 0 ? "(boardTotal / projectTotal × 100).toFixed(1)%" : "—"`); a single italic muted caption beneath the strip names the cost-inequality reality ("A session that touched cards on multiple boards counts toward each board's total."); and `<SavingsSection>` gains an empty-state branch ("No board-attributed sessions yet — savings shown at project level. View project totals →") when the active board has zero attributed cost but the project itself has data. `<PigeonOverheadSection>` and `<CardDeliverySection>` still hit project-only queries (Phase 1b territory) but now render a `(project-wide)` `Badge` in their headers when `scope === "board"` to honestly signal that the lens isn't board-scoped yet. `<PricingOverrideTable>` is hidden in board mode — pricing is project-level configuration, not a board-level metric. Refactor underneath: the duplicated `Section` / `StepLabel` / `PeriodPills` / `DiagnosticRow` blocks (previously copy-pasted across `savings-section.tsx` and `pigeon-overhead-section.tsx`) now live in `src/components/costs/section.tsx` as a single source of truth. 11 new vitest cases pin the URL construction (`buildScopeHref`), the C3 share-percent guard (`formatBoardShare`), and the breadcrumb's hide-when-≤1 rule. (#200 Phase 3)
- **`/projects/:projectId/costs` now accepts an optional `?board=<id>`** to scope the summary strip + sparkline to a single board. Server component validates the board exists *and* belongs to the URL-scoped project (cross-project or unknown ids 404, preventing probing other projects' board ids via this route); a small "Viewing: {boardName}" indicator surfaces below the page title and `generateMetadata` appends `· {boardName}` to the title when scoped. The other sections (`<SavingsSection>`, `<PigeonOverheadSection>`, `<CardDeliverySection>`, `<PricingOverrideTable>`) deliberately keep project-only signatures and continue to render project-wide totals as a placeholder until they're made board-aware in Phase 1b. The `from` query param (Phase 2c back-link source) is read but doesn't affect rendering yet. Full scope-aware page (other sections + nav + design) follows in Phases 1b/2b/2c. (#200 Phase 2a)
- **Docs-site `/costs/` page — "Cost tracking, how it works".** New marquee narrative for the Costs page (`/projects/[projectId]/costs`), covering the five-column token split, the `attributeSession` flow with a worked two-card session example, the session-expansion rule for card-level summaries (card totals can sum to more than the project total — by design), the Pigeon overhead lens with its first-seen-wins per-session pricing rule, the `<SavingsSection>` formula `(naiveBootstrapTokens − briefMeTokens) × inputPerMTok × briefMeCallCount − pigeonOverhead` with a worked 30-day example, and a Limits + known gaps section that names the `cardId = null` exclusion from card totals, in-memory lifetime queries, and `PRICING_LAST_VERIFIED` drift. Section 4 documents #204's locked decision (savings priced at input rate, not output) verbatim from the doc comment above `getSavingsSummary` — the asymmetry with overhead's output-rate pricing is load-bearing, not a typo. New `COST_TRACKING_DOCS_URL` constant in `src/lib/token-tracking-docs.ts` is wired into a "See how cost tracking works" link in `<SavingsMethodologySheet>` (footer, mirrors the setup-dialog `<ReadMoreFooter>` pattern) and a sibling link in `<TokenTrackingSetupDialog>`'s footer alongside the existing `docs/token-tracking.md` pointer. README's Reference section gains a pointer to the new page; sidebar entry under `Reference` between MCP tools and Integration. Closes #207. (#207)
- **Backend support for board-scoped cost queries** (`getProjectSummary` + `getDailyCostSeries` accept optional `boardId`). New private `resolveBoardScopeWhere` helper centralizes the `projectId`-pinned `OR` join (direct card-attribution + session-expansion) so the rule can't drift between callsites — `projectId` is pinned at every layer to prevent cross-project sessionId-collision leaks. Multi-board sessions contribute their full cost to *each* board's total (the "Cost inequality" acceptance from #200: `boardA + boardB > project` is *expected*, not a bug). tRPC `tokenUsage.getProjectSummary` and `tokenUsage.getDailyCostSeries` echo the new optional input. UI plumbing follows in Phase 2a. (#200 Phase 1a)
- **New-version-available indicator on the server-status pill.** New `system.versionCheck` tRPC procedure polls the GitHub Releases API (cached 6h on success, 10m on failure; opt-out via `PIGEON_VERSION_CHECK=off`) and compares `tag_name` against `package.json` version with semver. When an upgrade is pending, the header pill renders an amber dot + tooltip naming the latest version, and clicking the pill opens the GH releases page instead of the local origin. Offline / rate-limited / non-2xx responses degrade silently to "no badge". 8 vitest cases lock the cache (success TTL, failure TTL, opt-out, offline fallback, semver comparison, current-install no-op). (#182)
- **`docs/token-tracking.md` long-form reference.** Agent coverage matrix (Claude Code automatic / Codex manual / OpenAI no-path), full setup walkthrough that mirrors `TokenTrackingSetupDialog`'s three numbered steps plus a manual-edit path with silent-drop diagnosis, counterfactual methodology section with the `gross_savings = (naive_tokens − briefme_tokens) × output_rate × briefme_call_count` formula and the conservative-framing rationale (including why we price savings at the *most-recent* session's model rather than `byModel[0]`), pricing override walkthrough covering the 5 rate fields + lowercase normalization + `^[a-z0-9][a-z0-9-_.]*$` format + dedup buckets + `PRICING_LAST_VERIFIED` banner, recalibrate baseline walkthrough for both the methodology Sheet button and the `recalibrateBaseline` MCP tool, and a 9-item FAQ. `TOKEN_TRACKING_DOCS_URL` (in `src/lib/token-tracking-docs.ts`, used by Pulse strip / card-detail empty state / setup dialog "Read more" footer) now points at the new doc; the dialog's link label updates to match. AGENTS.md §Token Tracking gains a one-line pointer to the new doc as the long-form companion. Closes #197. (#197)
- **"Pigeon paid for itself" savings lens on the Costs page** (`<SavingsSection>`). Headline differentiator that turns the F3 baseline (`Project.metadata.tokenBaseline.{naiveBootstrapTokens, briefMeTokens, measuredAt}`) into a dollar-denominated net-savings figure: `(naiveBootstrapTokens − briefMeTokens) × project's primary outputPerMTok × briefMe call count` minus same-period Pigeon overhead. New `tokenUsage.getSavingsSummary` tRPC procedure with `7d` / `30d` (default) / `lifetime` periods returns either `state: "no-baseline"` (UI shows a Recalibrate CTA) or `state: "ready"` with gross/overhead/net + last-10-sessions log. Negative net is displayed honestly in amber (`"Pigeon cost $X.XX more than it saved this period."`) — no hiding or rounding to zero. A first-class methodology Sheet (`<SavingsMethodologySheet>`, dual Dialog/Sheet via `useMediaQuery` matching `TokenTrackingSetupDialog`) explains baseline measurement, per-session math, conservative framing assumptions, and surfaces a Recalibrate baseline button that calls the F3 mutation directly. `sr-only` `SheetDescription` follows the `caef1c2` a11y convention. Tests: DB-fixture-backed coverage of the no-baseline state (incl. partial baselines), positive net + project-isolation, negative net, baseline parser tolerance for unrelated metadata keys, briefMe-only filtering, and per-session log ordering/cap. Mounted between `<SummaryStrip>` and `<PigeonOverheadSection>` so the page reads: data overview → headline value → transparency → delivery view. (#195)
- **Pricing override table on the Costs page** (`<PricingOverrideTable>`, step "05"). Renders one editable row per built-in model in `DEFAULT_PRICING` plus any persisted `AppSettings.tokenPricing` overrides, with all five rate columns (Input, Output, Cache Read, Cache 1h, Cache 5m) editable as `step="0.001"` `min="0"` numeric inputs. Default rate is shown beneath each input as `Default: $X` muted hint; overridden cells get a violet `border-b-violet-500` underline. Per-row reset (`RotateCcw`) clears the override and re-runs the `tokenUsage.updatePricing` mutation immediately. New "Add model" row supports identifier normalization to lowercase, format validation against `^[a-z0-9][a-z0-9-_.]*$`, and inline-error duplicate detection against built-in defaults, persisted overrides, and other in-progress add rows. `PRICING_LAST_VERIFIED` banner uses the same amber `border-l-2 border-l-amber-500` strip as the token-tracking-setup-dialog. Mobile (`<640px`) collapses each row to a stacked card with per-cell labels — no horizontal scroll. Unknown-model warnings (any model in `getProjectSummary.byModel` not present in default-or-override keys) render as amber DiagnosticRows beneath the table. Validation helpers extracted to `src/components/costs/pricing-override-validation.ts` with 22 pure-function Vitest cases covering normalization, empty rejection, format rejection, and all three duplicate buckets. Closes #160. (#193)
- **Pigeon overhead lens on the Costs page** (`/projects/:projectId/costs`). New `<PigeonOverheadSection>` (step "02") sums `ToolCallLog.responseTokens` × the session's `outputPerMTok`, grouped by tool name, with a 7d / 30d / Lifetime period selector. Surfaces a one-line summary ("X sessions · Y total tool calls · $Z overhead"), an amber tool-efficiency insight when any tool exceeded 10× calls in the window, and a collapsible per-tool breakdown (Tool / Calls / Avg tokens / Cost — Avg tokens hidden on mobile, no horizontal scroll). Empty state is silent — the section only shows when token data already exists. Per-session and per-card chip variants in `<PigeonOverheadChip>` / `<CardPigeonOverheadChip>` self-hide when `responseTokens > 0` produces no rows; the card variant lands next to the existing `<TokenCostChip>` on the card detail sheet. Backed by `tokenUsage.getPigeonOverhead`, `getSessionPigeonOverhead`, and `getCardPigeonOverhead` tRPC procedures + `tokenUsageService.{getPigeonOverhead,getSessionPigeonOverhead,getCardPigeonOverhead}`. Tests: DB-fixture-backed coverage of the 7d/30d/lifetime windows, cross-project leakage prevention, per-tool aggregation, and the empty-session zero path. (#194)
- **Cost-per-shipped-card lens on the Costs page** (`<CardDeliverySection>`). New `tokenUsage.getCardDeliveryMetrics` tRPC procedure joins `Card.completedAt IS NOT NULL` to attributed token spend (same session-expansion rule as `getCardSummary`) and returns headline shipped count + avg / total cost + top-5 most-expensive cards + previous-period avg for the delta arrow. UI: 7d / 30d / Lifetime period pills (default 30d), permanent "Shipped = card moved to Done. Cards with no attributed token events are excluded." caption (definition is part of the surface, not a tooltip), `TrendingUp`/`TrendingDown` Lucide arrow colored emerald (lower) / amber (higher), and partial-state copy when shipped > 0 but `$0` cost is recorded. Lifetime hides the delta arrow (no prior window). Cards with `$0` are dropped from the avg/total math but still counted in `shippedCount`. (#196)
- **`attributeSession` MCP tool** — bulk-attributes every `TokenUsageEvent` for a session to a specific card, closing the `$0 getCardSummary` gap caused by the Stop hook recording rows with no `cardId`. Auto-called from `briefMe` when an active card is known and from `saveHandoff` when exactly one card was touched (fire-and-forget; never blocks). Idempotent + last-write-wins. Returns `NOT_FOUND: …` on missing card and `WRITE_FAILED: …` on DB errors so agent callers can branch on the code prefix. (#191)
- **`recalibrateBaseline` MCP tool + tRPC mutation + `Project.metadata` JSON column.** Measures the briefMe payload size against a naive "load the whole board" bootstrap (chars/4 estimator) and persists the result on `Project.metadata.tokenBaseline` (`{ briefMeTokens, naiveBootstrapTokens, latestHandoffTokens?, measuredAt }`). Backs the upcoming "Pigeon paid for itself" surface with measured numbers instead of a marketing constant. The briefMe payload assembly is now extracted into `src/server/services/brief-payload-service.ts#buildBriefPayload(boardId, db, options?)` so both the MCP handler and the recalibrate path consume the same shape — no behavior change to briefMe itself. (#192)
- **Per-project Costs page shell + summary strip** (`/projects/:projectId/costs`). New route, accessible from the Costs button in the board header, that renders a four-cell `<dl>` summary (lifetime cost, last-7-days cost + violet `Sparkline`, session count, tracking-since) over `tokenUsage.getProjectSummary` and `getDailyCostSeries`. Empty state CTA wires straight into `TokenTrackingSetupDialog` so users with no events have a one-click setup path. The `Sparkline` previously inlined in `board-pulse.tsx` is now extracted to `src/components/ui/sparkline.tsx` (pure refactor, same component signature) so both surfaces share a single implementation. Per-model pricing override table (Step 5 of the card) is deferred to a follow-up — this PR is shell-only. (#193, partial)
- **`responseTokens` on `ToolCallLog` + first DB-backed test pattern.** Instrumentation now records an estimated response-token count (chars/4) for every MCP tool call across `wrapEssentialHandler` (success + early-rejection paths) and `logToolCall`; catch path defaults to 0 via `?? 0`. New `@@index([sessionId, toolName])` supports the upcoming Pigeon-overhead lens. `db push` is non-destructive — existing rows backfill to 0. Establishes `src/server/services/__tests__/test-db.ts` as the project's first DB-backed Vitest fixture (per-suite temp SQLite, schema applied via `prisma migrate diff`; `:memory:` was unworkable on Prisma 7's better-sqlite3 adapter). Five new locking suites (T1–T5) cover `resolvePricing`, `computeCost`, `aggregateTranscript`, `getCardSummary` session-attribution, and `configHasTokenHook`. (#190)
- **`note.promoteToCard` tRPC procedure** — single transactional call that creates a card with `metadata.sourceNoteId`, sets the source note's `cardId` back-reference, and writes a `promoted_from_note` activity row. Replaces the previous two-step `card.create` + `note.delete` chain. The Promote modal in `/notes` and the project Notes tab now offers an editable title (pre-filled from the note) and a priority selector, and the source note is **kept** in the scratch space rather than deleted — closes #179 with link-and-keep semantics. (#185)

### Changed

- **`token-usage-service.ts` housekeeping bundle.** Five small cleanups in the same file, none individually card-worthy:
	- `getSavingsSummary`: dropped the dead `> existing` guard in the per-session loop — `eventRows` is already `orderBy: { recordedAt: "desc" }`, so the first occurrence of a sessionId is the most-recent and the comparison never overwrote. Replaced with a plain `has()` check + comment.
	- `getSavingsSummary`: parallelized the trimmed top-10 `getSessionPigeonOverhead` lookups via `Promise.all` (was sequential `await` inside the loop, up to 10 round-trips per Costs-page render).
	- `resolveConfigCandidates`: removed the bare `path.resolve(".claude", "settings.json")` / `settings.local.json` lines. They resolved against the server's cwd (launchd install dir at runtime), not the user's repo, producing false negatives in the diagnostic. Comment now explains why project-scoped paths aren't reliably reachable from this surface.
	- `getProjectSummary`: extended the doc comment with the lifetime-query memory ceiling — current scale is fine; switch to SQL `groupBy` on `model` if we ever cross ~100k events per project.
	- `getPigeonOverhead`: added a code comment on the `toolCallLog.findMany({ where: { sessionId: { in: sessionIds } } })` call explaining that sessionId scoping is safe today (sessionIds are caller-provided and project-scoped) but a JOIN through token-usage rows would be needed if cross-project sessionId reuse ever becomes possible. (#206)
- **`tokenUsageService.recordManual` is now idempotent on `(sessionId, model)`.** Previously a plain INSERT, so a retry of a failed call doubled the row (and doubled cost) and test fixtures that seeded the same row twice produced duplicates. Switched to a `findFirst` + conditional `update`/`create` keyed on `(sessionId, model)` with **last-write-wins** semantics, mirroring `recordFromTranscript`'s "same input → same row count" contract. The pair has no DB-level unique constraint — using a read-then-write keeps the change scoped to one function (no migration interaction with `recordFromTranscript`'s `deleteMany`-on-`sessionId` semantics). Sibling-model rows under the same `sessionId` are untouched. Doc comment now calls out the idempotency guarantee in the same tone as `recordFromTranscript`'s. Two new vitest cases lock the behavior. (#205)
- **Savings calc in `getSavingsSummary` now prices avoided briefMe tokens at input rate (consumer-side semantics) rather than output rate.** Headline numbers will drop ~5× under default Anthropic pricing — this is the correct, defensible value: the consumer reads the briefMe payload as input on its next turn, so the avoided cost is the avoided input read, not an output emission. `getPigeonOverhead` deliberately keeps output-rate pricing because the agent *emits* tool-response tokens — the asymmetry is load-bearing, not a typo, and is documented in the doc comment above `getSavingsSummary`. New regression test pins the input-rate factor explicitly with the rate values from `DEFAULT_PRICING` so a future revert is loud, not silent. (#204)
- **Server-status pill shows host:port instead of mode.** The header pill now reads `v6.0.0 · localhost:3100` (or `· localhost:3000` in dev) instead of `v6.0.0 · service` — the port already encodes dev (3000) vs service (3100), so showing the actual URL is more informative. Pill content is wrapped in an anchor pointing at the current origin so the URL is right-click/copy/openable. Integrates cleanly with the new-version-available indicator: when an upgrade is pending, the anchor retargets to the GitHub releases page. (#181)
- **Header Docs link points at the quickstart page.** Switches the in-app Docs button from `github.com/2nspired/pigeon#readme` to `https://2nspired.github.io/pigeon/quickstart/` so first-touch users land on the dedicated quickstart instead of the raw README. (#162-followup)
- **MCP prompts string + connect.sh CLAUDE.md tip now derive from the registry.** `src/mcp/server.ts`'s `checkOnboarding` payload no longer hard-codes `"7 MCP prompts are available (resume-session, …)"` — a thin `registerPromptTracked` wrapper records each name as it registers, and the user-facing string interpolates `REGISTERED_PROMPTS` at runtime. `scripts/connect.sh` likewise stops emitting a hand-maintained heredoc; it shells out to a new `scripts/print-connect-snippet.ts` that reads `ESSENTIAL_TOOLS` + `getAllExtendedTools()` so the count + name list + extended count never drift. Adding/removing a prompt or essential tool now propagates to user-facing copy without manual edits. (#187)
- **Sessions sheet renamed to Handoffs** — header button, tooltip, sheet title, and empty-state copy all use "Handoffs" vocabulary now that the data sources from the dedicated `Handoff` table (post-#110). Component, state, and import names follow. (#188)

### Fixed

- **Roadmap page no longer crashes with `horizonGroups[h] is not iterable`** (#218). `flatCardIds` in `src/components/roadmap/roadmap-view.tsx` was iterating a hardcoded `["now", "next", "later", "done"] as Horizon[]` array — but `"next"` (the legacy Up Next horizon removed in #97) isn't a valid `Horizon` value, and the `as Horizon[]` cast bypassed TypeScript's exhaustiveness check. At runtime `horizonGroups["next"]` was `undefined` and `for (const group of undefined)` threw, breaking the route on production `:3100` (not just dev). Surfaced during #171's MilestoneManager smoke-test, which had to mount the component via a temporary harness route because the actual roadmap page wouldn't load. Structural fix: new `HORIZON_ORDER` const in `src/lib/column-roles.ts` (`["now", "later", "done"] as const satisfies readonly Horizon[]`) is now the single source of truth — both consumers in `roadmap-view.tsx` (the drag-end reorder loop and the `flatCardIds` loop) reference it, the stale `"next"` is gone, and the `as Horizon[]` casts are dropped because the `satisfies` clause does the verification at the constant's definition site instead. Vitest regression in `src/lib/__tests__/column-roles.test.ts` pins the exact value of `HORIZON_ORDER` and exercises iteration over a horizonGroups shape with empty buckets. (#218)

- **`scripts/connect.sh` installs Pigeon's Stop hook into `~/.claude-alt/settings.json` during bind so token tracking is wired once per machine instead of per-project** (#217). New `install_stop_hook()` mirrors the slash-commands install pattern from #147; runs in Node (no `jq` dep), idempotent (suffix-matches `command` against `/stop-hook.sh` — same predicate `configHasTokenHook()` uses server-side), atomic (tempfile+rename), preserves all unrelated top-level keys. Called from all three `connect.sh` exit paths (already-configured, partial-config, fresh install) alongside `install_slash_commands`. Closes the UX gap where the in-app setup dialog re-prompted on every newly connected project because `resolveConfigCandidates()` only inspects user-level paths — a project-scoped paste was invisible from other repos. Direction #2 from the card (dialog teaches user-level vs project-level paste paths) deferred — `TODO(#217)` left in `token-tracking-setup-dialog.tsx`; with `connect.sh` wiring the hook automatically, the dialog should rarely surface for connect.sh users. `PIGEON_USER_SETTINGS` env override added so tests/CI don't have to mutate the real `~/.claude-alt/settings.json`. Seven test scenarios covered: missing file, idempotent re-run, preserved unrelated keys, coexistence with non-Pigeon Stop hook, mixed idempotency, malformed JSON (no mutation), array-root JSON (no mutation). (#217)

- **Set `metadataBase` in root layout to silence Next.js build warning.** Every `next build` (and therefore every `npm run service:update`) emitted `metadataBase property in metadata export is not set, using "http://localhost:3000"` because Pigeon ships `/opengraph-image.png` and `/twitter-image.png` at the app root and Next needs an absolute base URL to resolve them. `src/app/layout.tsx` now sets `metadataBase: new URL("http://localhost:3100")` to match the launchd service port — honest for the local-first case. Clean-build / DX fix; OG cards aren't scraped externally so resolved URLs don't matter in practice. (#216)

- **`service:update` is seamless on Prisma 7 even with a populated FTS5 index.** Prisma 7's `db push` flags the `knowledge_fts` virtual table and its 5 shadow tables as drift (they're created at runtime by `initFts5`, outside `prisma/schema.prisma`) and refuses to push without `--accept-data-loss` once they hold rows — which broke the upgrade flow for any user whose knowledge index had been populated. `ensureSchema()` now drops the FTS5 tables via `npx prisma db execute --stdin` *before* running `prisma db push`, so Prisma sees no drift and applies additive changes cleanly. The drop is safe: the index is derived state over Note/Claim/Card/Comment/markdown, `initFts5` recreates the empty virtual table on next service start, and `queryKnowledge` lazy-rebuilds per project on first search. Source data is never touched. Documented step-by-step in `docs/UPDATING.md` so users know what's happening on upgrade.

- **`service:update` works on Prisma 7.** Prisma 7 removed the `--skip-generate` flag from `prisma db push`, so the `ensureSchema()` step in `scripts/service.ts` failed with `unknown or unexpected option: --skip-generate` and aborted the update before build/restart. Dropped the flag — `npm install` already triggers `prisma generate` via the `postinstall` hook one step earlier, so the regenerate inside `db push` is now redundant but harmless. Restores the `git pull && npm run service:update` flow on the new CLI.

- **Stop-hook re-runs no longer wipe `cardId` written by `attributeSession`.** `recordFromTranscript` is delete-and-replace idempotent on `sessionId`, but `attributeSession` (auto-called from briefMe / saveHandoff) may have written a `cardId` onto those rows between the original Stop-hook fire and a re-run. The transcript itself usually carries no card context, so the naive replace silently nuked the attribution and dropped the session out of `getCardSummary`, `getCardDeliveryMetrics`, and `getCardPigeonOverhead`. The replace transaction now snapshots any non-null `cardId` for the session before deletion and restores it via a single `updateMany` after re-insert when the new rows didn't carry one through. Caller-supplied `cardId` on the re-run still wins (we only restore when the new rows are null). One extra SELECT and a conditional UPDATE — no change to the write strategy. New regression test in `token-usage-service.test.ts` exercises the wipe scenario end-to-end. (#202)

- **`getDailyCostSeries` now buckets by UTC calendar day instead of a rolling 168h window.** The 7-day cost sparkline (powering BoardPulse + the Costs page summary strip) advertised "index 6 = today" but anchored on `Date.now() - 7d`, so a request fired at 14:00 put the index 5↔6 boundary at 14:00 yesterday — splitting yesterday's calendar day across buckets 5 and 6 and giving the rightmost bar a half-and-half value. Now anchors `windowStart` at UTC midnight 6 days before today's UTC day, so each bucket holds exactly one calendar day and the rightmost bar always represents today (UTC) regardless of time-of-load. UTC was chosen over local time because there is no project-wide timezone configured; UTC keeps bucket math identical across hosts and across server/client renders. New DB-fixture-backed test (`token-usage-daily-cost-series.test.ts`) pins the boundary semantics with three events at `now-1ms` / `now-23h59m` / `now-24h01m`. (#203)

- **`service:update` now syncs the Prisma schema before building.** Companion to the dep-sync fix: pulled PRs that change `prisma/schema.prisma` previously required a manual `npm run db:push`, and forgetting it produced silent runtime errors ("column X does not exist") long after the update appeared to succeed. New `ensureSchema()` step runs `npx prisma db push --skip-generate` (build will regenerate the client) so additive schema changes apply automatically. Destructive changes (column rename / type narrow / drop) still fail loudly with a pointer to run `npx prisma db push` manually so Prisma can confirm the data-loss prompt — we never auto-accept data loss. With #133 + this change, friend-user update flow collapses to `git pull && npm run service:update`.

- **`service:update` now syncs npm dependencies before building.** `scripts/service.ts#ensureBuild` previously ran `npm run build` directly, so any pulled PR that added or bumped a dep (e.g. #182's `semver` + `@types/semver`) failed at type-check inside `next build` with a misleading "try `npm i --save-dev @types/semver`" message — the dep was already in `package.json`, just not installed. New `ensureDeps()` step runs `npm install --no-audit --no-fund` first; idempotent, ~1s no-op when already in sync. Closes a recurring update-flow footgun for fresh installs / friend-user adoption.

- **`src/mcp/staleness.ts` import path so the Next.js bundle resolves.** F3 (#192) introduced a cross-boundary import where `brief-payload-service.ts` (Next.js side) pulls in `staleness.ts` (MCP side). The latter used a NodeNext-style `./db.js` relative import that tsx handles fine but Turbopack cannot resolve through the bundle. Switched to the `@/mcp/db` path alias, which works in both runtimes. Build passes; MCP server unaffected. Caught when rebuilding the launchd service after the foundation cards merged. (#192-followup)

- **Markdown in handoff list items renders properly.** Items in `workingOn` / `findings` / `nextSteps` / `blockers` were emitting literal `**` / `` ` `` characters because only `summary` was wrapped in `<Markdown>`. New `HandoffItemContent` runs each item through ReactMarkdown and walks the rendered tree to swap plain-text `#N` for clickable `CardRefText`, preserving card-ref linkification across nested `strong`/`em`/`code`/`a`. (#188)
- **Radix `DialogContent` a11y warnings on three sheets.** `HandoffsSheet`, `ActivitySheet`, and the card detail sheet now include an `sr-only` `<SheetDescription>` after `<SheetTitle>`, satisfying radix's screen-reader contract and clearing the "Missing `Description` or `aria-describedby={undefined}`" console warning. Visual layout unchanged. (#189)

### Migration

No required action beyond `git pull && npm run service:update`.

```bash
git pull
npm run service:update   # backs up data/tracker.db (#214) → ensureDeps → ensureSchema (#134) → build → restart → doctor (#215)
```

`service:update` runs the 8-check doctor pass after restart and writes `data/last-upgrade.json`. The next `briefMe` call surfaces the result via `_upgradeReport` when there are warns or fails; clean upgrades produce no payload noise. The "What's new in v6.1.0" panel renders above `<BoardPulse>` until dismissed; clicking the pre-existing version pill in the header confirms the new version is live.

## [6.0.0] — 2026-04-30

The major-version cut for the **handoff/note separation** and the **`endSession` alias removal**. Handoffs now live in their own typed `Handoff` table, briefs are pure derived state (no persisted snapshot rows), and calling `endSession` returns "tool not found" — only `saveHandoff` resolves. Closes the v5.x deprecation cycle announced in `docs/VERSIONING.md`.

### Why now

Phase 1 of #179 (note-list default filter, #108) and the `endSession` deprecation (#151 / #152, shipped in v5.2.0) both promised completion at the v6.0.0 cutoff. This release cashes those checks: the typed `Handoff` table makes `note.list` strictly human-authored, deleting the brief-snapshot persistence layer removes a whole class of agent-generated rows from the human Notes surface, and the alias cutoff lets docs and tooling consolidate around one verb.

### Added

- **CI: CHANGELOG `[Unreleased]` enforcement workflow** (`.github/workflows/changelog.yml`). PRs that touch `src/`, `prisma/`, `scripts/`, `docs/`, `docs-site/`, or `package.json` must update the `## [Unreleased]` section or apply a `skip-changelog` label. Documented co-located with the cadence rule in `docs/VERSIONING.md`. (#177)
- **`Handoff` table** — agent session handoffs now live in their own typed entity instead of riding on `Note(kind="handoff")`. Schema: `id, boardId, projectId, agentName, summary, workingOn, findings, nextSteps, blockers, createdAt`. Append-only, indexed by `(boardId, createdAt)` and `(projectId, createdAt)`. (#179)

### Changed

- **BREAKING — handoffs extracted from `Note` table.** `note.list`, `listNotes` MCP tool, and the public `NOTE_KINDS` enum no longer accept `kind: "handoff"`. Reads/writes go through `db.handoff`, the existing `handoff.*` tRPC router, and the `saveHandoff` MCP tool (wire shape unchanged for callers — `agentName` / `summary` / `workingOn` / `findings` / `nextSteps` / `blockers`). Sessions Sheet UI sources from the new table. (#179)
- Header "MCP" pill renamed to "Commands" (`Command` icon); popover/sheet title and copy lead with slash commands. Cmd-K search pill gains a tooltip pointing at `?` for the full catalog. (#156)

### Removed

- **BREAKING — brief-snapshot persistence and the Briefings Sheet UI.** `briefMe` no longer persists each call as `Note(kind="brief")`; briefs are pure derived state synthesized from board + last handoff. Deleted: `src/lib/services/brief-snapshot.ts`, `src/server/services/brief-snapshot-service.ts`, `src/server/api/routers/brief-snapshot.ts`, `src/components/board/briefings-sheet.tsx`, `scripts/smoke-brief-snapshots.ts`. The `briefSnapshot.list` tRPC route is gone. (#179)
- **BREAKING — `endSession` MCP alias.** Calling `endSession` now returns "tool not found"; only `saveHandoff` resolves. The alias was a v5.x deprecation bridge; v6.0.0 is the announced cutoff per `docs/VERSIONING.md`. The `end-session` MCP prompt (a redirect pointer that existed solely to nudge clients off the old name) is also gone. Slash commands, workflows, the slash-command UI catalog, and the `essentialPrompts` text in `briefMe` and `getBoard` no longer reference `endSession`. (#184)

### Fixed

- **`saveClaim` `payload.env` schema asymmetry** — measurement-claim env values now accept `string | number | boolean` on write to match what reads return. Previously, updating an existing measurement claim whose env was written with numeric values (e.g. `{ cards: 84, rows: 50 }`) failed Zod validation on the way back in. (#178)
- **Notes tab no longer surfaces agent-generated brief/handoff rows.** The `note.list` tRPC procedure now defaults to `kind: "general"` when callers don't specify a kind, so the Project Notes tab and global Notes page show only human-authored notes. Callers wanting handoffs still pass `kind: "handoff"` explicitly. Stop-the-bleeding fix; Phase 2 of #179 will migrate handoffs to a dedicated table and stop persisting `kind: "brief"` rows entirely. (#179)
- **Docs data-model lag from Phase 2.** `docs-site/src/content/docs/tools.mdx` and `concepts.mdx` still claimed handoffs lived in `Note(kind="handoff")`. Updated both pages to describe the dedicated `Handoff` table, and added a `Handoff` node to the Mermaid data-model diagram in `tools.mdx`. (#186)

### Schema

- **`SCHEMA_VERSION` 12 → 13.** New `handoff` table; `note` table loses the `kind="handoff"` and `kind="brief"` row populations (column itself stays). The `scripts/migrate-handoffs-from-notes.ts` one-shot script handles the data move and FTS5 reset; runs once on upgrade with the launchd service stopped.

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

Full walkthrough: [docs/archive/MIGRATING-TO-PIGEON.md](docs/archive/MIGRATING-TO-PIGEON.md). TL;DR:

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

For each project that still has content in the `projectPrompt` column, follow the v4.1 → v5.0 migration path documented in [docs/archive/MIGRATING-TO-PIGEON.md](docs/archive/MIGRATING-TO-PIGEON.md). TL;DR:

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
