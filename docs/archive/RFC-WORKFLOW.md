# RFC: `tracker.md` — Versioned In-Repo Policy Contract

> Status: **Proposed** · Authored 2026-04-29 · Card: #111

## Problem

Pigeon has **three** places that try to give agents project-level guidance, and none of them are runnable contracts:

| Surface | Lives | Loaded when | Authoritative for |
|---|---|---|---|
| `CLAUDE.md` | Repo root | Every Claude Code session | Build commands, code conventions |
| `AGENTS.md` | Repo root | Read on demand | Cross-agent conventions |
| `projectPrompt` (DB column on `Project`) | Tracker DB | `checkOnboarding` response | Project orientation |

Three real costs:

1. **Precedence is undefined.** When the same instruction appears in two places (or contradicts), nothing tells the agent which wins.
2. **`projectPrompt` is invisible to git.** It's a DB row, so changes can't be reviewed, branched, or rolled back. The most policy-shaped surface is the least version-controllable.
3. **Per-column guidance has nowhere to live.** "When in Review, don't merge without human approval" or "When in In Progress, link commits via `syncGitActivity`" are real rules we want agents to follow, but they have no home — they end up buried in `AGENTS.md` prose where agents don't reliably find them at the moment they matter.

## Inspiration

[Symphony SPEC §5: Workflow Specification](https://github.com/openai/symphony/blob/main/SPEC.md#5-workflow-specification-repository-contract) — `WORKFLOW.md` as a single Markdown file with YAML front matter, version-controlled in the repo, hot-reloaded on change.

We adopt the **pattern** (in-repo policy file, parsed front matter, hot-reloaded), not the schema. Symphony's schema is for orchestration (polling, dispatch, codex command, sandbox); ours is for board policy.

## Proposal (TL;DR)

A single file, `tracker.md`, lives at the repo root. It carries the project's runtime policy in YAML front matter and a human-readable prose body. Tracker MCP tools parse it, surface the policy in their responses, and hot-reload on change. The `projectPrompt` DB column is migrated into it and deprecated.

## The File

### Filename: `tracker.md` at repo root

**Decided.** Not `BOARD.md` (too narrow — projects can have multiple boards but one policy), not front matter inside `AGENTS.md` (mixes human contributor docs with parsed runtime config — creates "is this comment or config?" ambiguity).

The tradeoff is one more root-level file. Acceptable.

### Day-one schema

```markdown
---
schema_version: 1
project_slug: project-tracker-dev
intent_required_on:
  - moveCard
  - deleteCard
columns:
  In Progress:
    prompt: |
      Link commits via syncGitActivity every time you finish a logical chunk.
      Update intent if scope changes.
  Review:
    prompt: |
      Review means human-verify, not agent-merge. Don't move to Done without
      explicit human approval in a comment.
---

# Project policy for project-tracker-dev

When picking up work, always run `briefMe` first. Prefer `source: 'pinned'` over `source: 'scored'`.
Don't create speculative cards — file them as comments on the most relevant existing card unless the human explicitly asks for a new one.
```

**Two front-matter keys ship in v1:**

- `intent_required_on: string[]` — list of MCP tool names where the agent must pass an `intent` parameter. Today this is hardcoded in tool schemas; moving it to policy lets each project tighten or relax.
- `columns: Record<string, { prompt: string }>` — column-name keyed map of agent-facing prose, surfaced by `getCardContext` for cards in that column.

**Deferred to v1.1+ (with a card filed when first user asks):** `wip_limits`, `stale_threshold_days`, `pinned_priority_override`. YAGNI applies — no observed demand yet.

`schema_version: 1` ships from day one so future additions are non-breaking.

### Body

The Markdown body below the front matter is treated as the project's general agent prompt. It replaces the `projectPrompt` DB column. `briefMe` includes it in its response under `policy.prompt`.

## Reading Order

When agents bootstrap a session, they read these surfaces in order. Later surfaces refine, never override, earlier ones unless explicitly noted:

1. **`tracker.md`** — runtime policy + project prompt + per-column prompts. *New, authoritative for board behavior.*
2. **`CLAUDE.md`** — Claude Code-specific repo conventions (build commands, code style). Unchanged.
3. **`AGENTS.md`** — cross-agent contributor conventions. Unchanged in content, but **deprecated as policy surface** — anything in `AGENTS.md` that affects runtime board behavior moves to `tracker.md` over time. `AGENTS.md` becomes contributor docs.
4. **`projectPrompt`** (DB column) — **deprecated.** See migration below.

## Runtime Behavior

### How tracker.md is consumed

- **`briefMe`** — reads `tracker.md` from the project's `repoPath`, parses front matter, includes it under a `policy` key in the response. Body becomes `policy.prompt`.
- **`getCardContext`** — for the card's current column, includes `policy.columns[<columnName>].prompt` in the response if defined.
- **Tools listed in `intent_required_on`** — the MCP server enforces the `intent` parameter at the tool boundary, returning a validation error if missing. Today this is per-tool; tomorrow it's per-project policy.
- **Hot reload** — `tracker.md` is read on every MCP tool call (it's small; SQLite is local; this is fine). No file watcher needed for v1; we get the Symphony "hot-reload on change" property for free because there's no caching layer to invalidate.

### Validation

- **Strict YAML parse** via `js-yaml` (already a transitive dep).
- **Zod schema** at the service boundary — same pattern as `Note.metadata` / `Claim.payload` per [RFC-NOTE-CLAIM-PRIMITIVES.md](RFC-NOTE-CLAIM-PRIMITIVES.md).
- **On parse error,** `briefMe` returns the policy as `null` and surfaces a `policy_error` field with the parse message — never crashes. This means a malformed `tracker.md` degrades to "no policy" rather than blocking the session.
- **`schema_version` mismatch** — v1 server tolerates higher minor versions (`1.x` reads `1.y`); rejects `2.x`+ with a clear error.

## Conflict Resolution: `tracker.md` vs `projectPrompt`

**Decided: file wins, with a one-line warning in `briefMe`.**

If both `tracker.md` (with body content) and `projectPrompt` exist, the file's body is used as the policy prompt. `briefMe` surfaces a warning in its response:

```
"_warnings": [
  "Project has both tracker.md and a non-empty projectPrompt. Using tracker.md.
   Run `migrateProjectPrompt` or delete the DB value to clear this warning."
]
```

The file is version-controlled and reviewable; the DB column is not. If both exist, the file is the *intended* state.

The alternative ("DB wins because it's newer") loses git history value and was rejected.

## Migration Plan: `projectPrompt` → `tracker.md`

Three-phase, with the human in the loop. Each phase is its own card after this RFC accepts.

### Phase 1: Read-side support

Tracker MCP tools learn to read `tracker.md` and surface its body alongside `projectPrompt`. If both exist, `tracker.md` body wins. `briefMe` emits the warning above. **No DB changes yet** — projects that haven't adopted the file see no behavior change.

### Phase 2: One-shot auto-migration

Add a `migrateProjectPrompt` tool. When called against a project:

1. If `tracker.md` exists in `repoPath`, abort with "already migrated."
2. Otherwise, write `tracker.md` with:
   - Auto-generated front matter (`schema_version: 1`, `project_slug` from project name, no `columns` or `intent_required_on` — those are opt-in)
   - Body = current `projectPrompt` value
3. Print the path to the new file. **The tool does not delete the DB value** — that's a human-eyeball step, not an automatic one.
4. `briefMe` continues to warn until the human deletes the DB value (or sets it to empty).

Auto-migration is opt-in, not silent. Reason: silent migration loses the human's chance to review what got moved into a now-version-controlled file.

### Phase 3: Field removal

In the next major (v5.0.0), drop the `projectPrompt` column from the schema. Anyone still relying on it has had a full major version of warning. Migration to `tracker.md` is the documented path.

## Open Questions Resolved by This RFC

The card description listed five open questions. Each is now decided:

| Question | Decision |
|---|---|
| Filename: `tracker.md` vs `BOARD.md` vs front matter in `AGENTS.md` | **`tracker.md`** at repo root |
| Day-one front-matter scope | **`intent_required_on` + `columns.<name>.prompt` only.** Defer `wip_limits`, `stale_threshold_days`, etc. |
| `projectPrompt` migration path | **Opt-in `migrateProjectPrompt` tool**, deprecation warning in `briefMe`, field removed in next major |
| Conflict between file and DB | **File wins.** Warning surfaced in `briefMe` until DB value cleared |
| Multi-board projects | **Project-level only for v1.** Per-board override via `boards.<id>` is additive, deferred until requested |

## Out of Scope (vs. Symphony)

Symphony's `WORKFLOW.md` covers things we explicitly do not need:

- **Polling/dispatch config** — we're not a runner; agents call our tools directly
- **Codex command + sandbox config** — different layer; agents handle their own workspaces
- **Workspace hooks** (`after_create`, `before_run`, etc.) — same reason
- **Tracker selection** (`tracker.kind: linear`) — Pigeon *is* the tracker; selection is implicit

## Implementation Cards (to file after RFC accepts)

These are the buildable units, in order:

1. **Read `tracker.md` in `briefMe`** — front-matter parse, surface under `policy`, body alongside `projectPrompt`. File-wins conflict warning.
2. **Surface column prompts in `getCardContext`** — extend response shape with `policy.columnPrompt` when card's column has one defined.
3. **Enforce `intent_required_on` in MCP tool boundary** — small middleware that consults the parsed policy on each call.
4. **Add `migrateProjectPrompt` tool** — Phase 2 of migration plan above.
5. **Add zod schema + parse-error degradation** — `policy_error` field in `briefMe`.
6. **Update tutorial seed + AGENTS.md** — example `tracker.md` for the tutorial project; AGENTS.md edits to redirect runtime policy guidance to `tracker.md`.
7. **(v5.0.0)** Drop `projectPrompt` column.

Cards 1–5 are independently shippable behind a "tracker.md exists" guard. The schema doesn't change for any of them — `projectPrompt` stays a column until card 7.

## Acceptance for This Card (#111)

- [x] RFC doc landed in `docs/RFC-WORKFLOW.md`
- [x] Filename, schema, reading order, conflict resolution, migration path all decided in the doc
- [x] Migration plan for `projectPrompt` documented (3 phases)
- [x] No code changes in this card — implementation is cards 1–7 above, filed after RFC accepts

## Notes

- The body of `tracker.md` is intentionally Markdown, not YAML. Front matter is for the parser; the body is for the human and for the agent's natural-language context. Forcing the prompt into a YAML string would make it brittle and unpleasant to write.
- `tracker.md` is not the same as `CLAUDE.md`. `CLAUDE.md` is for Claude Code session bootstrap (build commands, code style); `tracker.md` is for Pigeon board behavior. They can coexist in a repo and answer different questions.
