# Context Model

> If the human can't see it and correct it in the surface where they'd naturally encounter it, the agent shouldn't trust it.

Project Tracker is the first persistent project-knowledge tool whose data model assumes an agent is one of the users, not just an observer.

This document describes the design principles, current implementation, and planned evolution of the context model that makes that possible.

## The Shared-Surface Principle

Private agent memory rots silently because only one party reads it. A file like `STATUS.md` maintained by an agent but never opened by the human will drift from reality with no correction signal. Three copies of "current phase" across CLAUDE.md, a memory file, and STATUS.md will diverge, and nobody notices because only the agent reads the derivative sources.

Shared surfaces get corrected as a side effect of normal use. When the human and the agent both read and write to the same kanban board, stale cards get noticed and fixed during routine work. The board is the canonical example of a shared surface.

**"Shared" does not mean "everything visible by default."** It means anything persistent is inspectable. The distinction is durability plus salience, not just visibility.

### Visibility Gradient (Reserved Vocabulary)

These terms are reserved for future implementation. They describe where persistent context sits on the salience spectrum:

- **`ambient`** — auto-loaded into agent context at session start (e.g., `projectPrompt`, `status://` resource)
- **`indexed`** — queryable but not surfaced in UI main flow (e.g., archived decisions, old handoffs)
- **`surfaced`** — appears in the board UI main flow (e.g., active cards, milestones)

The `surface` field is not implemented in Phase 1. The vocabulary is reserved so future phases can use it without naming collisions.

## Phase 1: Shared-Surface Context Foundation (Current)

The smallest intervention that proves the shared-surface principle on one high-value case: project status.

### What Shipped

**`Project.projectPrompt`** — A project-scoped orientation paragraph stored in the tracker DB and auto-loaded at session start via `checkOnboarding`. Replaces per-account `PROJECT_PROMPT.md` files so all agents share one source of truth the human can inspect and edit.

**`renderStatus(projectId)`** — An MCP tool that generates a STATUS.md-equivalent markdown snapshot from board data. Sections: header with last-updated and current phase, milestone checklist with card refs, per-milestone narrative from `Milestone.description`, "What's Built" from cards tagged `component`, metrics from `Card.metadata` on cards tagged `metric`, and a parking lot summary.

**`status://project/<slug>`** — An MCP resource delivering the same markdown, auto-loadable by Claude Code. This replaces STATUS.md's auto-load behavior, not just its content. The repo-side file can be deleted with nothing lost.

### Tag Conventions

- **`component`** — Marks a card whose description anchors a system-component bullet in "What's Built." Component cards can be never-closed description anchors (e.g., "Infrastructure: Mac Mini inference setup") that exist purely to hold description text.
- **`metric`** — Marks a card whose `metadata` JSON holds metrics. Shape: `{ metrics: [{ key, value, unit?, recordedAt, env? }] }`. Read by `renderStatus`.

### Web UI Exposure

Deferred to a future release. The `renderStatus` output is MCP-only for now. A dashboard widget or dedicated page rendering the same markdown is a natural v2 addition but is not abandoned.

## Phase 2: Memory Absorption + Staleness Registry

Move the 13-memory-file pattern into structured, queryable entries with staleness tracking.

- **`PersistentContextEntry` model** — `{ claim, rationale, application, details[], author, audience, citedFiles[], recordedAtSha, surface }`
- **Staleness registry** split into two classes:
  - File-cited facts: Bazel-style `recordedAtSha` comparison (did the cited file change?)
  - Narrative facts: `age x no-human-touch` heuristic (human-edited content stays trustworthy longer than agent-only content)
- **Staleness warnings** injected at top of `loadHandoff` / `checkOnboarding` responses
- **End-of-session review tool** — candidate facts from this session, confirm/edit/drop each. Creates the missing ritual for negative findings, successful recipes, and self-calibration notes
- **`surface` field** implemented with the `ambient` / `indexed` / `surfaced` gradient

## Phase 3: Code Facts + FTS5 Cross-Source Search

Structured code facts and full-text search across all knowledge sources.

- **`CodeFact` model** — `{ path, symbol?, fact, author, recordedAtSha, createdAt, lastVerifiedAt }`. File-level primary, symbol-level optional. No line numbers (they rot too fast). Manual save only in v1, `needs_recheck` advisory flag.
- **FTS5 `queryKnowledge(topic)`** across cards, comments, decisions, notes, handoffs, code facts, and indexed repo markdown files
- **Doc indexing** — scan project repo for `*.md`, store in FTS5 virtual table

## Phase 4: Measurement Facts + Multi-Agent Conflict Resolution

The hard problems that require new data models and coordination mechanisms.

- **Measurement facts** with environment dependencies and auto-staleness detection
- **Multi-agent conflict resolution** — write races, vocabulary canonicalization, fact conflicts
- **Multi-user `authorId`/`audienceId`** — structural attribution, only if pilot data warrants it

## Known Hard Problems

These are documented now so they are not rediscovered as surprises in later phases.

### 1. Measurement Facts with Environment Dependencies

A fact like "17.5s eval latency" looks objective but depends on hardware, model build, eval code SHA, ollama version, `num_ctx` setting — none tracked as dependencies today. Measurements need a different staleness model than structural facts. Structural facts rot on rename. Measurements rot on environment drift, which nothing currently catches.

Target data model: `{ value, unit, env[], recordedAt, ttl? }` with auto-flag on env drift.

### 2. Silently-Superseded Decisions

ADRs implicitly evolved past by later ADRs but never explicitly superseded. They still read as current because nothing signals otherwise. Needs `supersedes`/`supersededBy` links and last-seen-valid signals when an ADR is cited.

### 3. Branch-Local Facts Promoted Unfairly

Memory saved during a feature branch session gets applied in post-merge sessions with wrong context, because memory is not branched. A fact like "the auth module uses middleware pattern X" may be true on the branch but false on main after a different approach merges first.

### 4. Human-Agent Feedback-Loop Errors

Shared surfaces catch disagreements between readers. They do NOT catch errors both readers share. Example: agent tells human something wrong, human writes it in a doc, next session another agent reads it as ground truth because it is in a human-touched surface.

Mitigation: facts cited to code can be auto-reverified. Facts stored as narrative require human re-reading. Two staleness classes, not one.

### 5. Trust Calibration

The strongest single signal for whether a memory is still valid is not age alone — it is `age x no-human-touch`. Human-edited content stays trustworthy longer than agent-only content. Staleness heuristics should mirror this.

## Acknowledgment

The design constraint in the opening line came from an audit conversation with an agent on a sister project. Two rounds of questions, approximately sixteen substantive answers, relayed by the human. The methodology itself — an agent on one project auditing the memory model of a tool another agent will use — is exactly the workflow this tool is trying to make easier. This is flagged as a first-class pattern for future phases.
