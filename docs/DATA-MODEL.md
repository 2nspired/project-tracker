# Data Model

A narrative tour of `prisma/schema.prisma`. As of v6.2.1 the schema has 18 Prisma-managed models grouped into four domains, plus one virtual table (`knowledge_fts`) that lives outside Prisma's view.

If a model isn't here, it doesn't exist. That sounds obvious, but: there's no `Decision` table — decisions are `Claim` rows with `kind = 'decision'`. There's no `Session` or `SessionFingerprint` table — sessions are referenced by ID columns on `TokenUsageEvent` and `ToolCallLog` but aren't first-class entities. There's no `Fact` table — facts collapsed into `Claim` during the v2.4 cutover (see [`archive/IMPL-NOTE-CLAIM-CUTOVER.md`](archive/IMPL-NOTE-CLAIM-CUTOVER.md)).

## At a glance

```mermaid
flowchart TD
    subgraph BoardDomain["Board domain (kanban + activity)"]
        Project --> Board
        Project --> Tag
        Project --> Milestone
        Board --> Column
        Column --> Card
        Card --> ChecklistItem
        Card --> Comment
        Card --> Activity
        Card --> CardTag
        Tag --> CardTag
        Card --> CardRelation
        Card --> GitLink
        Card --> Milestone
        Board --> Handoff
        Project --> Handoff
    end

    subgraph KnowledgeDomain["Knowledge domain"]
        Project --> Note
        Project --> Claim
        Card --> Note
        Card --> Claim
        Board --> Note
        FTS["knowledge_fts<br/>(virtual, FTS5)"]
        Note -.indexed.-> FTS
        Claim -.indexed.-> FTS
        Card -.indexed.-> FTS
        Comment -.indexed.-> FTS
    end

    subgraph TokenDomain["Token + tool tracking"]
        Project --> TokenUsageEvent
        Card --> TokenUsageEvent
        Project --> ToolCallLog
        TokenUsageEvent
        ToolCallLog
    end

    subgraph SystemDomain["System"]
        AppSettings
    end
```

## Board domain

The kanban substrate. Owns Project → Board → Column → Card and the activity / metadata around cards.

| Model | Role | Most-touched fields | Service file |
|---|---|---|---|
| `Project` | Top-level workspace; one per repo | `slug`, `repoPath`, `defaultBoardId`, `nextCardNumber`, `metadata` (JSON) | `src/server/services/project-service.ts` |
| `Board` | A kanban view inside a project | `staleInProgressDays`, `projectId` | `src/server/services/board-service.ts` |
| `Column` | Vertical lane; carries the role | `role` (`backlog`/`todo`/`active`/`review`/`done`/`parking`), `position`, `isParking` | `src/server/services/column-service.ts` |
| `Card` | Unit of work | `number` (project-scoped), `priority`, `createdBy`, `position`, `completedAt`, `metadata` (agent JSON) | `src/lib/services/` (writes) + `src/server/services/card-service.ts` |
| `ChecklistItem` | Sub-card todo | `cardId`, `completed`, `position` | `src/server/services/checklist-service.ts` |
| `Comment` | Card-scoped narrative | `authorType` (`HUMAN`/`AGENT`), `content` | `src/server/services/comment-service.ts` |
| `Activity` | Append-only audit log | `action`, `intent`, `actorType` | `src/server/services/activity-service.ts` |
| `CardTag` | Many-to-many junction | composite PK `(cardId, tagId)` | inline in tag service |
| `Tag` | Project-scoped label | `slug` (immutable), `label` (mutable), `state` | `src/lib/services/tag.ts` (factory) + `src/server/services/tag-service.ts` |
| `Milestone` | Card grouping with target date | `targetDate`, `state`, `position` | `src/lib/services/milestone.ts` + `src/server/services/milestone-service.ts` |
| `CardRelation` | `blocks` / `related` / `parent` between cards | composite uniqueness `(fromCardId, toCardId, type)` | `src/lib/services/relations.ts` + `src/server/services/relation-service.ts` |
| `GitLink` | Commit ↔ card binding | `commitHash`, `commitDate`, `filePaths` (JSON array) | `src/mcp/git-sync.ts` (writer) + `src/server/services/commit-summary-service.ts` (reader) |
| `Handoff` | Append-only session continuity | `agentName`, `summary`, `workingOn`/`findings`/`nextSteps`/`blockers` (JSON arrays) | `src/lib/services/handoff.ts` + `src/server/services/handoff-service.ts` |

### Things to know

- **`Card.number`.** Project-scoped, allocated via `Project.nextCardNumber`. The `(projectId, number)` unique index (`schema.prisma:164`) is the human-facing reference (`#212`).
- **`Card.completedAt`.** Set when the card enters a Done-role column, cleared when it leaves. Backs the Done-column sort so transactional `position` rewrites don't reshuffle (`schema.prisma:146-148`).
- **`Activity.intent`.** Required on agent moves and deletes per `tracker.md` policy. The board UI surfaces it on the activity strip — see [`AGENT-GUIDE.md`](AGENT-GUIDE.md) for the writer-side contract.
- **`Handoff` extracted from `Note` in v6.0.** Pre-#179 handoffs lived as `Note(kind="handoff")`. The migration script is `scripts/migrate-handoffs-from-notes.ts` and the rationale is in the model header (`schema.prisma:268-272`).

## Knowledge domain

The unified narrative + structured-knowledge primitives. Two physical tables (`Note`, `Claim`) plus one virtual FTS5 index over both.

| Model | Role | Kinds / shapes |
|---|---|---|
| `Note` | Loose markdown — agent context, ad-hoc capture | `kind` defaults to `"general"`; can be project-, board-, or card-scoped |
| `Claim` | Structured assertion with kind-specific payload | `kind ∈ { context, code, measurement, decision }` (`src/lib/schemas/claim-schemas.ts:3`) |

### Why one Claim table for four kinds

The cutover (v2.4 → v2.5, archived in [`archive/IMPL-NOTE-CLAIM-CUTOVER.md`](archive/IMPL-NOTE-CLAIM-CUTOVER.md)) collapsed `PersistentContextEntry`, `CodeFact`, `MeasurementFact`, and `Decision` into one `Claim` table with a `kind` discriminator and a JSON `payload` validated by Zod at the service boundary. The kind-specific schemas live in `src/lib/schemas/claim-schemas.ts` (`contextPayloadSchema`, `codePayloadSchema`, `measurementPayloadSchema`, `decisionPayloadSchema`). Existing tRPC consumers still see a Decision-shaped surface via the legacy adapter at `src/server/services/decision-service.ts:8-13`.

Service file: `src/lib/services/claim.ts` — factory pattern (`createClaimService(db)`) so both processes can construct against their own `PrismaClient` without crossing the boundary.

### `knowledge_fts` virtual table

Outside Prisma's view, lives in SQLite as an FTS5 virtual table created by `src/server/fts/index.ts:78-82` (`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(...)`). It indexes Note + Handoff + Claim + Card + Comment + repo markdown (column-weight policy at `src/server/fts/index.ts:10-28`).

Because the table lives outside `prisma/schema.prisma`, Prisma sees it as drift and would refuse `db push`. The `service:update` script drops it (and its 5 shadow tables) before pushing schema; the FTS extension at `src/server/fts/extension.ts` rehydrates it lazily on first knowledge search per project. Operator guidance: [`UPDATING.md`](UPDATING.md) §"What `service:update` does."

## Token + tool tracking domain

Two append-only tables that back the Costs page and the Pigeon Overhead chip. Both carry `projectId` so per-project rollups don't need joins. Both grew the `signal` / `projectId` columns through specific cards (citations below).

| Model | Role | Key columns |
|---|---|---|
| `TokenUsageEvent` | Per-session-per-model token usage | `(sessionId, model)` keying, 5-column token split (`input`, `output`, `cacheRead`, `cacheCreation1h`, `cacheCreation5m`), `signal` + `signalConfidence` (#268-#269), `cardId` (nullable) |
| `ToolCallLog` | Per-MCP-tool-call audit row | `toolName`, `toolType`, `sessionId`, `projectId` (nullable, post-#277), `durationMs`, `success`, `responseTokens` |

### `TokenUsageEvent.signal`

Added in #269 to surface which Attribution Engine tier produced the row's `cardId`. Values are `'explicit' | 'single-in-progress' | 'session-recent-touch' | 'session-commit' | 'unattributed'` (verified against `src/lib/services/attribution.ts:36-41` and `prisma/schema.prisma:441`). Nullable for pre-#269 rows; #270 (deferred) would backfill them.

The 5-column token split (`schema.prisma:431-435`) preserves Anthropic's pricing fidelity (1h cache create ≈ 2× input, 5m ≈ 1.25× input). Lumping would break later when the user changes pricing. OpenAI sessions store `0` for the cacheCreation columns.

Full subsystem treatment: [`ATTRIBUTION-ENGINE.md`](ATTRIBUTION-ENGINE.md).

### `ToolCallLog.projectId`

Added in #277 (`prisma/schema.prisma:374-385` carries the rationale). Pre-#277 rows have `NULL`; the bridge through `TokenUsageEvent` collapsed to `[]` when the Stop hook didn't fire, zeroing the project's overhead even when MCP traffic was real. Stamping `projectId` directly at write time fixed the silent-zero failure mode.

Backfill: `scripts/backfill-tool-call-log-projectid.ts` fills NULL rows best-effort by joining on `sessionId` to `TokenUsageEvent`. Rows whose sessions never emitted a `TokenUsageEvent` stay NULL by design — they're still visible to `getToolUsageStats` (global) but excluded from project-scoped overhead aggregations.

## System domain

| Model | Role |
|---|---|
| `AppSettings` | Singleton row (`id = "singleton"`) holding token-pricing overrides as JSON. Read via `resolvePricing()`; fail-soft to `DEFAULT_PRICING` on parse error. |

That's the whole system table set. Doctor reports, version markers, and upgrade reports don't live in the DB — they're filesystem state read by `src/lib/upgrade-report.ts` and `scripts/doctor.ts`.

## Cross-cutting conventions

- **`@map("snake_case")`.** Every Prisma column maps to a `snake_case` SQL column even though the Prisma field is `camelCase`. Source-of-truth: `schema.prisma`. If you're writing raw SQL, use the snake form (e.g. `signal_confidence`, not `signalConfidence`).
- **`metadata` JSON columns.** `Project.metadata` and `Card.metadata` are agent-writable JSON blobs that don't render in the UI. They carry agent context (e.g. `tokenBaseline` on the project, scratch state on the card). Don't add new top-level columns when an existing `metadata` field would do.
- **Cascade discipline.** Cascading deletes on `projectId` propagate to most child tables. The exception is `Note` — `onDelete: SetNull` so orphaned notes survive a project delete (`schema.prisma:254-256`). That's intentional: an agent's notes-about-a-thing shouldn't vanish with the thing.
- **No FK enforcement on `Claim.supersedesId` / `supersededById`.** Plain string IDs by convention (`schema.prisma:354-356`). Cross-linking is enforced in the tool handler — see `src/lib/services/claim.ts` for how.

## Where the schema is going

- **#270** — historical backfill of `signal` for pre-#269 `TokenUsageEvent` rows. Deferred until #213's UX validates the engine.
- **#272** — populates `sessionTouchedCards` and `sessionCommits` for the Attribution Engine's tail signals (3 + 4). Currently both are stubbed to `[]` (`src/lib/services/attribution-snapshot.ts:36-37`).
- The FTS path (`src/server/fts/`) and `buildBriefPayload` are still shared via cross-process imports — last 5 grandfathered violations on the boundary lint baseline. Slated for v6.3.
