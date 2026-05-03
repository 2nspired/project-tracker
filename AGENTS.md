# Pigeon — Contributor Reference

> **For universal agent collaboration patterns** (session lifecycle, `intent` rule, column conventions, planCard protocol, worktree rules, efficiency tips), read [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) first. That guide is project-agnostic — every Pigeon-connected repo gets it. **This file is Pigeon-internal**: schemas, slugs, semantics, and tool conventions specific to *this* codebase.
>
> **Runtime board policy lives in [`tracker.md`](tracker.md)** at repo root. When this file and `tracker.md` overlap, `tracker.md` wins. See [`docs/SURFACES.md`](docs/SURFACES.md) for the full file-by-file authority map.

## Table of contents

- [Tag conventions](#tag-conventions)
- [Reserved tag slugs](#reserved-tag-slugs)
- [Milestones](#milestones)
- [Claims / Facts schema](#claims--facts-schema)
- [Decision supersession](#decision-supersession)
- [Last-write-wins semantics](#last-write-wins-semantics)
- [Column definitions (Pigeon-side notes)](#column-definitions-pigeon-side-notes)
- [Knowledge search](#knowledge-search)
- [MCP tool architecture (essential vs. extended)](#mcp-tool-architecture-essential-vs-extended)
- [Connecting a project + agent identity](#connecting-a-project--agent-identity)
- [CHANGELOG entries](#changelog-entries)
- [Token tracking](#token-tracking)
- [Tool migration history](#tool-migration-history)

## Tag conventions

Tags are **project-scoped** since v4.2 — same string in two projects = two distinct `Tag` rows. Each tag has an immutable `slug` (kebab-case via `slugify()`: NFKD → lowercase → collapse non-alphanumeric to `-` → cap at 50 chars) and a mutable `label` (display).

A card's tags answer two orthogonal questions: *what kind of work is this?* and *what part of the system does it touch?* Tags are **flat** — no `feature:foo` colon-prefixed namespacing. Use a milestone for feature/release grouping.

| Slot | Required? | Vocabulary | Examples |
|---|---|---|---|
| **type** | required | closed list — exactly one of `bug`, `feature`, `chore`, `docs`, `epic`, `spike` | `bug`, `chore` |
| **area** | optional | open list — name the surface or subsystem | `mcp`, `ui`, `cli`, `schema`, `roadmap`, `briefme`, `handoff` |
| **reserved** | n/a | semantic slugs (see below) | `component`, `metric` |

Don't tag for prose (`important`, `cleanup-needed`) — that's what description and priority are for. `feature:foo` namespacing is deprecated; v4.2 slugify rewrites `feature:auth` → `feature-auth` but the convention is to fold it into a milestone and drop the tag via `mergeTags`.

### Governance hints

`listTags` returns `_governanceHints` per row when something deserves attention. **Absent fields are not empty arrays — they're "no signal."**

| Hint | Meaning | Action |
|---|---|---|
| `singleton: true` | Tag referenced by exactly one card | Premature vocabulary? Rename to broader peer, merge, or accept as deliberate one-off |
| `possibleMerge: [{ id, label, distance }]` | Peers within Levenshtein ≤ 2 | `mergeTags` to fold near-duplicates into the canonical tag |

`deleteTag` is **orphan-only by contract** — atomic `DELETE … WHERE NOT EXISTS (SELECT 1 FROM card_tag …)`. A concurrent CardTag insert closes the window with `USAGE_NOT_ZERO` rather than deleting referenced rows. Recovery: `mergeTags` to drain references, then re-attempt.

The TagManager UI (project page header → "Manage tags", or tag-combobox footer) surfaces all of this: usage-desc sort, Singleton + Near-miss badges, click-to-pre-select-merge, disabled-with-tooltip Delete on tags with usage > 0.

## Reserved tag slugs

Two slugs have reserved semantic meaning across all projects (declared here, not enforced by schema):

- **`component`** — marks a card whose description anchors a system-component bullet in `renderStatus`'s "What's Built" section. Component cards can be never-closed description anchors (e.g. "Infrastructure: Mac Mini inference setup") — they exist to hold description text, not as work items.
- **`metric`** — marks a card whose `metadata` JSON holds metrics read by `renderStatus`:

  ```json
  { "metrics": [{ "key": "latency", "value": 17.5, "unit": "s", "recordedAt": "2026-04-10", "env": "Mac Mini M4" }] }
  ```

## Milestones

A milestone is a **bounded set of cards intended to ship as a coherent unit** — a release horizon, a cross-version initiative, or any "I'll know it's done when X" container. Every milestone description must answer *what's the unit of completion?* If it can't, it's a tag, not a milestone.

| Shape | Naming | Boundary | Example |
|---|---|---|---|
| **Release-shaped** | `vN.M.P — Theme` | a version cut | `v4.2.0 — Taxonomy primitives` |
| **Theme-shaped** | free-form initiative name | "the initiative is done" | `Adoption Push`, `Rebrand → Pigeon` |

Theme-shaped milestones span versions. Don't leave them open indefinitely — `updateMilestone({ ..., state: "archived" })` hides shipped/abandoned milestones from the picker without deleting their card assignments. `mergeMilestones` is the cleanup primitive for duplicate names — `listMilestones` flags candidates via `_governanceHints` (singleton > 60 days, near-name neighbours within Levenshtein ≤ 2).

Singleton milestones (one card) are almost always wrong — either the milestone is premature or the card belongs in an existing milestone.

## Claims / Facts schema

`saveClaim` / `listClaims` are the canonical persistent-knowledge tools (unified `statement` + `body` + `evidence` + `payload` shape over the `Claim` table). Legacy `saveFact` / `listFacts` aliases still work as thin wrappers; prefer the claim names. Aliases removed next major. Each entry has a **type** (or **kind**, in claim parlance) that determines its schema:

- **`type: "context"`** — project-level knowledge. `content` = assertion. Optional `rationale`, `application`, `details[]`, `audience`, `citedFiles[]`, `surface`. Surface levels: `ambient` (auto-loaded, use sparingly), `indexed` (queryable, default), `surfaced` (reserved).
- **`type: "code"`** — file/symbol-anchored assertions; auto-tracked for staleness. `content` + `path` (required, repo-relative); optional `symbol`, `recordedAtSha`. **No line numbers** — they rot. `needsRecheck` auto-sets when the cited file's latest commit differs from `recordedAtSha`. Find stale via `listFacts({ type: "code", needsRecheck: true })`.
- **`type: "measurement"`** — environment-dependent numerics. `content` + `value` + `unit` (required); optional `env` (JSON deps — hardware/runtime + version-sensitive tools), `path`, `symbol`, `ttl` (days for periodic re-run). `needsRecheck` auto-sets on TTL expiry, SHA drift, or age thresholds.

## Decision supersession

When a new architectural decision replaces an old one, use `supersedesId` on `recordDecision` or `updateDecision`. This (1) marks the old decision `superseded`, (2) links both bidirectionally, (3) triggers staleness warnings on citations of the old one. Don't manually set `status: "superseded"` without linking.

### When to reach for `supersedesId` vs. a fresh decision

Agents tend to default to "new decision" even when the prior one already covers the topic — the chain matters more than another row.

- ✅ "JSON is canonical" supersedes "Default tool output is JSON, not TOON" — same question, refined answer.
- ✅ "Module boundary: src/server/ ↔ src/mcp/ are isolated" supersedes "Helpers consolidated into hasRole" — narrow rolls into broader.
- ❌ "Drop optimistic locking" alongside "Note + Claim consolidation" — different questions; record both fresh.

If unsure: `queryKnowledge({ projectId, topic: "<area>" })` surfaces prior decisions on the same surface.

## Last-write-wins semantics

This is a single-user local tool — concurrent edits on the same entity are rare, and the UI re-reads on every change. Writes use last-write-wins: **no version field, no conflict errors**.

**`lastEditedBy`** — Card tracks which agent last modified it. Stamped automatically via `AGENT_NAME` on creates, updates, and moves. Check it before editing if you suspect the human or another agent just touched the card.

**`intent` UX (Pigeon-internal)** — when `intent` is provided, the UI flashes a 10-second banner on the card so the human sees it live, and activity-strip entries render it in italic below the action. The universal `intent` rule (which tools require it, what makes a good `intent` string) lives in `docs/AGENT-GUIDE.md`.

## Column definitions (Pigeon-side notes)

Universal column conventions live in [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) (Backlog top-3 = pinned, In Progress limit, Review/Done semantics, Parking Lot). Pigeon-specific migration history:

> **#97** — The legacy "Up Next" column was removed. Its function (human-priority queue) is now expressed by **position in Backlog** — top 3 = pinned. Keeps columns as pure workflow stages and avoids duplicating the `priority` field.

> **#174** — The **Done** column is sorted by ship-date (most recent first), backed by `Card.completedAt` (set on enter, cleared on leave). Manual reorder within Done is intentionally a no-op; cards may still be dragged in or out. The `position` field is irrelevant for Done.

## Knowledge search

`queryKnowledge(projectId, topic)` searches across all project knowledge: cards, comments, decisions, notes, handoffs, code facts, context entries, and indexed repo markdown. Uses **SQLite FTS5 with Porter stemming** for relevance-ranked results. The index auto-initializes on first query and covers repo `*.md` files up to 100KB each, max depth 5 directories.

`renderStatus(projectId)` generates a STATUS.md-equivalent markdown snapshot from board data — replaces hand-maintained STATUS.md files. Same output is auto-loadable as MCP resource `status://project/<slug>`.

## MCP tool architecture (essential vs. extended)

**10 essential tools** are always visible to the model: `briefMe`, `saveHandoff`, `createCard`, `updateCard`, `moveCard`, `addComment`, `registerRepo`, `checkOnboarding`, `getTools`, `runTool`. Source of truth: `ESSENTIAL_TOOLS` in `src/mcp/manifest.ts`.

Everything else (~65 tools) lives behind `getTools` / `runTool`:

```
getTools()                        // browse categories
runTool({ tool, params })         // execute an extended tool
```

`briefMe` composes the common session-start views (board, search, roadmap) internally — you rarely need to call those by hand.

**Naming convention.** Tool names are `camelCase` verbs. `bulkX` for batch variants (`bulkCreateCards`, `bulkUpdateCards`). `listX` returns governance hints; `getX` is direct fetch. Card-write tools take strict `tagSlugs: string[]` and `milestoneId: string` — legacy `tags` / `milestoneName` paths still work but emit `_deprecated` warnings (removed next major).

**`planCard` is extended.** Call via `runTool({ tool: "planCard", params: { boardId, cardId } })` — calling it as essential fails with "tool not found." Returns card context, `tracker.md` policy, `investigation_hints`, and the four-section protocol. See `docs/AGENT-GUIDE.md` for the chat-is-draft, card-is-publish workflow.

**Pigeon-internal extras worth knowing:** `auditBoard` finds cards missing priority/tags/milestones/checklists; `createCardFromTemplate` (Bug Report, Feature, Spike, Tech Debt, Epic) is faster than hand-rolling; `getCommitSummary(cardId)` returns commits grouped by category (source, schema, styles, tests, config, docs, other) — the card detail sheet renders this as a collapsible section.

## Connecting a project + agent identity

Run the connect script from the target project's directory:

```bash
# Default — writes AGENT_NAME=Claude into the project's .mcp.json
/path/to/pigeon/scripts/connect.sh

# Override with any label
AGENT_NAME=Codex /path/to/pigeon/scripts/connect.sh
```

**Resolution order at MCP server start:**

1. `AGENT_NAME` env from the project's `.mcp.json` (defaults to `"Claude"`)
2. Client name from MCP `initialize` handshake (e.g. `claude-code`, `codex`) — only when (1) is empty
3. Literal `"Agent"` — fallback

`connect.sh` prints a snippet to paste into `CLAUDE.md` / `AGENTS.md` — derived from `scripts/print-connect-snippet.ts`, which reads `ESSENTIAL_TOOLS` + `getAllExtendedTools()`, so counts and names never drift.

## CHANGELOG entries

Every PR that needs a CHANGELOG line follows the entry style in [`docs/VERSIONING.md`](docs/VERSIONING.md#changelog-entry-style): one short paragraph per bullet (~280 chars, 1–2 sentences), lead with what changed and why it matters, end with the `(#NNN)` tracker link. Forensic detail (file paths, removed type names, grep verification, merge-resolution narrative) belongs on the card, not in the notes.

## Token tracking

Per-session token cost surfaces on cards (Token cost section), in `briefMe`'s pulse line, on the Handoffs sheet, and on the per-project Costs page (`/projects/<projectId>/costs`). Tracking is **opt-in per agent** — Pigeon never reads transcripts on its own.

Operator setup (Stop hook + silent-drop debugging) lives in [`docs/token-tracking.md`](docs/token-tracking.md). Conceptual model (attribution, savings formula, pricing) lives at the docs-site [`/costs/`](https://2nspired.github.io/pigeon/costs/) page. The fastest path is the in-app dialog (Pulse strip → "Set up token tracking") which renders the Stop-hook snippet pre-filled with this machine's absolute path.

## Tool migration history

v2.x consolidations, v4.2 tag rework, v5.0 `projectPrompt` removal, v5.2 `endSession` → `saveHandoff` rename, v6.0 alias removal — full history in [`docs/MIGRATION-HISTORY.md`](docs/MIGRATION-HISTORY.md). Read it only if you hit an old tool name in transcripts or prompts that no longer resolves.
