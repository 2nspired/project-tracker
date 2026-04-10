# Agent Guidelines for Project Tracker

Shared guidelines for any AI agent (Claude, Codex, etc.) using the Project Tracker MCP.

When this MCP is connected to a project, use the board as your shared workspace with the user. These guidelines keep it useful without burning tokens.

## Project Prompt

Each project has an optional `projectPrompt` field — a short orientation paragraph that auto-loads at session start via `checkOnboarding`. Use `updateProjectPrompt` to set it.

**When to use `projectPrompt` vs. repo-side CLAUDE.md:**
- `projectPrompt` is stored in the tracker DB and shared across all agent accounts. Use it for project-level context that any collaborator (human or agent) needs at session start — current phase, key constraints, what to focus on.
- `CLAUDE.md` lives in the repo and is scoped to that repo's code. Use it for build commands, code conventions, and repo-specific instructions.

## Column Definitions

| Column | Purpose | When to move here |
|---|---|---|
| **Backlog** | Known work that hasn't been prioritized yet. Dumping ground for "we should do this eventually." | When identifying future work during planning or conversation |
| **To Do** | Prioritized and ready to pick up. This is the active work queue. | When the user or agent agrees this should happen next |
| **In Progress** | Actively being worked on right now. Limit to 2-3 cards to stay focused. | When you start writing code or doing real work on it |
| **Review** | Code is written, needs human review, testing, or verification. Not present on all boards. | When the agent finishes implementation and wants the user to check |
| **Done** | Shipped, merged, verified. No more work needed. | After human confirms it's good, or after merging |
| **Parking Lot** | Ideas, maybes, "what if we..." — not committed to. Low-cost storage for thoughts that might become real work later. | When someone has an idea but it's not actionable yet |

## When to Use the Board

**Start of conversation** — Call `getBoard` once to understand current state. For large boards (50+ cards), use `getBoard` with `summary: true` or `excludeDone: true` to reduce payload. You can also filter to specific columns with `columns: ["Backlog", "To Do", "In Progress"]`. This replaces re-reading files and git logs to figure out where things stand. If there are checklist items or cards in "To Do", that's your work queue.

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
| What needs to be done | Cards in To Do / Backlog |
| Current work breakdown | Checklist items on the active card |
| Architecture decisions | Comment on the relevant card |
| "Why did we choose X?" | Comment on the card |
| Ideas for later | Card in Parking Lot |
| Bug or issue found during work | New card with priority set |
| What changed in code | Git commit (not the board) |

## Linking Commits to Cards

When you commit work related to a card, add a comment linking the commit:

```
addComment #7 "Commit: abc1234 — Add auth middleware"
```

This keeps the card's history connected to the code without needing a formal model. Do this as part of your end-of-work flow, not after every small commit.

## Efficiency Tips

### Reducing Token Usage
- Use `getBoard` with `summary: true` for lightweight views (no descriptions or checklist items)
- Use `getBoard` with `excludeDone: true` to skip Done/Parking columns — often the bulk of payload
- Use `getBoard` with `columns: ["To Do", "In Progress"]` to fetch only the columns you need
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

This project is tracked in the Project Tracker board.
Use the `project-tracker` MCP tools to read and update the board.
At the start of each conversation, use the `start-session` prompt with the board ID.
Reference cards by #number in conversation (e.g. "working on #7").
```
