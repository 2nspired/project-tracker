# Agent Guidelines for Project Tracker

> If the human can't see it and correct it in the surface where they'd naturally encounter it, the agent shouldn't trust it.

Shared guidelines for any AI agent (Claude, Codex, etc.) using the Project Tracker MCP.

When this MCP is connected to a project, use the board as your shared workspace with the user. These guidelines keep it useful without burning tokens.

## Tool Migration (v2.2)

The knowledge tools were consolidated in v2.2. If your prompts or learned workflows reference old tool names, here's what changed:

| Old tool | New equivalent |
|---|---|
| `saveContextEntry(...)` | `saveFact({ type: "context", content: "...", ... })` |
| `listContextEntries(...)` | `listFacts({ type: "context", ... })` |
| `getContextEntry({ entryId })` | `getFact({ factId })` |
| `deleteContextEntry({ entryId })` | `deleteFact({ factId })` |
| `saveCodeFact(...)` | `saveFact({ type: "code", content: "...", path: "...", ... })` |
| `listCodeFacts(...)` | `listFacts({ type: "code", ... })` |
| `getCodeFact({ factId })` | `getFact({ factId })` |
| `deleteCodeFact({ factId })` | `deleteFact({ factId })` |
| `saveMeasurement(...)` | `saveFact({ type: "measurement", content: "...", value: N, unit: "...", ... })` |
| `listMeasurements(...)` | `listFacts({ type: "measurement", ... })` |
| `getMeasurement({ measurementId })` | `getFact({ factId })` |
| `deleteMeasurement({ measurementId })` | `deleteFact({ factId })` |
| `getBoardDiff({ boardId, since })` | Removed — use `loadHandoff` (includes board diff automatically) |
| `reviewSessionFacts(...)` | Removed — save facts directly via `saveFact` during the session |
| `getCodeMap({ cardId })` | Removed — use `getCommitSummary` (returns files + commit stats) |

**Key concept:** The `content` field replaces `claim` (context), `fact` (code), and `description` (measurement). All three fact types share CRUD through `saveFact`/`listFacts`/`getFact`/`deleteFact` with a `type` discriminator. The underlying data is unchanged.

## Project Prompt

Each project has an optional `projectPrompt` field — a short orientation paragraph that auto-loads at session start via `checkOnboarding`. Use `updateProjectPrompt` to set it.

**When to use `projectPrompt` vs. repo-side CLAUDE.md:**
- `projectPrompt` is stored in the tracker DB and shared across all agent accounts. Use it for project-level context that any collaborator (human or agent) needs at session start — current phase, key constraints, what to focus on.
- `CLAUDE.md` lives in the repo and is scoped to that repo's code. Use it for build commands, code conventions, and repo-specific instructions.

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

All persistent project knowledge is managed through a single set of tools: `saveFact`, `listFacts`, `getFact`, `deleteFact`. Each fact has a **type** that determines its schema:

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

## Scope Guards

Cards support optional scope guards — structured fields that define what an agent should and shouldn't do when working on a card. Set them via `updateCard` with the `scopeGuard` field.

**Fields:**
- `acceptanceCriteria` — array of strings defining what "done" looks like
- `outOfScope` — array of strings listing what to avoid
- `contextBudget` — `"quick-fix"`, `"standard"`, or `"deep-dive"` — signals expected effort level
- `approachHint` — freeform string with implementation guidance

**Example:**
```json
{
  "scopeGuard": {
    "acceptanceCriteria": ["tRPC endpoint returns summary data", "UI shows collapsible section"],
    "outOfScope": ["Schema migrations", "Auto-trigger on card move"],
    "contextBudget": "standard",
    "approachHint": "Compute on-the-fly from existing GitLink data"
  }
}
```

Scope guards are visible in the card detail sheet UI so both humans and agents can see them. Use them to prevent agent sprawl on cards where boundaries matter.

## Commit Summaries

`getCommitSummary(cardId)` returns a structured aggregation of all commits linked to a card: commit count, authors, time span, and files grouped by category (source, schema, styles, tests, config, docs, other). Use it to quickly understand the scope of work done on a card without reading individual commits.

The card detail sheet in the UI shows a collapsible "Commit Summary" section for any card with linked commits.

## Conflict Resolution

When multiple agents (or an agent and a human) edit the same entity concurrently, optimistic locking prevents silent overwrites.

**How it works:** Card, Decision, PersistentContextEntry, and CodeFact have a `version` field. When updating, pass the `version` you read — if another writer incremented it since your read, the update fails with a clear conflict error. Re-read the entity to get the current state and retry.

**`lastEditedBy`** — Card tracks which agent last modified it. This is stamped automatically via `AGENT_NAME` on creates, updates, and moves.

**When to pass `version`:** Always pass it when updating entities that might be edited by another agent or the human in parallel. If you're the only writer, it's optional but still good practice.

## Decision Supersession

When a new architectural decision replaces an old one, use `supersedesId` when calling `recordDecision` or `updateDecision`. This:
1. Marks the old decision as `superseded`
2. Links both decisions bidirectionally (`supersedes` / `supersededBy`)
3. Triggers staleness warnings if anyone cites the old decision

Don't manually set `status: "superseded"` without linking — use `supersedesId` so the chain is traceable.

## Knowledge Search

`queryKnowledge(projectId, topic)` searches across all project knowledge: cards, comments, decisions, notes, handoffs, code facts, context entries, and indexed repo markdown files. Uses SQLite FTS5 with Porter stemming for relevance-ranked results.

Before first use (or after significant changes), call `rebuildKnowledgeIndex(projectId)` to populate the search index. The index covers repo `*.md` files up to 100KB each, max depth 5 directories.

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
- Use `bulkUpdateCards` to set priority, tags, assignee, or milestone on multiple cards at once
- Use `bulkAddChecklistItems` to add multiple checklist items to a card in one call
- Use `bulkSetMilestone` to assign a milestone to multiple cards at once
- Batch your board updates — don't interleave code work with constant board updates

### Board Health
- Use `auditBoard` to find cards missing priority, tags, milestones, or checklists
- Use `setMilestone` with `milestoneId` (from `listMilestones`) for precision — `milestoneName` auto-creates on typos
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

**Session lifecycle:** Use the `resume-session` MCP prompt (with boardId) at
conversation start and `end-session` before wrapping up. These are MCP prompts,
not tools — invoke them via prompts/get. If prompts aren't supported in your
client, use `runTool({ tool: 'loadHandoff', params: { boardId } })` instead.

**Tool architecture:** 10 essential tools are always visible (getBoard, createCard,
updateCard, moveCard, addComment, searchCards, getRoadmap, checkOnboarding,
getTools, runTool). 70+ extended tools live behind `getTools`/`runTool` — call
`getTools()` with no args to see all categories.

**Basics:** Reference cards by #number (e.g. "working on #7"). Move cards to
reflect progress. Use `addComment` for decisions and blockers. Call
`end-session` to save a handoff so the next conversation picks up in context.
```
