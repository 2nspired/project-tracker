# Implementation Plan: Note + Claim — Cutover

> Status: **Draft** · Authored 2026-04-18 · Supersedes steps 3–7 of the original ladder per RFC amendment #3

## Framing

The RFC was accepted with four amendments (see `RFC-NOTE-CLAIM-PRIMITIVES.md`), the most consequential being #3: **migration simplified to a one-shot cutover** — the seven-step dual-write ladder is over-engineered for a local-first single-user SQLite app. Steps 1–2 already shipped (Claim table + saveClaim/listClaims; Note widened). This plan collapses the remaining work (old steps 3–7) into a single coordinated cutover.

Amendment #2 binds this plan hard: **Zod validation of `metadata` / `payload` at the service boundary is required on every write.** JSON columns carry no DB-level type enforcement, so the service layer is where per-kind shape gets enforced.

Amendment #4 pulls FTS5 rebuild + ranking regression into its own card — **#100**. This plan keeps the FTS5 index populated (swap 4 legacy sources for 2 new ones in `rebuildIndex`) but leaves weight-tuning and ranking regression to #100.

## What "cutover" means

1. Legacy rows get migrated to the new tables once, atomically.
2. Every reader switches to the new tables.
3. Legacy MCP tool names (`saveFact`, `recordDecision`, `saveHandoff`, etc.) stay as thin aliases for one minor version, then get deleted in a follow-up.
4. Legacy tables are dropped from the schema.
5. FTS5 `rebuildIndex` swaps legacy sources for Note + Claim so search keeps working through the cutover.

The rollback boundary from the original plan (between step 4 and step 5) disappears — this is irreversible by design. Data is local-first, recoverable from git / manual SQL if needed, and the amendment explicitly judges the phased rollback not worth the complexity.

## Scope in / out

**In scope (this card, #86):**

- Per-kind Zod schemas for `Claim.payload` + `Claim.evidence` + `Note.metadata` at the service layer.
- New `claim-service.ts` alongside `note-service.ts`, owning validation and JSON (de)serialization.
- One-shot backfill script (`scripts/migrate-notes-claims.ts`): legacy rows → Note/Claim.
- Readers switched: `listFacts`, `getDecisions`, `listHandoffs`, `loadHandoff`, `briefMe`, `endSession`, staleness pipeline, tRPC `decision` + `handoff` routers, DecisionsSection UI, `rebuildIndex` FTS5 sources.
- Legacy MCP write tools (`saveFact`, `recordDecision`, `updateDecision`, `saveHandoff`) reduced to 5-line aliases over `saveClaim` / `saveNote`.
- Legacy Prisma models removed: `PersistentContextEntry`, `CodeFact`, `MeasurementFact`, `Decision`, `SessionHandoff`.
- `SCHEMA_VERSION` + `MCP_SERVER_VERSION` bumps.
- Unified `isStale(claim)` with a kind switch; the three per-table implementations in `src/mcp/staleness.ts` collapse.

**Out of scope (deferred, separate cards):**

- FTS5 column-weight tuning + ranking regression check → **#100** (already filed).
- Dedicated `/knowledge/:projectId` page → future card (RFC §UI Surfacing). The per-card DecisionsSection gets migrated; the aggregate knowledge page does not land here.
- Removal of the legacy-alias MCP tools → next minor version after this ships. Keeps other-agent compatibility for one release cycle.
- Activity-feed / comment / cardRelation changes — explicitly out of scope per RFC.

## Audit baseline (HEAD: 21c8424)

### Writers of legacy tables (to be aliased or rewritten)

- `src/mcp/tools/fact-tools.ts` — `saveFact` writes `PersistentContextEntry` / `CodeFact` / `MeasurementFact` depending on `type`.
- `src/mcp/tools/decision-tools.ts` — `recordDecision`, `updateDecision` write `Decision`.
- `src/lib/services/handoff.ts` + `src/mcp/tools/session-tools.ts` — `saveHandoff` writes `SessionHandoff`; `endSession` (`src/mcp/server.ts:928`) calls it.
- `src/lib/onboarding/seed-runner.ts:151,166,180` — tutorial seed writes `Decision`, `SessionHandoff`, `Note`.
- `src/server/services/decision-service.ts` + `src/server/services/handoff-service.ts` — tRPC-facing.

### Readers of legacy tables (to be switched)

- `src/mcp/tools/fact-tools.ts` `listFacts` — queries all three fact tables.
- `src/mcp/tools/decision-tools.ts` `getDecisions`.
- `src/mcp/tools/session-tools.ts` `loadHandoff`, `listHandoffs`.
- `src/mcp/server.ts:680-684` — briefMe reads latest handoff + open-proposed decisions.
- `src/mcp/staleness.ts` — separate scans of all four fact tables (lines 42/149/197/250).
- `src/mcp/tools/context-tools.ts:134` — `getMilestoneContext` reads decisions.
- `src/mcp/resources.ts:183,218` — `handoff` + `decisions` MCP resources.
- `src/mcp/fts.ts:84-183` — indexes four legacy tables + handoff.
- `src/components/board/card-detail-sheet.tsx:638-908` — DecisionsSection renders decisions on card detail.
- `src/server/api/routers/decision.ts` + `src/server/api/routers/handoff.ts`.
- `src/mcp/server.ts:525` + `src/mcp/utils.ts:66` — telemetry / feature-probe counts (cheap to update).

## Target design

### Service-boundary Zod (amendment #2)

Create `src/lib/schemas/claim-schemas.ts`:

```ts
export const CLAIM_KINDS = ["context", "code", "measurement", "decision"] as const;
export const CLAIM_STATUSES = ["active", "superseded", "retired"] as const;

export const claimEvidenceSchema = z.object({
  files:    z.array(z.string().max(500)).max(50).optional(),
  symbols:  z.array(z.string().max(200)).max(50).optional(),
  urls:     z.array(z.string().url()).max(20).optional(),
  cardIds:  z.array(z.string()).max(50).optional(),
}).strict();

// Per-kind payload schemas
export const contextPayloadSchema = z.object({
  application: z.string().max(2000).optional(),
  audience:    z.enum(["all", "agent", "human"]).optional(),
  surface:     z.enum(["ambient", "indexed", "surfaced"]).optional(),
}).strict();

export const codePayloadSchema = z.object({}).strict(); // all content in evidence

export const measurementPayloadSchema = z.object({
  value: z.number(),
  unit:  z.string().min(1).max(40),
  env:   z.record(z.string(), z.string()).default({}),
}).strict();

export const decisionPayloadSchema = z.object({
  alternatives: z.array(z.string().max(500)).max(20).default([]),
}).strict();

export const claimPayloadByKind = {
  context:     contextPayloadSchema,
  code:        codePayloadSchema,
  measurement: measurementPayloadSchema,
  decision:    decisionPayloadSchema,
} as const;
```

Extend `src/lib/schemas/note-schemas.ts` with per-kind `metadata` schemas:

```ts
export const generalMetadataSchema = z.object({}).strict();
export const handoffMetadataSchema = z.object({
  workingOn: z.array(z.string()).default([]),
  findings:  z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
  blockers:  z.array(z.string()).default([]),
}).strict();

export const noteMetadataByKind = {
  general: generalMetadataSchema,
  handoff: handoffMetadataSchema,
} as const;
```

Validation happens in the service, not the MCP tool parameter schema, so tRPC + MCP both get the same enforcement.

### `claim-service.ts`

Parallel to `note-service.ts`. Single source of truth for Claim writes/reads. Responsibilities:

- `create(input)` / `update(id, input)` — Zod-validate `evidence` with `claimEvidenceSchema` and `payload` with `claimPayloadByKind[kind]`. Serialize to JSON. Handle supersession atomically in a transaction.
- `list(projectId, filter)` — build where clause, paginate, JSON-parse on return.
- `getById(id)` — normalize.
- `listStale(projectId)` — returns claims with `isStale(claim) === true`, grouped by kind.
- `verify(id)` — bump `verifiedAt` (used by re-check flows).

`isStale(claim)` lives in `src/mcp/staleness.ts` (rename optional, keep for diff-minimization) as a single function with a `kind` switch. The three existing per-table implementations get deleted; the file shrinks.

### `note-service.ts` additions

- `metadata` gets `noteMetadataByKind[kind]` validation in `create` / `update`.
- `list(projectId, filter)` already accepts `kind` / `cardId` / `boardId` / `author` (shipped in step 2). Add a convenience `listHandoffs(boardId, limit=10)` that wraps `list(_, { kind: 'handoff', boardId })` ordered by `createdAt desc`.
- `getLatestHandoff(boardId)` returns the top row of `listHandoffs`.

### Backfill script: `scripts/migrate-notes-claims.ts`

Idempotent, runs against the existing DB. Steps:

1. Read all `SessionHandoff` rows → insert as `Note(kind='handoff')` with `metadata = { workingOn, findings, nextSteps, blockers }`, `content = summary`, `author = agentName`, `boardId = boardId`, preserve `createdAt`/`updatedAt`.
2. Read all `Decision` rows → insert as `Claim(kind='decision')` with `statement = title`, `body = decision + \n\n + rationale`, `payload = { alternatives: JSON.parse(alternatives) }`, `status` mapped (`proposed`/`accepted` → `active`, `superseded` → `superseded`, `rejected`/`deprecated` → `retired`), preserve `supersedesId` chains via second pass.
3. Read all `PersistentContextEntry` → `Claim(kind='context')` with `statement = claim`, `body = rationale + \n\n + details.join('\n')`, `payload = { application, audience, surface }`, `evidence = { files: citedFiles }`.
4. Read all `CodeFact` → `Claim(kind='code')` with `statement = fact`, `evidence = { files: [path], symbols: symbol ? [symbol] : [] }`, `recordedAtSha`, `verifiedAt`.
5. Read all `MeasurementFact` → `Claim(kind='measurement')` with `statement = description`, `payload = { value, unit, env: JSON.parse(env) }`, `evidence = { files: path ? [path] : [], symbols: symbol ? [symbol] : [] }`, `expiresAt = ttl`.
6. Write a marker row (or use `meta_settings` table if it exists) so reruns are no-ops.

The script runs once before the legacy tables are dropped. It is standalone (not part of `db:push`) so we can run-verify-run before commit.

### Legacy MCP tool aliases

Each legacy tool becomes a ~5-line handler that transforms its params and delegates to `saveClaim` / `saveNote` / the service layer:

```ts
// fact-tools.ts (after cutover)
registerExtendedTool("saveFact", {
  category: "context",
  description: "DEPRECATED — use saveClaim. Kept as alias for one minor version.",
  parameters: /* same as today */,
  handler: (params) => saveClaimAlias(mapFactToClaim(params)),
});
```

Callers keep working; deprecation warning appears in tool description. Next minor version (bumped in a follow-up PR) removes them.

### tRPC router changes

- `src/server/api/routers/decision.ts` → thin view over `claim-service` with kind=decision. Input/output shapes preserved where UI depends on them (DecisionsSection expects `{ id, title, status, decision, rationale, alternatives, ... }` — map Claim fields to that shape in the router).
- `src/server/api/routers/handoff.ts` → thin view over `note-service` with kind=handoff. `save` / `getLatest` / `list` map.
- `src/server/services/decision-service.ts` + `src/server/services/handoff-service.ts` → delete (their callers move to the new service layer).

### DecisionsSection UI

`src/components/board/card-detail-sheet.tsx:638-908` reads via `api.decision.list.useQuery`. With the tRPC router mapped to Claim, the wire shape stays identical — no UI file edit needed beyond a smoke test. **Confirmed by reading the router mapping: UI does not touch Prisma directly.**

### FTS5 sources

`src/mcp/fts.ts` `rebuildIndex` — delete sources 3 (Decision), 5 (SessionHandoff), 6 (CodeFact), 7 (PersistentContextEntry), 9 (MeasurementFact). Add:

- Source 3 (new): `Claim` rows. Title = `[${kind}] ${statement}`. Content = `body + evidence (joined) + payload (joined)`.
- Source 5 (new): `Note` rows where `kind='handoff'` — title = `Handoff by ${author} (${date})`. Content = `content + metadata.findings joined`.

Card / Comment / Doc / general Note sources stay as-is.

Ranking weights + column tuning stay in #100. This change just keeps the index populated with the new sources.

### Schema / version changes

- `prisma/schema.prisma`: drop `PersistentContextEntry`, `CodeFact`, `MeasurementFact`, `Decision`, `SessionHandoff` models + their inverse relations on `Project` / `Card` / `Board`. Run `db:push`.
- `src/mcp/utils.ts` — `SCHEMA_VERSION` 7 → 8 (five tables dropped is a major shape change).
- `src/mcp/manifest.ts` + `package.json` — `MCP_SERVER_VERSION` 2.5.0 → 2.6.0.
- Feature-detection probe at `src/mcp/utils.ts:66` — drop the `sessionHandoff` count; add `note(kind=handoff)` count.
- Telemetry probe at `src/mcp/server.ts:525` — same swap.

## Files to touch

**Create:**
- `docs/IMPL-NOTE-CLAIM-CUTOVER.md` (this file)
- `src/lib/schemas/claim-schemas.ts`
- `src/server/services/claim-service.ts`
- `scripts/migrate-notes-claims.ts`

**Modify:**
- `src/lib/schemas/note-schemas.ts` — per-kind metadata schemas
- `src/server/services/note-service.ts` — validate metadata; add `listHandoffs` / `getLatestHandoff`
- `src/mcp/tools/claim-tools.ts` — replace inline validation with Zod schemas; delegate to `claim-service`
- `src/mcp/tools/fact-tools.ts` — collapse to aliases over `saveClaim`
- `src/mcp/tools/decision-tools.ts` — collapse to aliases over `saveClaim`
- `src/mcp/tools/session-tools.ts` — `saveHandoff` / `loadHandoff` / `listHandoffs` read+write `Note(kind=handoff)` via `note-service`
- `src/mcp/tools/context-tools.ts` — `getMilestoneContext` reads from `claim-service`
- `src/mcp/tools/extended-tools.ts` — `createNote` / `updateNote` delegate to `note-service` for validation
- `src/mcp/server.ts` — briefMe, endSession, telemetry probe
- `src/mcp/resources.ts` — `handoff` + `decisions` resources read from new services
- `src/mcp/staleness.ts` — unified `isStale(claim)` with kind switch; three old functions deleted
- `src/mcp/fts.ts` — swap sources 3/5/6/7/9 for Note+Claim
- `src/mcp/utils.ts` — SCHEMA_VERSION bump + feature probe update
- `src/mcp/manifest.ts` — MCP_SERVER_VERSION bump
- `package.json` — version bump
- `src/server/api/routers/decision.ts` — read Claim; preserve wire shape
- `src/server/api/routers/handoff.ts` — read Note(kind=handoff)
- `src/lib/onboarding/seed-runner.ts` — seed writes new tables
- `prisma/schema.prisma` — drop five legacy models + inverse relations
- `README.md` — regenerated by `docs:sync`

**Delete:**
- `src/server/services/decision-service.ts`
- `src/server/services/handoff-service.ts`
- `src/lib/services/handoff.ts` (consolidated into `note-service.ts`)
- `src/lib/schemas/decision-schemas.ts` + `src/lib/schemas/handoff-schemas.ts` — replaced by claim-schemas + note metadata

## Commit plan

One concern per commit; each bisects cleanly. Ordered so the DB is always readable.

1. `docs: cutover plan for Note+Claim (#86)` — this file only.
2. `feat(schemas): per-kind Zod schemas for claim payload / evidence and note metadata (#86)` — `claim-schemas.ts` + note-schemas additions. No caller uses them yet.
3. `refactor(services): introduce claim-service backed by Zod-validated writes (#86)` — `claim-service.ts`, `note-service.ts` validation + `listHandoffs`. `saveClaim` tool rewired through the service. Callers of legacy Decision/Handoff services untouched.
4. `feat(scripts): one-shot backfill of legacy knowledge tables into Note/Claim (#86)` — `scripts/migrate-notes-claims.ts`. Runs but doesn't delete anything yet. Idempotent.
5. `feat(mcp): switch readers to Note/Claim (listFacts, getDecisions, listHandoffs, briefMe, staleness, FTS5) (#86)` — readers flip; legacy writers still populate legacy tables (dead-writes, but nothing reads them).
6. `feat(mcp): alias legacy write tools to saveClaim/saveNote; writers stop populating legacy tables (#86)` — saveFact/recordDecision/saveHandoff become 5-line aliases. Legacy tables now truly dead.
7. `feat(trpc): decision and handoff routers read from new services; UI wire shape preserved (#86)` — tRPC cutover. DecisionsSection smoke-tested.
8. `feat(db): drop legacy knowledge tables and bump schema/server versions (#86)` — schema drops + `db:push` + SCHEMA_VERSION 7→8 + MCP_SERVER_VERSION 2.5.0→2.6.0 + `docs:sync`. After this, rollback is irrecoverable without restoring the DB.

Run backfill (commit 4) between commits 4 and 5 against the live DB so the reader switch has data.

## Validation

- `npm run db:push` succeeds after commit 8; Prisma client regenerates.
- `npx tsc --noEmit` clean after each commit.
- `npx biome check` clean on touched files.
- `npm run mcp:dev` starts; `getTools()` lists both new and aliased tools.
- **End-to-end smoke** after commit 7:
  - Load the board UI; DecisionsSection on a card renders (hit the seeded tutorial decision via #1/#2/etc.).
  - `briefMe` returns handoff + open-proposed decisions (now Claims) with the same shape.
  - `queryKnowledge "note+claim"` returns at least one hit from a migrated row.
  - Create a new decision via the web UI; verify it lands in `claim` table with `kind='decision'`.
- Migration script counts: pre-cutover legacy row count == post-cutover new-row count per kind.
- Prior handoff visible in Session View after cutover.

## Rollback

Commit-level rollback is clean through commit 7 — revert + restart. After commit 8 (tables dropped), rollback requires restoring `data/tracker.db` from a pre-cutover snapshot. Take a `cp data/tracker.db data/tracker.db.pre-cutover` before running `db:push` in commit 8 as a safety net.

## Open questions for human sign-off

1. **Alias lifetime** — one minor version (2.6.x) or two? One is minimal and keeps the surface small; two gives external agents more time to migrate. Recommendation: one, with a prominent deprecation notice in the tool description and a follow-up card to remove.
2. **Backfill timing** — run before commit 5 (so readers see migrated data) or automate via a post-install hook? Manual-one-shot is simpler and easier to verify; automation would matter if other machines had this DB, which they don't (local-first, one machine).
3. **DecisionsSection wire shape** — preserve as-is (map Claim → Decision-shaped JSON in the tRPC router) or break and update UI? Preserve is lower risk for this card; break can follow in a UI-only PR once we're sure the old shape isn't load-bearing anywhere else.

My recommendation on all three: minimal surface, defer optional churn to follow-ups. Ship the cutover small.
