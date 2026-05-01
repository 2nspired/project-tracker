# Archived docs

These documents describe shipped work, completed migrations, or accepted RFCs whose subject is now part of the live system. They're kept here for historical reference — when reading old PRs, transcripts, or commit messages — but they should **not** be treated as current guidance.

For the live system, start at the project [README](../../README.md) and the [docs index](../).

## What's in here

| File | What it documents | Status |
|---|---|---|
| `IMPL-NOTE-CLAIM.md` | Implementation note for the v2.4-era Step 1 of the Note + Claim cutover. Documents the original `Claim` table addition. | Shipped |
| `IMPL-NOTE-CLAIM-STEP2.md` | Implementation note for the v2.4 → v2.5 `Note` table widening that paired with the Claim work. | Shipped |
| `IMPL-NOTE-CLAIM-CUTOVER.md` | The cutover plan that retired `PersistentContextEntry`, `CodeFact`, `MeasurementFact`, `Decision`, and `SessionHandoff` in favor of the unified `Claim` + dedicated `Handoff` tables. | Shipped (live schema; cutover doc is intermediate-era) |
| `RFC-NOTE-CLAIM-PRIMITIVES.md` | The accepted RFC that motivated the Claim primitive. | Accepted, fully implemented |
| `RFC-WORKFLOW.md` | The RFC for the workflow surface that became `tracker.md` (RFC #111). | Shipped in v5.0 — `projectPrompt` DB column dropped, `tracker.md` is the live surface |
| `MIGRATING-TO-PIGEON.md` | The v4.x → v5.0 rebrand walkthrough. | Migration window closed; v6.0 dropped the legacy alias entirely (see `../UPDATING.md`) |

If you're hitting a tool name in old transcripts or prompts that no longer resolves, check [`../MIGRATION-HISTORY.md`](../MIGRATION-HISTORY.md) instead — that's where pre-v6 tool renames live.
