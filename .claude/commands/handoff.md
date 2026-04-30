---
description: Wrap up the current Pigeon session — save a handoff, link commits, report touched cards, and emit a resume prompt for the next chat.
---

`/handoff` is the human-facing entry point. Under the hood it calls the `saveHandoff` MCP tool — that's the one to invoke now.

(`saveHandoff` was named `endSession` before v5.2; the old name still resolves through v5.x with a `_deprecated` warning, and is removed in v6.0.0. Prefer `saveHandoff` in new agent prompts and scripts.)

Before calling it:

1. **Move any finished cards.** If work is done, call `moveCard({ cardId, columnName: "Done", intent })`. The handoff is about *what changed* — card positions should already match reality.
2. **Leave blockers on cards that need the human.** Use `addComment` if something specific needs to be seen on a card (not dumped into the generic handoff blockers list).

Then call:

```
saveHandoff({
  summary: "<one paragraph — what this session accomplished>",
  workingOn: ["<card refs or topics you touched>"],
  findings: ["<non-obvious discoveries worth carrying forward>"],
  nextSteps: ["<concrete first actions for the next agent>"],
  blockers: ["<anything waiting on a human or external change>"]
})
```

`boardId` is auto-detected from the current git repo. `syncGit` defaults to true — new commits referencing `#N` get linked automatically. For a mid-session checkpoint that skips git sync and the touched-cards report, pass `syncGit: false`.

After the tool returns, hand the `resumePrompt` string to the user so they can paste it into their next chat.
