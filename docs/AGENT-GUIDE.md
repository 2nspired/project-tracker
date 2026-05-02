---
schema_version: 1
title: Pigeon Agent Guide
audience: any AI agent using Pigeon from a connected project
---

# Pigeon Agent Guide

> If the human can't see it and correct it where they'd naturally encounter it, the agent shouldn't trust it.

This is the project-agnostic guide for any AI agent (Claude, Codex, etc.) using Pigeon as a shared workspace with a human collaborator. If you've just been connected to a project via `scripts/connect.sh`, read this first — it's portable across every Pigeon-connected repo.

When this guide and a project's `tracker.md` disagree, **`tracker.md` wins**. `tracker.md` carries the project-specific runtime policy (intent enforcement, per-column prompts, the project's general agent prompt). This guide carries the conventions that apply everywhere.

## Session lifecycle

Every session has the same shape:

1. **Start with `briefMe`.** Returns the latest handoff, top-3 work, blockers, recent decisions, and a one-line pulse. ~300–500 tokens vs. a full board fetch. With no args, auto-detects the board from your git repo.
2. **Move a card to In Progress before you start.** Don't work silently. Pick one card, move it, and pass an `intent` saying what you're about to do.
3. **Use the board to record decisions, not chatter.** `addComment` on the active card when you make an architectural choice or hit a blocker. Future agents read these.
4. **End with `saveHandoff`.** Saves a summary, links new commits, reports which cards you touched, and returns a copy-pasteable resume prompt for the next chat. In Claude Code the `/handoff` slash command calls it for you.

## Column conventions

| Column | Purpose | When to move here |
|---|---|---|
| **Backlog** | All known work, ordered by priority. **The top 3 positions are treated as human-pinned** — they surface ahead of score-ranked cards in `briefMe.topWork` (`source: "pinned"`). | When identifying future work. To signal "I want this next," drag a card to the top. |
| **In Progress** | Actively being worked on right now. Limit to 2–3 cards to stay focused. | When you start writing code or doing real work — not when planning. |
| **Review** | Implementation done, needs human review or verification. Not present on every board. | When you finish implementation and want the user to check before merge. |
| **Done** | Shipped, merged, verified. No more work. | After human confirmation, or after merging. Done is sorted by ship-date — manual reorder is a no-op. |
| **Parking Lot** | Ideas, maybes — not committed to. | When something might become real work later but isn't actionable yet. |

**A card at the top of Backlog means: this is what the human wants done next.** The first three Backlog cards are surfaced in `briefMe.topWork` as `source: "pinned"`. Treat them as the recommended queue; pick from there unless the human says otherwise.

## `intent` on writes

When you call a write tool that changes board state, include a short **`intent`** string saying *why* — one sentence, ≤120 chars, user-visible on the card and in the activity strip.

The human watching the board sees actions stream by in real time. Without `intent`, a move from `In Progress` → `Review` is silent noise. With it, they read your reasoning and decide whether to step in.

| Tool | `intent` | Notes |
|---|---|---|
| `moveCard` | **required** | Every move needs a reason (WIP stall, ready for review, parked, blocked). |
| `deleteCard` | **required** | Intent gates a destructive action. |
| `updateCard` | optional | Pass when the edit reflects a decision or discovery, not just a typo fix. |

Examples:

```
moveCard({ cardId: "#42", columnName: "Review", intent: "Tests green, ready for user to verify before merge" })
moveCard({ cardId: "#42", columnName: "Parking Lot", intent: "Parked — waiting on design decision in #39" })
updateCard({ cardId: "#42", priority: "HIGH", intent: "Bumped after user reported it blocks the Q2 launch" })
```

Don't:

- Restate what the tool already shows (`"Moving to Done"` on a `moveCard` to Done).
- Use `intent` as a changelog (`"Fixed typo"`) — that's the commit message's job.
- Leave it blank on `moveCard` to satisfy the type. Write a real reason or don't move the card.

A project's `tracker.md` may extend `intent_required_on` to additional tools. The tool will reject the call with an actionable error if intent is required and missing.

## Planning a card

When the human asks you to plan a card (vague backlog item, parking-lot idea, fresh feature), call `planCard`:

```
runTool({ tool: "planCard", params: { boardId, cardId: "#N" } })
```

Or, in Claude Code, the `/plan-card N` slash command does the same thing.

`planCard` returns the card context, the project's `tracker.md` policy, an `investigation_hints` object (URLs, file paths, `#nnn` refs, code symbols extracted from the description), and a fixed `protocol` that walks you through synthesizing a plan with four level-2 headings, in this order:

1. `## Why now` — trigger or motivation
2. `## Plan` — concrete steps (numbered when order matters)
3. `## Out of scope` — what you considered and deferred
4. `## Acceptance` — testable verification criteria

**Chat is draft, card is publish.** Investigate using the hints, draft the plan in chat, get explicit user confirmation, *then* `updateCard` writes it to the description. Future agents (and humans) skim any card and find the plan in the same place.

If the description already contains the locked headers, `planCard` returns a `PLAN_EXISTS` warning and omits `protocol` — surface the warning and ask whether to revise rather than silently overwrite.

## Decisions and blockers — `addComment`

Use `addComment` on the active card to record:

- Architectural decisions ("Chose X approach because Y, considered Z but rejected because…").
- Blockers ("Stuck on auth — needs API key from user").
- User confirmations ("User confirmed they want A, not B").

These surface in `getCardContext` for future agents. Anything that would otherwise get lost between conversations belongs in a comment.

Don't comment for things git already records (`"updated file X"`) or for status changes the column transition shows.

## Linking commits to cards

Reference card numbers in commit messages — `Add auth middleware (#7)` — and Pigeon will link the commit to the card automatically. Use `#N` references everywhere: in commits, in chat, in card descriptions. Both you and the human use this shorthand.

Manual linking via comment also works:

```
addComment({ cardId: "#7", content: "Commit: abc1234 — Add auth middleware" })
```

Do this as part of your end-of-work flow, not after every small commit. `saveHandoff` runs the link sync automatically.

## Efficiency tips

- **`getBoard` is heavyweight.** Use `summary: true` for descriptionless lightweight views. Use `excludeDone: true` to skip the Done/Parking-Lot bulk. Use `columns: ["Backlog", "In Progress"]` to fetch only what you need.
- **Don't call `getBoard` repeatedly in one conversation.** The state is in your context after the first call. `briefMe` is the right session-start primer; full `getBoard` is for deep exploration.
- **Bulk operations.** Use `bulkCreateCards` instead of looping `createCard`. Use `bulkUpdateCards` to set priority, tags, or milestone on many cards at once.
- **Reference cards by `#N`, not UUID.** Both you and the human use the short ref.
- **`checkOnboarding` returns project and board lists inline** — no follow-up `listProjects`/`listBoards` needed.

## When NOT to use the board

- Don't update after every small code change. Git tracks that.
- Don't add comments that just say "edited file X" — the diff already says so.
- Don't create cards for trivial 2-minute tasks.
- Don't poll `getBoard` mid-conversation — work from your context, sync via `briefMe` next session.

## What goes where

| Information | Where it belongs |
|---|---|
| What needs to be done | Cards in Backlog (top 3 = pinned, surfaced in `briefMe.topWork`) |
| Current work breakdown | Checklist items on the active card |
| Architecture decisions | Comment on the relevant card via `addComment` |
| "Why did we choose X?" | Comment on the card |
| Ideas for later | Card in Parking Lot |
| Bug or issue found during work | New card with priority set |
| What changed in code | Git commit (referenced by `#N`), not the board |

## Worktrees

For parallel-safe work across branches, agents may use git worktrees (typically under `.claude/worktrees/agent-*`). A worktree is a checkout of a different branch sharing the parent repo's `.git`. Two rules:

- **Worktrees are for git isolation, not runtime.** Branch, edit, commit, push, open PR — all work. `npx tsc --noEmit` and `npm test` work too (they read from the worktree but resolve `node_modules` from the parent — same node binary, same dependencies).
- **Don't run `npm run dev` from a worktree.** Next.js's Turbopack workspace-root inference walks up looking for the *uppermost* lockfile and picks the parent repo as the root, then can't resolve `next/package.json` from the worktree. Symptom: silent route-registration 404s on new pages, or a hard "couldn't find next/package.json" error if you try to pin `turbopack.root`. Use the launchd service on port 3100 (which runs against the main checkout) for dev — pull a worktree branch into the parent repo for visual checks.

When you're done with a worktree (PR merged or work abandoned), the orchestrator removes it via `git worktree remove --force` so locked-and-stale worktrees don't accumulate.

## Tool architecture in one paragraph

10 essential tools are always visible: `briefMe`, `saveHandoff`, `createCard`, `updateCard`, `moveCard`, `addComment`, `registerRepo`, `checkOnboarding`, `getTools`, `runTool`. Everything else lives behind `getTools`/`runTool` — call `getTools()` with no args to browse categories, then `runTool({ tool, params })` to execute. `briefMe` composes the common session-start views (board, search, roadmap) internally so you rarely need to call them by hand.

## See also

- `tracker://server/manifest` — machine-readable snapshot of what's actually in the running server (versions, tool names, descriptions).
- `tracker://server/agent-guide` — this guide, served live from the connected project's repo.
- The project's `tracker.md` — runtime policy specific to this project (always wins over this guide on conflict).
