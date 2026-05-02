# MCP tool migration history

Tool renames, consolidations, and removals across Pigeon's pre-v6 history. Kept here for reference when reading old transcripts, prompts, or PRs that mention removed tool names.

For the live tool surface, run `getTools()` from an agent or press `?` in the web app.

---

## v5.2 — Session wrap-up renamed `endSession` → `saveHandoff`

The session wrap-up tool was renamed `endSession` → `saveHandoff`. The slash command `/handoff` was unchanged; it now invokes `saveHandoff` under the hood. `saveHandoff` became the canonical name across MCP, the slash command, and docs.

| Old path | New canonical |
|---|---|
| `endSession({ summary, workingOn?, findings?, nextSteps?, blockers? })` | `saveHandoff({ summary, workingOn?, findings?, nextSteps?, blockers?, syncGit? })` — same shape and semantics, plus an explicit `syncGit` toggle for mid-session checkpoints (`syncGit: false` skips commit linking and the touched-cards report) |
| MCP prompt `end-session` (legacy v2.x) | `saveHandoff` directly, or the `/handoff` slash command |

The `endSession` deprecated alias was retained through v5.x and **removed in v6.0.0**. Any agent prompt or hook still referencing `endSession` will fail with "tool not found" on v6+ servers.

---

## v5.0 — `projectPrompt` DB column removed (RFC #111)

The `Project.projectPrompt` DB column was dropped. Project orientation moved to `tracker.md` at the project's repo root — git-versioned, reviewable, the source of truth for `intent_required_on`, per-column prompts, and the project's general agent prompt. See [SURFACES.md](SURFACES.md) for the full surface map.

Existing installs migrated via `runTool('migrateProjectPrompt')` once.

---

## v4.2 — Tag rework + milestone governance

Tags became a project-scoped entity with `slug` (immutable kebab-case identifier) + `label` (mutable display); milestones gained a `state` column ("active" | "archived") and case-insensitive normalization on `resolveOrCreate`. The four card-write sites (`createCard`, `updateCard`, `bulkCreateCards`, `bulkUpdateCards`) accept new strict params alongside the legacy ones with `_deprecated` warnings.

| Before (v4.1) | After (v4.2 strict — current) |
|---|---|
| `tags: string[]` (free-form replace-all; no normalization) | `tagSlugs: string[]` — slugs must already exist; missing slugs return `_didYouMean`. Use `createTag` for new vocabulary. |
| `milestoneName: string` (exact-byte match; "Getting Started" ≠ "getting started") | `milestoneId: string` — UUID; null to unassign. Strict, no auto-create. |

Legacy `tags` / `milestoneName` paths still work as of v6.0.0 but emit `_deprecated` warnings and are slated for removal in the next major version. The response payload includes a `_deprecated` warning whenever a legacy param was used and `_didYouMean` neighbours when an input was within Levenshtein 2 of an existing slug.

**Tools introduced in v4.2:**

| Tool | Purpose |
|---|---|
| `listTags({ projectId, state? })` | List tags with usage counts and `_governanceHints`. `state` filter defaults to `"active"`. Backs the autocomplete combobox + agent discovery. |
| `createTag({ projectId, label })` | Explicit creation — slugifies the label. Idempotent on the slug. |
| `renameTag({ tagId, label })` | Update display label only. Slug is immutable. |
| `mergeTags({ fromTagId, intoTagId })` | Admin cleanup — rewrites all CardTag rows from `from` to `into`, then deletes the source. |
| `deleteTag({ tagId })` | Hard-delete a tag — **only when zero cards reference it**. Non-orphan deletes return `USAGE_NOT_ZERO`; merge first. Atomic against concurrent CardTag inserts (#170). |
| `mergeMilestones({ fromMilestoneId, intoMilestoneId })` | Admin cleanup — rewrites Card.milestoneId from `from` to `into`, then deletes the source. |
| `migrateTags()` | One-shot idempotent backfill from the legacy JSON column to the Tag + CardTag junction. Composes with `migrateProjectPrompt`. **Removed in v6.2 (#227)** alongside the `Card.tags` column drop — historical only. |
| `updateMilestone({ ..., state: "archived" })` | New `state` field — archived milestones are hidden from the picker by default but kept in the schema. |

`listMilestones` returns `_governanceHints` per milestone (singletons > 60 days, near-name neighbours within slug Levenshtein 2). Use these as signal for a one-time human triage pass with `mergeMilestones` / `updateMilestone({ state: "archived" })` — milestones are dedupe-by-judgment, not dedupe-by-rule.

---

## v2.4 — 18-tool pruning pass (75 → 57 tools)

| Old tool | New equivalent |
|---|---|
| `getFocusContext(...)` | Removed — use `getCardContext`, `getMilestoneContext`, or `getTagContext` |
| `setMilestone({ cardId, ... })` | `updateCard({ cardId, milestoneId })` (legacy `milestoneName` accepted in v4.2+ with deprecation warning) |
| `bulkSetMilestone({ milestoneName, cardIds })` | `bulkUpdateCards` with `milestoneId` field |
| `findSimilar(...)` | `searchCards` (text search covers most use cases) |
| `getCardCommits({ cardId })` | `getCommitSummary({ cardId })` (returns same data + structured grouping) |
| `getFact({ factId })` | `listFacts({ projectId, factId })` (single-fact lookup via factId param) — and saveFact/listFacts themselves are now legacy aliases for `saveClaim`/`listClaims` |
| `deleteFact({ factId })` | Removed — use Prisma Studio for deletions |
| `deleteComment({ commentId })` | Removed — use Prisma Studio |
| `deleteNote({ noteId })` | Removed — use Prisma Studio |
| `deleteChecklistItem({ id })` | Removed — use Prisma Studio |
| `reorderChecklistItem(...)` | Removed |
| `rebuildKnowledgeIndex(...)` | Removed — index auto-initializes on first `queryKnowledge` call |
| `setScratch` / `getScratch` / `listScratch` / `clearScratch` | `scratch({ action: "set\|get\|list\|clear", ... })` |
| `bulkAddChecklistItems({ cardId, items })` | `bulkAddChecklistItems({ cards: [{ cardId, items }] })` (multi-card format) |
| `bulkAddChecklistItemsMulti(...)` | `bulkAddChecklistItems` (same tool, renamed) |

---

## v2.3 — Context tools split

Context tools were split into single-purpose tools:

| Old tool | New equivalent |
|---|---|
| `getFocusContext({ boardId, cardId })` | `getCardContext({ boardId, cardId })` |
| `getFocusContext({ boardId, milestone })` | `getMilestoneContext({ boardId, milestone })` |
| `getFocusContext({ boardId, tag })` | `getTagContext({ boardId, tag })` |

`getFocusContext` returned a deprecation error with a hint pointing at the replacement. Each replacement does one thing and has one response shape.

The original session wrap-up shipped in v2.3 as `endSession`, superseding the `end-session` MCP prompt and bumping the essentials from 8 to 9. The tool was renamed to `saveHandoff` in v5.2 (see above) and `endSession` was removed entirely in v6.0.0.

---

## v2.2 — Knowledge tools consolidated

| Old tool | New equivalent |
|---|---|
| `saveContextEntry(...)` | `saveFact({ type: "context", content: "...", ... })` — and `saveFact` is now itself a legacy alias for `saveClaim` |
| `listContextEntries(...)` | `listFacts({ type: "context", ... })` |
| `getContextEntry({ entryId })` | `listFacts({ projectId, factId })` |
| `deleteContextEntry({ entryId })` | Removed — use Prisma Studio |
| `saveCodeFact(...)` | `saveFact({ type: "code", content: "...", path: "...", ... })` |
| `listCodeFacts(...)` | `listFacts({ type: "code", ... })` |
| `getCodeFact({ factId })` | `listFacts({ projectId, factId })` |
| `deleteCodeFact({ factId })` | Removed — use Prisma Studio |
| `saveMeasurement(...)` | `saveFact({ type: "measurement", content: "...", value: N, unit: "...", ... })` |
| `listMeasurements(...)` | `listFacts({ type: "measurement", ... })` |
| `getMeasurement({ measurementId })` | `listFacts({ projectId, factId })` |
| `deleteMeasurement({ measurementId })` | Removed — use Prisma Studio |
| `getBoardDiff({ boardId, since })` | Removed — use `loadHandoff` (includes board diff automatically) |
| `reviewSessionFacts(...)` | Removed — save facts directly via `saveFact` during the session |
| `getCodeMap({ cardId })` | Removed — use `getCommitSummary` (returns files + commit stats) |

**Key concept:** The `content` field replaces `claim` (context), `fact` (code), and `description` (measurement). All three fact types share CRUD through `saveFact`/`listFacts` with a `type` discriminator. The underlying data is unchanged.
