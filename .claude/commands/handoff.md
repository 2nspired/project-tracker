---
description: Wrap up the current Pigeon session — save a handoff, link commits, report touched cards, and emit a resume prompt for the next chat.
---

Call the `endSession` MCP tool to close out this conversation cleanly.

Before calling it:

1. **Move any finished cards.** If work is done, call `moveCard({ cardId, columnName: "Done", intent })`. The handoff is about *what changed* — card positions should already match reality.
2. **Leave blockers on cards that need the human.** Use `addComment` if something specific needs to be seen on a card (not dumped into the generic handoff blockers list).

Then call:

```
endSession({
  summary: "<one paragraph — what this session accomplished>",
  workingOn: ["<card refs or topics you touched>"],
  findings: ["<non-obvious discoveries worth carrying forward>"],
  nextSteps: ["<concrete first actions for the next agent>"],
  blockers: ["<anything waiting on a human or external change>"]
})
```

`boardId` is auto-detected from the current git repo. `syncGit` defaults to true — new commits referencing `#N` get linked automatically.

After the tool returns, hand the `resumePrompt` string to the user so they can paste it into their next chat.
