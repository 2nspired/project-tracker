---
description: Start a Project Tracker session — load the latest handoff, top work, blockers, and pulse via the briefMe MCP tool.
---

Call the `briefMe` MCP tool to load this session's primer.

```
briefMe()
```

`boardId` is auto-detected from the current git repo (after `scripts/connect.sh` has bound the project). Pass `boardId` explicitly to override.

The response is small (~300-500 tokens) and includes:

- **handoff** — last session's summary, findings, next steps, blockers
- **diff** — what's changed on the board since that handoff
- **topWork** — three highest-leverage cards (Up Next first, then scored Backlog)
- **blockers** — cards waiting on something
- **recentDecisions** — active architectural decisions on still-active cards (drops once the card ships)
- **pulse** — one-line board health summary

After it returns:

1. **Pick a card.** Prefer `handoff.nextSteps` if it points somewhere concrete; otherwise pick from `topWork`.
2. **Load deep context.** `runTool('getCardContext', { boardId, cardId: '#N' })` for the card you'll work on.
3. **Discover recipes.** `runTool('listWorkflows', { boardId })` to see the named procedures (sessionStart, sessionEnd, recordDecision, searchKnowledge).

If `briefMe` returns `needsRegistration`, this repo isn't bound to a project yet — ask the human which project to attach it to, then call `registerRepo({ projectId, repoPath })`.
