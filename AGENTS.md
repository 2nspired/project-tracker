# Agent Guidelines for Pigeon

> **Runtime board policy lives in [`tracker.md`](tracker.md)** at the project's repo root — that file is the source of truth for `intent_required_on`, per-column prompts, and the project's general agent prompt. This document is contributor docs: tool migration history, conventions, and reference material that hasn't been moved (and may not need to be). When this file and `tracker.md` overlap, `tracker.md` wins. See [docs/SURFACES.md](docs/SURFACES.md) for the full surface map.

> If the human can't see it and correct it in the surface where they'd naturally encounter it, the agent shouldn't trust it.

Shared guidelines for any AI agent (Claude, Codex, etc.) using the Pigeon MCP.

When this MCP is connected to a project, use the board as your shared workspace with the user. These guidelines keep it useful without burning tokens.

## Live tag + milestone API

Tags are project-scoped, with an immutable `slug` (kebab-case) and a mutable `label`. Milestones have a `state` column (`active` / `archived`). Card-write tools (`createCard`, `updateCard`, `bulkCreateCards`, `bulkUpdateCards`) take strict params: `tagSlugs: string[]` and `milestoneId: string`. Use `createTag` to introduce new vocabulary; `mergeTags` / `mergeMilestones` for cleanup; `listTags` / `listMilestones` return `_governanceHints` (singletons, near-name neighbours within Levenshtein 2) for triage.

Legacy `tags` / `milestoneName` paths still work but emit `_deprecated` warnings — they're slated for removal in the next major version.

> **Tool migration history** (v2.x consolidations, v4.2 tag rework, v5.0 `projectPrompt` removal, v5.2 `endSession` → `saveHandoff` rename, v6.0 alias removal) lives in [docs/MIGRATION-HISTORY.md](docs/MIGRATION-HISTORY.md). Read it only if you hit a tool name in old transcripts or prompts that no longer resolves.

## Project orientation — `tracker.md`

A project's runtime orientation lives in [`tracker.md`](tracker.md) at repo root (RFC #111). The legacy `projectPrompt` DB column was removed in v5.0.0 (#129); the body of `tracker.md` is now the only place to set the agent-orientation prompt for a project.

**When to use `tracker.md` vs. repo-side CLAUDE.md:**
- `tracker.md` is the project's runtime board policy — agent prompt body + machine-parsed front matter (`intent_required_on`, per-column prompts). Read by `briefMe` and `getCardContext`.
- `CLAUDE.md` is Claude Code's repo session bootstrap — build commands, code conventions, repo-specific instructions. Read by Claude Code at session start, not by tracker tools.

See [docs/SURFACES.md](docs/SURFACES.md) for a full breakdown.

## Intent on Writes

See [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) for the universal `intent` rule. Pigeon-internal note: when `intent` is provided, the UI flashes a 10-second banner on the card so the human sees it live, and activity-strip entries render it in italic below the action.

## Project Status

`renderStatus(projectId)` generates a STATUS.md-equivalent markdown snapshot from board data. It replaces hand-maintained STATUS.md files — if your repo has one, you can delete it after adopting renderStatus.

The same output is available as an auto-loadable MCP resource at `status://project/<slug>`.

## Tag Conventions

Tags are project-scoped (since v4.2) — same string in two projects = two distinct Tag rows. Each tag has an immutable `slug` (kebab-case via `slugify()`: trim → NFKD → lowercase → collapse non-alphanumeric to `-` → cap at 50 chars) and a mutable `label` (display). Pre-v4.2 free-form strings were canonicalized into the new model by `migrateTags`; the audit JSON in `data/tag-migration-*.json` documents which variants were merged.

### Convention: flat tags, type required, area optional

A card's tags should answer two orthogonal questions: *what kind of work is this?* and *what part of the system does it touch?* Tags are flat — no `feature:foo` colon-prefixed namespacing. Use a milestone if you need to group cards by feature or release.

| Slot | Required? | Vocabulary | Examples |
|---|---|---|---|
| **type** | required | closed list — exactly one of `bug`, `feature`, `chore`, `docs`, `epic`, `spike` | `bug`, `chore` |
| **area** | optional | open list — name the surface or subsystem | `mcp`, `ui`, `cli`, `schema`, `roadmap`, `briefme`, `handoff` |
| **reserved** | n/a | semantic slugs (see below) | `component`, `metric` |

A typical card carries one type + one area (e.g. `feature` + `mcp`). Add more area tags only when the work genuinely spans surfaces. Don't tag for prose (`important`, `cleanup-needed`) — that's what description and priority are for.

**`feature:foo` namespacing is deprecated.** v4.2 slugify rewrites `feature:auth` → `feature-auth`, but the convention since the Tag rework is: feature/release grouping lives on the milestone, not in tag prefixes. `mergeTags` is the cleanup primitive for surviving `feature-foo` slugs — fold them into the matching milestone and drop the tag.

### Reserved slugs

Two slugs have reserved semantic meaning across projects (declared here, not enforced by schema):

#### `component`

Marks a card whose description anchors a system-component bullet in the "What's Built" section of `renderStatus` output. Component cards can be never-closed description anchors (e.g., "Infrastructure: Mac Mini inference setup") that exist purely to hold description text — they are not work items.

#### `metric`

Marks a card whose `metadata` JSON holds metrics read by `renderStatus`. Shape:

```json
{ "metrics": [{ "key": "latency", "value": 17.5, "unit": "s", "recordedAt": "2026-04-10", "env": "Mac Mini M4" }] }
```

### Governance hints + cleanup (#170)

`listTags` returns a `_governanceHints` field per row when something deserves attention. Hints are emitted only when meaningful — **absent fields are not empty arrays**, they're "no signal."

| Hint | Meaning | Action |
|---|---|---|
| `singleton: true` | Tag is referenced by exactly one card | Decide if the vocabulary is premature. Rename to a broader peer, merge, or accept as a deliberate one-off |
| `possibleMerge: [{ id, label, distance }]` | Peers within Levenshtein distance ≤ 2 of this tag's slug | Run `mergeTags` to fold near-duplicates into the canonical tag |

Tags also carry a `state` field (`"active" \| "archived"`). `listTags` defaults to `state: "active"`; pass `state: "archived"` to inspect archived rows. The schema column was added forward-compat — no archive flow yet, so most projects will only ever see `active`.

**`deleteTag` is orphan-only by contract.** The service runs an atomic `DELETE … WHERE NOT EXISTS (SELECT 1 FROM card_tag …)` against the same row, so a concurrent CardTag insert closes the window: a tag picking up usage between your `listTags` call and the `deleteTag` confirm is rejected with `USAGE_NOT_ZERO` rather than getting deleted with rows still pointing at it. Recovery is `mergeTags` to drain references, then re-attempt the delete if the merge didn't already remove it.

The TagManager UI surfaces all of this: usage-desc sort, Singleton + Near-miss badges, click-to-pre-select-merge, and a disabled-with-tooltip Delete button on any tag with usage > 0. Open it from the project page header ("Manage tags") or the tag-combobox dropdown footer ("Manage tags →").

## Milestones

A milestone is a **bounded set of cards intended to ship as a coherent unit** — a release horizon, a cross-version initiative, or any other "I'll know it's done when X" container. The unifying rule: every milestone description must answer *what's the unit of completion?* If it can't, it's a tag, not a milestone.

### Two valid shapes

| Shape | Naming | Boundary | Example |
|---|---|---|---|
| **Release-shaped** | `vN.M.P — Theme` | a version cut | `v4.2.0 — Taxonomy primitives` |
| **Theme-shaped** | free-form initiative name | "the initiative is done" | `Adoption Push`, `Token Tracking & Cost Surfacing`, `Rebrand → Pigeon` |

Theme-shaped milestones span versions. They're the right home for cross-cutting work that doesn't map to a single release — adoption pushes, multi-version refactors, taxonomy initiatives. Don't leave them open indefinitely: archive once the initiative is done so the picker stays focused on active work.

`updateMilestone({ ..., state: "archived" })` hides shipped/abandoned milestones from the picker without deleting their card assignments. `mergeMilestones` is the cleanup primitive for duplicate or near-duplicate names — `listMilestones` flags candidates via `_governanceHints` (singleton > 60 days, near-name neighbours within Levenshtein 2).

Singleton milestones (a release or theme with one card) are almost always wrong — either the milestone is premature or the card belongs in an existing milestone. Treat the singleton hint as a prompt to merge or archive.

## Claims / Facts (Unified Knowledge Store)

`saveClaim` / `listClaims` are the canonical persistent-knowledge tools (unified `statement` + `body` + `evidence` + `payload` shape over the `Claim` table). The legacy `saveFact` / `listFacts` aliases — documented below by `type` — still work as thin wrappers; prefer `saveClaim` / `listClaims` for new code. The aliases are slated for removal in the next major version.

Each entry has a **type** (or **kind**, in claim parlance) that determines its schema:

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

### When to reach for `supersedesId` vs. a fresh decision

Reach for `supersedesId` when the new decision **replaces** an earlier one on the same question. Agents tend to default to "new decision" even when the prior one already covers the topic — the chain matters more than another row.

- ✅ "JSON is canonical" supersedes "Default tool output is JSON, not TOON" — same question (response format), refined answer.
- ✅ "Module boundary: src/server/ ↔ src/mcp/ are isolated" supersedes "Helpers consolidated into hasRole" — narrow `hasRole` decision rolls into the broader boundary rule.
- ❌ "Drop optimistic locking" alongside "Note + Claim consolidation" — different questions; record both as fresh decisions.

If you're unsure whether a new decision overlaps an existing one, query first: `queryKnowledge({ projectId, topic: "<area>" })` will surface prior decisions on the same surface.

## Knowledge Search

`queryKnowledge(projectId, topic)` searches across all project knowledge: cards, comments, decisions, notes, handoffs, code facts, context entries, and indexed repo markdown files. Uses SQLite FTS5 with Porter stemming for relevance-ranked results.

The index auto-initializes on first query. It covers repo `*.md` files up to 100KB each, max depth 5 directories.

## Column Definitions

See [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) for the column conventions (Backlog top-3 = pinned, In Progress limit, Review/Done semantics, Parking Lot).

**Pigeon-side migration history:**

> **Note (#97):** The legacy "Up Next" column was removed. Its function (human-priority queue) is now expressed by **position in Backlog** — top 3 = pinned. This keeps columns as pure workflow stages and avoids duplicating the `priority` field.

> **Note (#174):** The **Done** column is sorted by ship-date (most recent first), backed by `Card.completedAt` — set when the card enters Done and cleared when it leaves. Manual reorder within Done is intentionally a no-op; cards may still be dragged in or out. The `position` field is irrelevant for any card sitting in Done.

## When to Use the Board

See [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) for the session lifecycle (`briefMe` → work → `addComment` → `saveHandoff`).

## Planning a Card

See [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) for the `planCard` four-section protocol and the chat-is-draft, card-is-publish workflow.

## When NOT to Use the Board

See [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) for negative-space guidance.

## What Goes Where

See [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) for the information-routing table.

## Linking Commits to Cards

Reference card numbers in commit messages (e.g. `Add auth middleware (#7)`) and run `syncGitActivity` to auto-link them. Use `getCommitSummary(cardId)` to see a structured overview of all linked commits for a card.

For manual linking, add a comment:

```
addComment #7 "Commit: abc1234 — Add auth middleware"
```

Do this as part of your end-of-work flow, not after every small commit.

## Efficiency Tips

See [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) for the universal token-saving and bulk-operation tips. Pigeon-internal extras: `auditBoard` finds cards missing priority/tags/milestones/checklists; `createCardFromTemplate` (Bug Report, Feature, Spike, Tech Debt, Epic) is faster than hand-rolling.

## Connecting to a Project

Run the connect script from the target project's directory:

```bash
# Default — writes AGENT_NAME=Claude into the project's .mcp.json
/path/to/pigeon/scripts/connect.sh

# Override with any label you want
AGENT_NAME=Codex /path/to/pigeon/scripts/connect.sh
```

**Agent identity resolution.** Activity rows, `lastEditedBy`, and handoffs
stamp `AGENT_NAME` on each write. Resolution order at server start:

1. `AGENT_NAME` env var from the project's `.mcp.json` (the path `connect.sh`
   takes — defaults to `"Claude"`, override via the env var as shown above)
2. Client name from the MCP `initialize` handshake (e.g. `claude-code`,
   `codex`) — only consulted when `.mcp.json` has no `AGENT_NAME` entry
3. Literal `"Agent"` — fallback when the client also declared no name

Then add to the project's agent instructions file (`CLAUDE.md`, `AGENTS.md`, etc.) the snippet that `connect.sh` prints — it points the agent at [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) (also served live at `tracker://server/agent-guide`), which is the project-agnostic best-practices guide for any agent using Pigeon. The snippet is derived from `scripts/print-connect-snippet.ts`, so it stays in sync with the running server.

If you're adopting Pigeon and want to read the guide directly, start with [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md).

## Token Tracking (#96)

Per-session token cost surfaces on cards (Token cost section in card detail),
in `briefMe`'s pulse line, on the Handoffs sheet, and on the per-project
**Costs page** at `/projects/<projectId>/costs` — four lenses: overhead,
"Pigeon paid for itself" savings, cost-per-shipped-card, and model
breakdown. Tracking is opt-in per agent — Pigeon never reads your transcript
on its own.

Token tracking: see [`docs/token-tracking.md`](docs/token-tracking.md) for
operator setup (Stop hook + silent-drop debugging) and the docs-site
[`/costs/`](https://2nspired.github.io/pigeon/costs/) page for the
methodology (attribution, savings formula, pricing decisions).

### Claude Code (automatic)

Add a Stop hook to one of Claude Code's `settings.json` files — user-level
(`~/.claude/settings.json`), project-level (`<repo>/.claude/settings.json`,
shared/committed), or project-local (`<repo>/.claude/settings.local.json`,
per-machine/gitignored). The hook **must** live in a `settings.json` file:
in CC 2.1.x the `hooks` key in `.claude.json` is silently ignored.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/your/pigeon/scripts/stop-hook.sh"
          }
        ]
      }
    ]
  }
}
```

Replace the `command` value with the absolute path to `scripts/stop-hook.sh`
in your local Pigeon clone. The in-app setup dialog (Pulse strip → "Set up
token tracking") fills this path in automatically — paste verbatim from
there. We use `type: "command"` rather than `type: "mcp_tool"` because the
latter no-ops without error in CC 2.1.x for this hook config.

The script invokes `tsx scripts/stop-hook-record-tokens.ts`, which reads the
parent transcript and any sub-agent transcripts at
`<dirname>/<sessionId>/subagents/agent-*.jsonl`, sums per-model usage, and
writes one `TokenUsageEvent` row per (sessionId, model). Re-running the hook
on the same transcript replaces rather than duplicates. Every fire writes a
diagnostic line to `<repo>/data/stop-hook.log` so silent failures are
debuggable.

### Other agents (manual)

Codex, generic MCP clients, and anything without Claude Code's transcript
format call `recordTokenUsage` directly at session end:

```
recordTokenUsage({
  projectId, // or boardId
  model: "gpt-4o",
  inputTokens: 12345,
  outputTokens: 6789
})
```

Each call creates one new row — sum your counts before invoking, don't loop.

### Pricing

Default rates ship for Anthropic (Opus/Sonnet/Haiku) and OpenAI (GPT-4o,
mini, turbo, o1). Override per-model rates via the settings UI or by calling
`tokenUsage.updatePricing` from the web app. Defaults are last-verified
2026-04 — sanity-check the provider's pricing page if it's been a while.
```
