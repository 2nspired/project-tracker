---
description: Plan a card — load context + tracker.md policy + investigation hints, then draft a four-section plan (Why now / Plan / Out of scope / Acceptance) and publish it to the card on user confirmation.
---

Call the `planCard` MCP tool for the card the user asked you to plan.

```
planCard({ boardId, cardId: "#N" })
```

`boardId` is auto-detected from the current git repo. Pass `intent` (≤120 chars) when the planning has a specific trigger you want stamped on the activity strip.

The response gives you:

- **`card`** — full card context (title, description, comments, relations, decisions, commits).
- **`policy`** — the project's tracker.md (body prompt, per-column prompts, intent rules). Honor it.
- **`investigation_hints`** — URLs, file paths, `#nnn` card refs, and likely code symbols extracted from the description. Treat these as your "start here" list.
- **`protocol`** — the structured prompt you follow. Walk it in order.
- **`_warnings[]`** — surface to the user. If it includes `PLAN_EXISTS`, the card already has a plan — don't overwrite without asking.

## How to use the response

1. **Investigate.** Read the card description, then resolve the `investigation_hints` — `Read` files, `WebFetch` URLs when relevant, `getCardContext` for related cards. Don't guess.
2. **Synthesize.** Draft a plan with the four locked headings, in order:
   - `## Why now`
   - `## Plan`
   - `## Out of scope`
   - `## Acceptance`
3. **Propose in chat first.** Show the user the plan. Don't write to the card yet — chat is draft, card is publish.
4. **On user confirmation:**
   - `updateCard({ cardId: "#N", description: "<full plan markdown>" })` — replaces the description with the published plan.
   - `moveCard({ cardId: "#N", columnName: "In Progress", intent: "<why starting now>" })` — only if you're starting work this session.

## When `PLAN_EXISTS` is in `_warnings`

The description already contains the locked headers (`## Why now` / `## Plan` / `## Acceptance`). The tool refuses to overwrite. Surface the warning to the user and ask whether to revise the existing plan or start fresh — if fresh, edit the description to remove the headers first, then re-call `planCard`.
