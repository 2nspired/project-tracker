# Agent Guidelines for Project Tracker

> **Runtime board policy lives in [`tracker.md`](tracker.md)** at the project's repo root — that file is the source of truth for `intent_required_on`, per-column prompts, and the project's general agent prompt. This document is contributor docs: tool migration history, conventions, and reference material that hasn't been moved (and may not need to be). When this file and `tracker.md` overlap, `tracker.md` wins. See [docs/SURFACES.md](docs/SURFACES.md) for the full surface map.

> If the human can't see it and correct it in the surface where they'd naturally encounter it, the agent shouldn't trust it.

Shared guidelines for any AI agent (Claude, Codex, etc.) using the Project Tracker MCP.

When this MCP is connected to a project, use the board as your shared workspace with the user. These guidelines keep it useful without burning tokens.

## Tool Migration (v4.2)

Tag rework + milestone governance. Tags are now a project-scoped entity with `slug` (immutable kebab-case identifier) + `label` (mutable display); milestones gained a `state` column ("active" | "archived") and case-insensitive normalization on resolveOrCreate. The four card-write sites (`createCard`, `updateCard`, `bulkCreateCards`, `bulkUpdateCards`) now accept new strict params alongside the legacy ones with `_deprecated` warnings. Strict params are removed in **v5.0.0**.

| Before (v4.1) | After (v4.2 strict) | After (v5.0 — legacy removed) |
|---|---|---|
| `tags: string[]` (free-form replace-all; no normalization) | `tagSlugs: string[]` — slugs must already exist; missing slugs return `_didYouMean`. Use `createTag` for new vocabulary. | `tagSlugs` only; `tags` parameter removed; `Card.tags` JSON column dropped. |
| `milestoneName: string` (exact-byte match; "Getting Started" ≠ "getting started") | `milestoneId: string` — UUID; null to unassign. Strict, no auto-create. | `milestoneId` only; `milestoneName` parameter removed. |

Legacy paths still work in v4.2 but go through normalization (slugify for tags, case-insensitive slug-compare for milestones), so "Realtime"/"realtime"/"real-time" no longer create three tags and "Getting Started"/"getting started" no longer create two milestones. The response payload includes a `_deprecated` warning whenever a legacy param was used and `_didYouMean` neighbours when an input was within Levenshtein 2 of an existing slug.

**New tools:**

| Tool | Purpose |
|---|---|
| `listTags({ projectId })` | List tags with usage counts. Backs the autocomplete combobox + agent discovery. |
| `createTag({ projectId, label })` | Explicit creation — slugifies the label. Idempotent on the slug. |
| `renameTag({ tagId, label })` | Update display label only. Slug is immutable. |
| `mergeTags({ fromTagId, intoTagId })` | Admin cleanup — rewrites all CardTag rows from `from` to `into`, then deletes the source. |
| `mergeMilestones({ fromMilestoneId, intoMilestoneId })` | Admin cleanup — rewrites Card.milestoneId from `from` to `into`, then deletes the source. |
| `migrateTags()` | One-shot idempotent backfill from the legacy JSON column to the Tag + CardTag junction. Composes with `migrateProjectPrompt`. |
| `updateMilestone({ ..., state: "archived" })` | New `state` field — archived milestones are hidden from the picker by default but kept in the schema. |

`listMilestones` now returns `_governanceHints` per milestone (singletons > 60 days, near-name neighbours within slug Levenshtein 2). Use these as signal for a one-time human triage pass with `mergeMilestones` / `updateMilestone({ state: "archived" })` — milestones are dedupe-by-judgment, not dedupe-by-rule.

## Tool Migration (v2.3)

New essential tool `endSession` supersedes the `end-session` MCP prompt. Essential tool count: 8 → 9.

| Old path | New equivalent |
|---|---|
| MCP prompt `end-session` + manual `runTool('saveHandoff', ...)` | `endSession({ summary, workingOn?, findings?, nextSteps?, blockers? })` — auto-detects boardId, saves handoff, runs syncGitActivity, reports touched cards, returns a resume prompt |

The `end-session` prompt still exists but now returns a one-shot pointer to the new tool. The `saveHandoff` extended tool remains for clients that need the raw insert (no commit linkage, no touched-cards report).

## Tool Migration (v2.4)

Pruning pass: 18 tools removed or consolidated. Tool count: 75 → 57.

| Old tool | New equivalent |
|---|---|
| `getFocusContext(...)` | Removed — use `getCardContext`, `getMilestoneContext`, or `getTagContext` |
| `setMilestone({ cardId, ... })` | `updateCard({ cardId, milestoneName })` |
| `bulkSetMilestone({ milestoneName, cardIds })` | `bulkUpdateCards` with `milestoneName` field |
| `findSimilar(...)` | `searchCards` (text search covers most use cases) |
| `getCardCommits({ cardId })` | `getCommitSummary({ cardId })` (returns same data + structured grouping) |
| `getFact({ factId })` | `listFacts({ projectId, factId })` (single-fact lookup via factId param) |
| `deleteFact({ factId })` | Removed — use Prisma Studio for deletions |
| `deleteComment({ commentId })` | Removed — use Prisma Studio |
| `deleteNote({ noteId })` | Removed — use Prisma Studio |
| `deleteChecklistItem({ id })` | Removed — use Prisma Studio |
| `reorderChecklistItem(...)` | Removed |
| `rebuildKnowledgeIndex(...)` | Removed — index auto-initializes on first `queryKnowledge` call |
| `setScratch` / `getScratch` / `listScratch` / `clearScratch` | `scratch({ action: "set\|get\|list\|clear", ... })` |
| `bulkAddChecklistItems({ cardId, items })` | `bulkAddChecklistItems({ cards: [{ cardId, items }] })` (multi-card format) |
| `bulkAddChecklistItemsMulti(...)` | `bulkAddChecklistItems` (same tool, renamed) |

## Tool Migration (v2.3)

Context tools were split into single-purpose tools in v2.3:

| Old tool | New equivalent |
|---|---|
| `getFocusContext({ boardId, cardId })` | `getCardContext({ boardId, cardId })` |
| `getFocusContext({ boardId, milestone })` | `getMilestoneContext({ boardId, milestone })` |
| `getFocusContext({ boardId, tag })` | `getTagContext({ boardId, tag })` |

`getFocusContext` still exists but returns a deprecation error with a hint. Each replacement does one thing and has one response shape.

## Tool Migration (v2.2)

The knowledge tools were consolidated in v2.2. If your prompts or learned workflows reference old tool names, here's what changed:

| Old tool | New equivalent |
|---|---|
| `saveContextEntry(...)` | `saveFact({ type: "context", content: "...", ... })` |
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

## Project Prompt — deprecated, see `tracker.md`

The `projectPrompt` DB column has been superseded by [`tracker.md`](tracker.md) at repo root (RFC #111). New projects should write `tracker.md` directly; existing projects can run `migrateProjectPrompt({ projectId })` to copy the DB value into a fresh `tracker.md`, then clear the column. The field will be removed in v5.0.0.

**When to use `tracker.md` vs. repo-side CLAUDE.md:**
- `tracker.md` is the project's runtime board policy — agent prompt body + machine-parsed front matter (`intent_required_on`, per-column prompts). Read by `briefMe` and `getCardContext`.
- `CLAUDE.md` is Claude Code's repo session bootstrap — build commands, code conventions, repo-specific instructions. Read by Claude Code at session start, not by tracker tools.

See [docs/SURFACES.md](docs/SURFACES.md) for a full breakdown.

## Intent on Writes

When you call a write tool that changes board state, include a short **`intent`** string saying *why* you're doing it — one sentence, ≤120 chars, user-visible on the card and in the activity strip.

**Why:** Humans watching the board see actions flow in real time. Without intent, a move from `In Progress` → `Review` is silent noise. With it, they read *why* and decide whether to step in.

**Where it applies:**

| Tool | `intent` | Notes |
|---|---|---|
| `moveCard` | **required** | Every move needs a reason (WIP stall, ready for review, parked, etc.) |
| `deleteCard` | **required** | Intent gates a destructive action; it's not persisted after cascade |
| `updateCard` | optional | Pass when the edit reflects a decision or discovery, not just a mechanical fix |

**Examples:**

```
moveCard({ cardId: "#42", columnName: "Review", intent: "Tests green, ready for user to verify before merge" })
moveCard({ cardId: "#42", columnName: "Parking Lot", intent: "Parked — waiting on design decision from #39" })
updateCard({ cardId: "#42", priority: "HIGH", intent: "Bumped after user reported it blocks the Q2 launch" })
```

**Don't:**

- Restate what the tool did (`"Moving to Done"`) — the column transition already shows that
- Use intent as a changelog (`"Fixed typo"`) — that's the commit message's job
- Leave it blank on `moveCard` to satisfy the type — write a real reason or don't move the card

When you provide `intent`, the UI flashes a 10-second banner on the card so the human sees it live. Activity-strip entries render it in italic below the action.

## Project Status

`renderStatus(projectId)` generates a STATUS.md-equivalent markdown snapshot from board data. It replaces hand-maintained STATUS.md files — if your repo has one, you can delete it after adopting renderStatus.

The same output is available as an auto-loadable MCP resource at `status://project/<slug>`.

## Tag Conventions

Tags are project-scoped (since v4.2) — same string in two projects = two distinct Tag rows. Each tag has an immutable `slug` (kebab-case via `slugify()`: trim → NFKD → lowercase → collapse non-alphanumeric to `-` → cap at 50 chars) and a mutable `label` (display). Pre-v4.2 free-form strings were canonicalized into the new model by `migrateTags`; the audit JSON in `data/tag-migration-*.json` documents which variants were merged.

Two slugs have reserved semantic meaning across projects (declared here, not enforced by schema):

### `component`

Marks a card whose description anchors a system-component bullet in the "What's Built" section of `renderStatus` output. Component cards can be never-closed description anchors (e.g., "Infrastructure: Mac Mini inference setup") that exist purely to hold description text — they are not work items.

### `metric`

Marks a card whose `metadata` JSON holds metrics read by `renderStatus`. Shape:

```json
{ "metrics": [{ "key": "latency", "value": 17.5, "unit": "s", "recordedAt": "2026-04-10", "env": "Mac Mini M4" }] }
```

## Milestones

A milestone is a **release horizon** — a bounded set of cards intended to ship as a coherent unit. This is the v4.2 governance answer: it's the only definition that makes the existing `dueDate` field semantically coherent and makes singleton milestones obviously wrong (a release with one card is either a typo or premature).

**Naming convention:** `vN.M.P — Theme` for software releases (e.g. `v4.2.0 — Taxonomy primitives`); free-form for non-release work, but every milestone description must answer "what's the unit of completion?"

`updateMilestone({ ..., state: "archived" })` hides shipped/abandoned milestones from the picker without deleting their card assignments. `mergeMilestones` is the cleanup primitive for duplicate or near-duplicate names — `listMilestones` flags candidates via `_governanceHints` (singleton > 60 days, near-name neighbours within Levenshtein 2).

## Facts (Unified Knowledge Store)

All persistent project knowledge is managed through `saveFact` and `listFacts`. Each fact has a **type** that determines its schema:

### `type: "context"` — Project-level knowledge claims
Record facts, decisions, and learnings that should persist across sessions.
- `content` = the claim/assertion
- Optional: `rationale`, `application`, `details[]`, `audience`, `citedFiles[]`, `surface`
- **Surface levels:** `ambient` (auto-loaded, use sparingly), `indexed` (queryable, default), `surfaced` (reserved)

### `type: "code"` — File/symbol-anchored assertions
Record facts about specific files or symbols. Automatically tracked for staleness when cited files change.
- `content` = the factual assertion
- `path` (required) = file path relative to repo root
- Optional: `symbol`, `recordedAtSha`
- **No line numbers** — they rot too fast. Use file path + optional symbol name.
- **`needsRecheck`** — Auto-set when the cited file's latest commit differs from `recordedAtSha`. Use `listFacts({ type: "code", needsRecheck: true })` to find stale facts.

### `type: "measurement"` — Environment-dependent numeric values
Record latency, memory usage, build times, bundle sizes, etc.
- `content` = description of what was measured
- `value` + `unit` (required) = the numeric measurement
- Optional: `env` (JSON key-value pairs of dependencies), `path`, `symbol`, `ttl` (days)
- **`env` field** — Include hardware/runtime and version-sensitive tools. When any dependency changes, the measurement may be invalid.
- **`ttl`** — Time-to-live in days. Set for measurements that should be re-run periodically (e.g. `ttl: 30`).
- **`needsRecheck`** — Auto-set on TTL expiry, SHA drift, or age thresholds. Use `listFacts({ type: "measurement", needsRecheck: true })`.

## Commit Summaries

`getCommitSummary(cardId)` returns a structured aggregation of all commits linked to a card: commit count, authors, time span, and files grouped by category (source, schema, styles, tests, config, docs, other). Use it to quickly understand the scope of work done on a card without reading individual commits.

The card detail sheet in the UI shows a collapsible "Commit Summary" section for any card with linked commits.

## Last-Write-Wins

This is a single-user local tool — concurrent edits on the same entity are rare, and the UI re-reads on every change. Writes use last-write-wins: no version field, no conflict errors.

**`lastEditedBy`** — Card tracks which agent last modified it. This is stamped automatically via `AGENT_NAME` on creates, updates, and moves. Check it before editing if you suspect the human or another agent just touched the card.

## Decision Supersession

When a new architectural decision replaces an old one, use `supersedesId` when calling `recordDecision` or `updateDecision`. This:
1. Marks the old decision as `superseded`
2. Links both decisions bidirectionally (`supersedes` / `supersededBy`)
3. Triggers staleness warnings if anyone cites the old decision

Don't manually set `status: "superseded"` without linking — use `supersedesId` so the chain is traceable.

## Knowledge Search

`queryKnowledge(projectId, topic)` searches across all project knowledge: cards, comments, decisions, notes, handoffs, code facts, context entries, and indexed repo markdown files. Uses SQLite FTS5 with Porter stemming for relevance-ranked results.

The index auto-initializes on first query. It covers repo `*.md` files up to 100KB each, max depth 5 directories.

## Column Definitions

| Column | Purpose | When to move here |
|---|---|---|
| **Backlog** | All known work, ordered by priority. The **top 3 positions** are treated as human-pinned and surface ahead of score-ranked cards in `briefMe.topWork` (`source: "pinned"`). Drag a card to the top to signal "I want this next." | When identifying future work, OR when promoting a card to "this is what I want done next" — drag it to the top of Backlog |
| **In Progress** | Actively being worked on right now. Limit to 2-3 cards to stay focused. | When you start writing code or doing real work on it |
| **Review** | Code is written, needs human review, testing, or verification. Not present on all boards. | When the agent finishes implementation and wants the user to check |
| **Done** | Shipped, merged, verified. No more work needed. | After human confirms it's good, or after merging |
| **Parking Lot** | Ideas, maybes, "what if we..." — not committed to. Low-cost storage for thoughts that might become real work later. | When someone has an idea but it's not actionable yet |

> **Note (#97):** The legacy "Up Next" column was removed. Its function (human-priority queue) is now expressed by **position in Backlog** — top 3 = pinned. This keeps columns as pure workflow stages and avoids duplicating the `priority` field.

## When to Use the Board

**Start of conversation** — Call `briefMe` for a session primer (handoff, top work, pulse). For deeper exploration, use `getBoard` with `summary: true` or `excludeDone: true` to reduce payload. You can also filter to specific columns with `columns: ["Backlog", "In Progress"]`. The first three Backlog cards are the agent's recommended next-up — `briefMe.topWork` flags them with `source: "pinned"`.

**Planning phase** — Use `bulkCreateCards` (not individual createCard calls) to lay out planned work. Add checklist items for sub-tasks. This is where the user sees your plan before you start coding.

**Meaningful milestones** — Move cards when you start real work ("In Progress") and when you finish ("Done" or "Review"). Don't move cards for every small step.

**Decisions and blockers** — Use `addComment` to record decisions that would otherwise get lost between conversations. Things like: "Chose X approach because Y", "Blocked on Z", "User confirmed they want A not B".

**End of conversation** — Update card states to reflect where things landed. Future conversations pick up from here.

## When NOT to Use the Board

- Don't update after every small code change — git tracks that
- Don't add comments that just say "updated file X" — that's in the diff
- Don't call getBoard repeatedly in the same conversation — the state is in your context
- Don't create cards for trivial tasks that will be done in 2 minutes

## What Goes Where

| Information | Where it belongs |
|---|---|
| What needs to be done | Cards in Backlog (drag the most important to the top — top 3 surface as `pinned` in briefMe) |
| Current work breakdown | Checklist items on the active card |
| Architecture decisions | Comment on the relevant card |
| "Why did we choose X?" | Comment on the card |
| Ideas for later | Card in Parking Lot |
| Bug or issue found during work | New card with priority set |
| What changed in code | Git commit (not the board) |

## Linking Commits to Cards

Reference card numbers in commit messages (e.g. `Add auth middleware (#7)`) and run `syncGitActivity` to auto-link them. Use `getCommitSummary(cardId)` to see a structured overview of all linked commits for a card.

For manual linking, add a comment:

```
addComment #7 "Commit: abc1234 — Add auth middleware"
```

Do this as part of your end-of-work flow, not after every small commit.

## Efficiency Tips

### Reducing Token Usage
- Use `getBoard` with `summary: true` for lightweight views (no descriptions or checklist items)
- Use `getBoard` with `excludeDone: true` to skip Done/Parking columns — often the bulk of payload
- Use `getBoard` with `columns: ["Backlog", "In Progress"]` to fetch only the columns you need
- One `getBoard` call at conversation start gives you everything — don't call it repeatedly

### Bulk Operations
- Use `bulkCreateCards` instead of multiple `createCard` calls
- Use `bulkUpdateCards` to set priority, tagSlugs, or milestoneId on multiple cards at once (legacy `tags` / `milestoneName` accepted with `_deprecated` warning through v4.2)
- Use `bulkAddChecklistItems` to add checklist items to one or more cards in one call
- Batch your board updates — don't interleave code work with constant board updates

### Board Health
- Use `auditBoard` to find cards missing priority, tags, milestones, or checklists
- Use `updateCard` with `milestoneId` (preferred since v4.2) for milestone assignment; legacy `milestoneName` still works with case-insensitive normalization
- Use `listMilestones` to see completion percentage per milestone + `_governanceHints` for triage targets

### General
- Reference cards by `#number` (e.g. `#7`) instead of UUIDs — the agent and human both use this
- Use `createCardFromTemplate` for common patterns (Bug Report, Feature, Spike, Tech Debt, Epic)
- Use the `resume-session` prompt at conversation start for a structured overview
- `checkOnboarding` returns project and board lists inline — no need for follow-up `listProjects`/`listBoards` calls

## Connecting to a Project

Run the connect script from the target project's directory:

```bash
# Auto-detects agent name from the MCP client handshake (e.g. "claude-code")
/path/to/project-tracker/scripts/connect.sh

# Override the auto-detected name with a friendlier label
AGENT_NAME=Claude /path/to/project-tracker/scripts/connect.sh
```

**Agent identity resolution.** Activity rows, `lastEditedBy`, and handoffs
stamp `AGENT_NAME` on each write. Resolution order at server start:

1. `AGENT_NAME` env var from the project's `.mcp.json` (explicit override)
2. Client name from the MCP initialize handshake (e.g. `claude-code`, `codex`)
3. Literal `"Agent"` — only if the client declared no name

Setting `AGENT_NAME` is optional; set it only when you want a custom label
(e.g. `"Claude"` instead of `"claude-code"`).

Then add to the project's agent instructions file (`CLAUDE.md`, `AGENTS.md`, etc.):

```
## Project Tracking

This project uses a Project Tracker board via MCP.

**Session lifecycle:** Call `briefMe()` at the start of each conversation for
a one-shot session primer (handoff, top work, blockers, pulse). Call
`endSession({ summary, ... })` before wrapping up — it saves the handoff,
links new commits, reports the cards you touched, and returns a resume prompt
for the next chat. Both tools auto-detect the board from your git repo.

**Tool architecture:** 9 essential tools are always visible (briefMe,
endSession, createCard, updateCard, moveCard, addComment, checkOnboarding,
getTools, runTool). Extended tools — including getBoard, searchCards,
getRoadmap — live behind `getTools`/`runTool`; briefMe composes the common
session-start views. Call `getTools()` with no args to see all categories.

**Basics:** Reference cards by #number (e.g. "working on #7"). Move cards to
reflect progress. Use `addComment` for decisions and blockers. Call
`endSession` to save a handoff so the next conversation picks up in context.
```
