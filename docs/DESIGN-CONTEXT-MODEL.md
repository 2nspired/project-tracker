# Context Model

> If the human can't see it and correct it in the surface where they'd naturally encounter it, the agent shouldn't trust it.

Pigeon is the first persistent project-knowledge tool whose data model assumes an agent is one of the users, not just an observer.

This document describes the design principles, current implementation, and planned evolution of the context model that makes that possible.

## The Shared-Surface Principle

Private agent memory rots silently because only one party reads it. A file like `STATUS.md` maintained by an agent but never opened by the human will drift from reality with no correction signal. Three copies of "current phase" across CLAUDE.md, a memory file, and STATUS.md will diverge, and nobody notices because only the agent reads the derivative sources.

Shared surfaces get corrected as a side effect of normal use. When the human and the agent both read and write to the same kanban board, stale cards get noticed and fixed during routine work. The board is the canonical example of a shared surface.

**"Shared" does not mean "everything visible by default."** It means anything persistent is inspectable. The distinction is durability plus salience, not just visibility.

### Visibility Gradient (Reserved Vocabulary)

These terms are reserved for future implementation. They describe where persistent context sits on the salience spectrum:

- **`ambient`** — auto-loaded into agent context at session start (e.g., `tracker.md` policy, `status://` resource)
- **`indexed`** — queryable but not surfaced in UI main flow (e.g., archived decisions, old handoffs)
- **`surfaced`** — appears in the board UI main flow (e.g., active cards, milestones)

The `surface` field is not implemented in Phase 1. The vocabulary is reserved so future phases can use it without naming collisions.

## Phase 1: Shared-Surface Context Foundation

The smallest intervention that proves the shared-surface principle on one high-value case: project status.

### What Shipped

**`tracker.md`** (RFC #111) — A project-scoped orientation file at repo root. YAML front matter carries machine-parsed policy (`intent_required_on`, per-column prompts); body is the agent-orientation prompt auto-loaded at session start via `briefMe`. Originally shipped as the `Project.projectPrompt` DB column in Phase 1; promoted to the file-based `tracker.md` surface in v4.0 (#126) and the column was removed in v5.0.0 (#129) to give the prompt git-versioning, review, and rollback that DB content lacked.

**`renderStatus(projectId)`** — An MCP tool that generates a STATUS.md-equivalent markdown snapshot from board data. Sections: header with last-updated and current phase, milestone checklist with card refs, per-milestone narrative from `Milestone.description`, "What's Built" from cards tagged `component`, metrics from `Card.metadata` on cards tagged `metric`, and a parking lot summary.

**`status://project/<slug>`** — An MCP resource delivering the same markdown, auto-loadable by Claude Code. This replaces STATUS.md's auto-load behavior, not just its content. The repo-side file can be deleted with nothing lost.

### Tag Conventions

- **`component`** — Marks a card whose description anchors a system-component bullet in "What's Built." Component cards can be never-closed description anchors (e.g., "Infrastructure: Mac Mini inference setup") that exist purely to hold description text.
- **`metric`** — Marks a card whose `metadata` JSON holds metrics. Shape: `{ metrics: [{ key, value, unit?, recordedAt, env? }] }`. Read by `renderStatus`.

### Web UI Exposure

Deferred to a future release. The `renderStatus` output is MCP-only for now. A dashboard widget or dedicated page rendering the same markdown is a natural v2 addition but is not abandoned.

## Phase 2: Memory Absorption + Staleness Registry

Move persistent context from scattered files into structured, queryable entries with staleness tracking.

### What Shipped

**`PersistentContextEntry` model** — Structured knowledge claims: `{ claim, rationale, application, details[], author, audience, citedFiles[], recordedAtSha, surface }`. CRUD via unified `saveFact`/`listFacts`/`getFact`/`deleteFact` tools (type: "context").

**Staleness registry** with two detection classes:
- File-cited facts: Bazel-style `recordedAtSha` comparison — if a cited file's latest commit differs from the recorded SHA, the fact is flagged stale
- Narrative facts: `age × no-human-touch` heuristic — agent-authored entries decay faster (14d possibly-stale, 30d stale) than human-authored entries (30d possibly-stale, 60d stale)

**Staleness warnings** injected at the top of `loadHandoff` and `checkOnboarding` responses as a markdown block, visible to both human and agent.

**`reviewSessionFacts`** — Removed in the knowledge consolidation pass (9→5 primitives). The end-of-session review workflow was unused. Agents should save facts directly via `saveFact` during the session.

**`surface` field** implemented with the `ambient` / `indexed` / `surfaced` gradient:
- `ambient` — auto-loaded into agent context at session start
- `indexed` — queryable but not surfaced in UI main flow (default)
- `surfaced` — appears in the board UI main flow

## Phase 3: Code Facts + FTS5 Cross-Source Search

Structured code facts and full-text search across all knowledge sources.

### What Shipped

**`CodeFact` model** — `{ path, symbol?, fact, author, recordedAtSha, needsRecheck, lastVerifiedAt }`. File-level primary, symbol-level optional. No line numbers (they rot too fast). Manual save only in v1, `needsRecheck` advisory flag auto-set when the cited file changes.

CRUD via unified `saveFact`/`listFacts`/`getFact`/`deleteFact` tools (type: "code"). Staleness integrated into the existing `checkStaleness` pipeline — code facts use file-cited staleness on their `path` field.

**FTS5 `queryKnowledge(topic)`** — Full-text search via SQLite FTS5 virtual table with Porter stemming. Searches across cards, comments, decisions, notes, handoffs, code facts, persistent context entries, and indexed repo markdown files. Returns ranked results with source references and highlighted snippets.

**`rebuildKnowledgeIndex(projectId)`** — Rebuilds the FTS5 index from all sources. Scans the project repo for `*.md` files (max depth 5, skips node_modules/dist/.git etc., caps files at 100KB). Reports indexed count by source type.

**Doc indexing** — Repo markdown files are scanned during `rebuildKnowledgeIndex` and indexed in the FTS5 virtual table alongside structured data. File SHA tracked for freshness. Content capped at 50KB per file.

## Phase 4: Measurement Facts + Multi-Agent Conflict Resolution

The hard problems that require new data models and coordination mechanisms.

### What Shipped

**`MeasurementFact` model** — `{ value: Float, unit: String, description: String, env: JSON (key-value pairs of environment dependencies), path?, symbol?, author, recordedAt, ttl?, needsRecheck }`. Separate model from CodeFact — measurements rot on environment drift, not file renames. CRUD via unified `saveFact`/`listFacts`/`getFact`/`deleteFact` tools (type: "measurement").

Three-tier staleness:
1. TTL-based: if `ttl` is set and expired, flag stale
2. Env SHA drift: if env contains a `sha`/`codeSha` key and the cited file changed, flag stale
3. Age-based fallback: same agent/human decay thresholds as context entries (14d/30d agent, 30d/60d human)

Measurements indexed in FTS5 via `rebuildKnowledgeIndex`.

**Multi-agent conflict resolution** — `version Int @default(0)` on Card, Decision, PersistentContextEntry, CodeFact for optimistic locking. `lastEditedBy String?` on Card to track which agent last modified it. Write tools (`updateCard`, `bulkUpdateCards`, `updateDecision`, `saveFact`) accept optional `version` param, check against current, increment on success. Read tools expose `version` in responses so clients can pass it back. `checkVersionConflict` utility returns clear conflict errors when versions diverge.

**Decision supersession** — `supersedes String?` and `supersededBy String?` on Decision for bidirectional ADR linking. `recordDecision` and `updateDecision` accept `supersedesId` — automatically marks old decision as superseded and links both directions. Staleness pipeline flags superseded decisions so agents don't cite outdated ADRs.

### Not Shipped (Deferred)

- **Vocabulary canonicalization / alias resolution** — stretch goal, deferred
- **Human reconciliation flow for fact conflicts** — deferred
- **Multi-user `authorId`/`audienceId`** — pilot data doesn't warrant it yet

## Known Hard Problems

These are documented now so they are not rediscovered as surprises in later phases.

### 1. Measurement Facts with Environment Dependencies

A fact like "17.5s eval latency" looks objective but depends on hardware, model build, eval code SHA, ollama version, `num_ctx` setting — none tracked as dependencies today. Measurements need a different staleness model than structural facts. Structural facts rot on rename. Measurements rot on environment drift, which nothing currently catches.

Target data model: `{ value, unit, env[], recordedAt, ttl? }` with auto-flag on env drift.

> **Addressed in Phase 4** by the `MeasurementFact` model with three-tier staleness (TTL, env SHA drift, age-based fallback).

### 2. Silently-Superseded Decisions

ADRs implicitly evolved past by later ADRs but never explicitly superseded. They still read as current because nothing signals otherwise. Needs `supersedes`/`supersededBy` links and last-seen-valid signals when an ADR is cited.

> **Addressed in Phase 4** by bidirectional `supersedes`/`supersededBy` links on Decision, with automatic staleness flagging of superseded ADRs.

### 3. Branch-Local Facts Promoted Unfairly

Memory saved during a feature branch session gets applied in post-merge sessions with wrong context, because memory is not branched. A fact like "the auth module uses middleware pattern X" may be true on the branch but false on main after a different approach merges first.

### 4. Human-Agent Feedback-Loop Errors

Shared surfaces catch disagreements between readers. They do NOT catch errors both readers share. Example: agent tells human something wrong, human writes it in a doc, next session another agent reads it as ground truth because it is in a human-touched surface.

Mitigation: facts cited to code can be auto-reverified. Facts stored as narrative require human re-reading. Two staleness classes, not one.

### 5. Trust Calibration

The strongest single signal for whether a memory is still valid is not age alone — it is `age x no-human-touch`. Human-edited content stays trustworthy longer than agent-only content. Staleness heuristics should mirror this.

## Acknowledgment

The design constraint in the opening line came from an audit conversation with an agent on a sister project. Two rounds of questions, approximately sixteen substantive answers, relayed by the human. The methodology itself — an agent on one project auditing the memory model of a tool another agent will use — is exactly the workflow this tool is trying to make easier. This is flagged as a first-class pattern for future phases.
