# Agent Guidelines for Project Tracker

> If the human can't see it and correct it in the surface where they'd naturally encounter it, the agent shouldn't trust it.

Shared guidelines for any AI agent (Claude, Codex, etc.) using the Project Tracker MCP.

When this MCP is connected to a project, use the board as your shared workspace with the user. These guidelines keep it useful without burning tokens.

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

## Project Prompt

Each project has an optional `projectPrompt` field — a short orientation paragraph that auto-loads at session start via `checkOnboarding`. Use `updateProjectPrompt` to set it.

**When to use `projectPrompt` vs. repo-side CLAUDE.md:**
- `projectPrompt` is stored in the tracker DB and shared across all agent accounts. Use it for project-level context that any collaborator (human or agent) needs at session start — current phase, key constraints, what to focus on.
- `CLAUDE.md` lives in the repo and is scoped to that repo's code. Use it for build commands, code conventions, and repo-specific instructions.

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

### `component`

Marks a card whose description anchors a system-component bullet in the "What's Built" section of `renderStatus` output. Component cards can be never-closed description anchors (e.g., "Infrastructure: Mac Mini inference setup") that exist purely to hold description text — they are not work items.

### `metric`

Marks a card whose `metadata` JSON holds metrics read by `renderStatus`. Shape:

```json
{ "metrics": [{ "key": "latency", "value": 17.5, "unit": "s", "recordedAt": "2026-04-10", "env": "Mac Mini M4" }] }
```

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
| **Backlog** | Known work that hasn't been prioritized yet. Dumping ground for "we should do this eventually." | When identifying future work during planning or conversation |
| **Up Next** | Prioritized and ready to pick up. This is the active work queue. | When the user or agent agrees this should happen next |
| **In Progress** | Actively being worked on right now. Limit to 2-3 cards to stay focused. | When you start writing code or doing real work on it |
| **Review** | Code is written, needs human review, testing, or verification. Not present on all boards. | When the agent finishes implementation and wants the user to check |
| **Done** | Shipped, merged, verified. No more work needed. | After human confirms it's good, or after merging |
| **Parking Lot** | Ideas, maybes, "what if we..." — not committed to. Low-cost storage for thoughts that might become real work later. | When someone has an idea but it's not actionable yet |

## When to Use the Board

**Start of conversation** — Call `getBoard` once to understand current state. For large boards (50+ cards), use `getBoard` with `summary: true` or `excludeDone: true` to reduce payload. You can also filter to specific columns with `columns: ["Backlog", "Up Next", "In Progress"]`. This replaces re-reading files and git logs to figure out where things stand. If there are checklist items or cards in "Up Next", that's your work queue.

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
| What needs to be done | Cards in Up Next / Backlog |
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
- Use `getBoard` with `columns: ["Up Next", "In Progress"]` to fetch only the columns you need
- One `getBoard` call at conversation start gives you everything — don't call it repeatedly

### Bulk Operations
- Use `bulkCreateCards` instead of multiple `createCard` calls
- Use `bulkUpdateCards` to set priority, tags, or milestone on multiple cards at once
- Use `bulkAddChecklistItems` to add checklist items to one or more cards in one call
- Batch your board updates — don't interleave code work with constant board updates

### Board Health
- Use `auditBoard` to find cards missing priority, tags, milestones, or checklists
- Use `updateCard` with `milestoneName` for milestone assignment — auto-creates if new
- Use `listMilestones` to see completion percentage per milestone

### General
- Reference cards by `#number` (e.g. `#7`) instead of UUIDs — the agent and human both use this
- Use `createCardFromTemplate` for common patterns (Bug Report, Feature, Spike, Tech Debt, Epic)
- Use the `resume-session` prompt at conversation start for a structured overview
- `checkOnboarding` returns project and board lists inline — no need for follow-up `listProjects`/`listBoards` calls

## Connecting to a Project

Run the connect script from the target project's directory:

```bash
# Default agent name ("Claude")
/path/to/project-tracker/scripts/connect.sh

# Custom agent name
AGENT_NAME=Codex /path/to/project-tracker/scripts/connect.sh
```

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
