# Project Surfaces: `tracker.md` vs `CLAUDE.md` vs `AGENTS.md`

Three Markdown files at the root of a connected project. Each answers a different question. Knowing which goes where keeps them small, focused, and non-overlapping.

## At a glance

| File | Read by | Authoritative for | Lifecycle |
|---|---|---|---|
| `tracker.md` | Tracker MCP tools (`briefMe`, `getCardContext`, `planCard`, write tools listed in `intent_required_on`) | Runtime board policy: project agent prompt, per-column prompts, intent enforcement | Hot-reloaded on every MCP tool call |
| `CLAUDE.md` | Claude Code (the CLI), at session start | Build commands, code conventions, repo-specific developer instructions | Loaded once per Claude Code session |
| `AGENTS.md` | Humans (and agents on demand) | Cross-agent contributor reference: conventions, tool migration history, Pigeon UX guidance | Read on demand |

## When to put a thing in `tracker.md`

If the answer is **yes** to any of these, it belongs in `tracker.md`:

- Should agent moves/deletes require an `intent` for this project? → `intent_required_on`
- "When a card is in column X, the agent should…" → `columns.<X>.prompt`
- A short orientation paragraph the agent should read at session start (current phase, key constraints) → body

The body is the project's general agent prompt.

```markdown
---
schema_version: 1
project_slug: my-project
intent_required_on:
  - moveCard
  - deleteCard
columns:
  In Progress:
    prompt: |
      Limit to 2-3 cards. Move here when you start writing code, not when planning.
  Review:
    prompt: |
      Code is written and needs human verification. Don't move to Done without
      explicit approval in a comment.
---

# Project policy for my-project

Start every session with `briefMe`. Prefer `source: 'pinned'` over `source: 'scored'`.
End every session with `endSession` — saves a handoff and links new commits.
```

`tracker.md` is git-versioned, reviewable, and rolls back like any other file. The DB column was none of those.

## When to put a thing in `CLAUDE.md`

If the answer is about **how Claude Code itself should work in this repo**, it belongs in `CLAUDE.md`:

- `npm run dev` / build / test commands
- Code style conventions specific to this repo
- "Don't run X without confirming" guardrails
- File-layout pointers

`CLAUDE.md` is loaded by Claude Code at session start. Tracker tools don't read it.

## When to put a thing in `AGENTS.md`

If it's **cross-agent contributor reference** that doesn't belong in `tracker.md` or `CLAUDE.md`, it belongs here:

- Tool migration tables (what changed in v2.3, v2.4, etc.)
- Tag conventions (`component`, `metric`, etc.)
- "When to use the board" prose
- Anything that helps a contributor onboard but doesn't affect runtime board behavior

`AGENTS.md` is read on demand. If something in `AGENTS.md` overlaps with `tracker.md`, `tracker.md` wins.

## planCard — locked-output card planning

`planCard({ boardId, cardId })` is the canonical way to plan a card. It returns the card context, the `tracker.md` policy (so the agent's plan respects the project's body prompt and the card's column prompt), `investigation_hints` extracted from the description, and a fixed `protocol` instructing the agent to synthesize a plan with four level-2 headings:

- `## Why now`
- `## Plan`
- `## Out of scope`
- `## Acceptance`

The agent drafts the plan in chat, gets user confirmation, then writes it to the card description via `updateCard` and (optionally) promotes the card with `moveCard`. Every planned card emerges with the same shape — humans and future agents always find the plan in the same place.

**Refuse-on-exists.** If the description already contains the locked headers (`## Why now` + `## Plan` + `## Acceptance`), `planCard` returns `_warnings[].code === "PLAN_EXISTS"` and omits the `protocol` field. The agent surfaces the warning rather than silently overwriting a published plan. To force a re-plan, edit the description to remove the headers, then call `planCard` again.

In Claude Code, the `/plan-card N` slash command is a thin wrapper that invokes the tool and walks the protocol response.

## See also

- [RFC #111: tracker.md as in-repo policy contract](RFC-WORKFLOW.md) — the design doc
- [AGENTS.md](../AGENTS.md) — contributor reference
