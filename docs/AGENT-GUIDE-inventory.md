# AGENTS.md disposition inventory (#164)

Audit of every section in `AGENTS.md` (~417 lines) against `docs/SURFACES.md`'s authority boundary, classifying which content belongs in the new project-agnostic `docs/AGENT-GUIDE.md` vs. which stays in `AGENTS.md` (contributor reference for people working *on* Pigeon) vs. which gets duplicated/cross-linked.

`AGENTS.md` mixes two audiences. This inventory is the surgical map for the split done in card #164:

- **universal** — moves into `docs/AGENT-GUIDE.md`. Project-agnostic; helps anyone *using* Pigeon from any repo.
- **project-only** — stays in `AGENTS.md`. Internals, Pigeon-specific governance, migration history, code-author reference.
- **both** — disposition explicitly chosen below (duplicate, cross-link, or leave in `AGENTS.md` only).

| Heading | Disposition | Notes |
|---|---|---|
| Preamble (north-star quote + tracker.md authority callout + SURFACES.md link) | both → cross-link | The north-star line ("if the human can't see it…") opens the new guide verbatim. The tracker.md authority callout stays in `AGENTS.md` because it scopes contributor reading; the new guide instead links to `tracker.md` as runtime policy. |
| Live tag + milestone API | project-only | Internal taxonomy/governance API surface (slugs, label rules, governance hints). Adopting projects don't need this to use Pigeon; `createTag` etc. are extended tools they discover via `getTools`. |
| Project orientation — `tracker.md` | both → cross-link only | Universal concept (project policy via `tracker.md`) but the deep-dive (front-matter schema, prompt wiring) is Pigeon-internal. New guide mentions `tracker.md` as the project policy file and links here. |
| Intent on Writes | universal | The single most adoption-relevant rule. Move verbatim (with light copy edits) to the new guide. |
| Project Status (`renderStatus`) | project-only | Specific Pigeon tool + STATUS.md replacement workflow. Out of scope for the universal guide. |
| Tag Conventions (flat tags, type/area, reserved slugs, governance hints, deleteTag contract) | project-only | Pigeon-internal taxonomy decisions. Adopting projects benefit from defaults; they don't need the rationale upfront. |
| Milestones (release vs. theme shapes, governance, archival) | project-only | Same: internal governance. The universal guide just notes "milestones group cards" in passing. |
| Claims / Facts (Unified Knowledge Store) | project-only | Internal knowledge model + tool migration aliases. Extended-tools-tier detail. |
| Commit Summaries (`getCommitSummary`) | project-only | Specific tool reference; fits in `getTools` discovery. |
| Last-Write-Wins (concurrency note + `lastEditedBy`) | project-only | Implementation invariant. Universal guide would say "the board last-write-wins" if anywhere; not adoption-critical. |
| Decision Supersession | project-only | Specific tool semantics for `recordDecision({ supersedesId })`. |
| Knowledge Search (`queryKnowledge`) | project-only | Specific extended tool. |
| Column Definitions (Backlog top-3 = pinned, In Progress limit, Review/Done semantics, Parking Lot, removed-Up-Next note) | universal | Core column conventions every using-Pigeon agent needs. Move; drop the historical migration footnotes (#97, #174 — those stay in `AGENTS.md`). |
| When to Use the Board | universal | Session lifecycle (briefMe at start, addComment for decisions, saveHandoff at end). Move. |
| Planning a Card (`planCard` four-section protocol) | universal | The four locked headings + draft/publish workflow apply to every project that runs `planCard`. Move. |
| When NOT to Use the Board | universal | Negative-space guidance is high-signal for adoption. Move. |
| What Goes Where (information-routing table) | universal | Simple table is broadly useful. Move. |
| Linking Commits to Cards | both → cross-link | Universal idea: reference `#N` in commits. The `syncGitActivity` tool name is Pigeon-internal; the universal guide says "reference `#N` in your commits — Pigeon links them automatically" without naming the tool. Detailed flow stays in `AGENTS.md`. |
| Efficiency Tips (token-saving `getBoard` flags, bulk tools, `#N` refs, board health) | universal (subset) | The high-leverage tips (`getBoard summary`, `bulkCreateCards`, `#N` refs, "don't call getBoard repeatedly") move. The board-health subsection (`auditBoard`, `_governanceHints` semantics) stays in `AGENTS.md`. |
| Connecting to a Project (connect.sh + AGENT_NAME resolution) | project-only | Pigeon-side install procedure. The new guide is *for* an already-connected project; `scripts/connect.sh` output points to it. |
| `## Project Tracking` snippet (the verbose copy-paste block) | universal → replaced | This is exactly what we're extracting. The snippet at the bottom of `AGENTS.md` becomes a 3-line preamble + link to `docs/AGENT-GUIDE.md` per the plan. |
| Token Tracking (#96) — Stop hooks, Codex flow, pricing | project-only | Pigeon-specific subsystem. Adopting projects who care will follow a link. |

## Cross-cutting decisions

- **Front-matter.** The new guide carries `schema_version: 1` so future format changes are versioned the same way `tracker.md` is.
- **North-star line.** Opens the new guide verbatim: *if the human can't see it and correct it where they'd naturally encounter it, the agent shouldn't trust it.* Sets the tone before any prescriptive rules.
- **No duplication of governance internals.** Anything that names extended tools by name (e.g., `auditBoard`, `mergeTags`, `recordDecision`) stays in `AGENTS.md`. The universal guide names only the 10 essentials.
- **Snippet trim.** `AGENTS.md`'s "## Project Tracking" block becomes a 3-line preamble pointing to `docs/AGENT-GUIDE.md` and `tracker://server/agent-guide`.
