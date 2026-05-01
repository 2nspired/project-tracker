# Implementation Plan: Note + Claim — Step 1

> Status: **Shipped (with amendments)** · Authored 2026-04-16 · Amended 2026-04-17

## Amendment (2026-04-17)

`AgentScratch` was removed end-to-end in **#98** — it had 0 rows across all boards and the feature was empirically dead. References below to `AgentScratch` / `kind=scratch` are historical. The final mapping is **6-into-2**, not 7-into-2. See RFC amendments for details.

## Scope of this plan

**Only step 1 of the RFC migration.** Add the `Claim` Prisma model and its
two tool entry points (`saveClaim`, `listClaims`) as an **opt-in parallel
write surface**. Nothing else changes: old tools keep writing to old tables,
old readers keep reading old tables, UI is untouched.

This is the narrow slice with the largest rollback boundary — if we abandon
the migration after this step, the cost is a single unused table and two
dead tools.

Explicitly **not** in this step (all covered by cards #77 downstream or by
subsequent migration steps):

- `Note` unification — the existing `Note` table keeps its current shape
  (step 2, card #78).
- Dual-write from `saveFact` / `recordDecision` / `saveHandoff` / etc. into
  `Claim`. The existing surfaces stay silent on `Claim` for now.
- Any read path from `Claim`. `listFacts`, `getDecisions`,
  `queryKnowledge`, briefMe, UI — none of them know `Claim` exists.
- Staleness policy on `Claim.kind`. The unified `isStale(claim)` function
  lands with step 4 cutover.
- Deleting or aliasing any existing tool. They all stay as-is.

## Audit — what exists today

### Knowledge tables in `prisma/schema.prisma`

Seven tables, as described in the RFC §Problem table:

| Table                     | Relation to `Project` | Status post-migration |
|---------------------------|-----------------------|-----------------------|
| `PersistentContextEntry`  | yes                   | → `Claim` kind=context     |
| `CodeFact`                | yes                   | → `Claim` kind=code        |
| `MeasurementFact`         | yes                   | → `Claim` kind=measurement |
| `Decision`                | yes                   | → `Claim` kind=decision    |
| `SessionHandoff`          | via `Board`           | → `Note` kind=handoff      |
| `AgentScratch`            | via `Board`           | → `Note` kind=scratch      |
| `Note`                    | yes (nullable)        | → `Note` kind=general      |

Step 1 only touches column 3 for the **first four** rows (the `Claim`
side). The Note side is untouched.

### Knowledge tools in `src/mcp/tools/`

Files relevant to this migration (each continues working unchanged
through step 1):

- `fact-tools.ts` — `saveFact` / `listFacts` (spans context / code /
  measurement via a `type` param; writes to the three legacy tables)
- `decision-tools.ts` — `recordDecision` / `getDecisions` / `updateDecision`
- `session-tools.ts` — handoff / scratch tools (not touched in step 1)
- `knowledge-tools.ts` — FTS5 query (`queryKnowledge`) — not touched
- `context-tools.ts` — card/milestone/tag context composers — not touched

### Tool registration conventions (observed, not invented)

All live in `registerExtendedTool(name, { category, description, parameters, annotations?, handler })`
(`src/mcp/tool-registry.ts:41`). Handlers wrap in `safeExecute` and return
either `ok(data)` or `err(msg, hint)` / `errWithToolHint(...)`. Agent
identity comes from the `AGENT_NAME` env (`src/mcp/utils.ts:5`).
Descriptions get regenerated into doc tables via `npm run docs:sync` — so
any tool we register in step 1 shows up in `README.md` automatically and
we don't hand-edit the table.

**Category for the new tools:** `context` (matches where `saveFact` lives
today — `listClaims` will eventually *replace* `listFacts`, so it belongs
in the same bucket).

## Target — the `Claim` Prisma model

Shape exactly matches RFC §The Two Primitives. SQLite-friendly JSON stored
as `String` (same convention as `tags`, `citedFiles`, `alternatives`
throughout the existing schema).

```prisma
model Claim {
  id             String    @id @default(uuid())
  projectId      String    @map("project_id")
  kind           String                          // 'context' | 'code' | 'measurement' | 'decision'
  statement      String                          // one-sentence assertion (list-row display)
  body           String    @default("")          // markdown elaboration
  evidence       String    @default("{}")        // JSON: { files?, symbols?, urls?, cardIds? }
  payload        String    @default("{}")        // JSON: kind-specific structured data
  author         String    @default("AGENT")     // AGENT_NAME or HUMAN
  cardId         String?   @map("card_id")
  status         String    @default("active")    // 'active' | 'superseded' | 'retired'
  supersedesId   String?   @map("supersedes_id")
  supersededById String?   @map("superseded_by_id")
  recordedAtSha  String?   @map("recorded_at_sha")
  verifiedAt     DateTime? @map("verified_at")
  expiresAt      DateTime? @map("expires_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  project      Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  card         Card?   @relation(fields: [cardId],    references: [id], onDelete: SetNull)
  supersedes   Claim?  @relation("ClaimSupersedes", fields: [supersedesId],   references: [id], onDelete: SetNull)
  supersededBy Claim?  @relation("ClaimSupersedes", fields: [supersededById], references: [id], onDelete: SetNull)

  @@index([projectId])
  @@index([projectId, kind])
  @@index([projectId, status])
  @@index([cardId])
  @@index([kind, status])
  @@index([updatedAt])
  @@map("claim")
}
```

On `Project`, `Card`: add the inverse relations (`claims Claim[]`) so
cascade/SetNull semantics work. No other models change.

**Notes on field choices:**

- `status` is on the row, not in `payload`, because it drives list filters
  for every kind (RFC §Staleness).
- `supersedesId` + `supersededById` are on the row for the same reason:
  supersession is not decision-specific, any kind can be superseded
  (re-verified measurement replaces an old one, etc.).
- `evidence` and `payload` are both JSON blobs to keep the schema one
  table. Agents assemble them at write time per RFC §Per-kind payload /
  §Per-kind metadata.
- No `needsRecheck` column. `verifiedAt` + `recordedAtSha` + `expiresAt`
  replace it — the unified `isStale()` (step 4) computes stale state from
  these three fields. We don't need it in step 1 because no reader looks
  at `Claim` yet.
- No `surface` / `audience` column — those stay in `payload` for
  `kind=context` because only that kind branches on them.

### Indexes

Six indexes, chosen for the reads step 4 will need (not step 1 — agents
won't read `Claim` until cutover, so indexes are future-looking). Ordering
reflects observed query shapes in the existing `listFacts`:

- `[projectId]` — baseline scope
- `[projectId, kind]` — kind-filtered list per project (the common case)
- `[projectId, status]` — active-only lists
- `[cardId]` — card detail sheet claim section
- `[kind, status]` — cross-project stale scans (rare, cheap index)
- `[updatedAt]` — "recent claims" timeline

## Target — the new tools

Both registered in a new file `src/mcp/tools/claim-tools.ts` (parallel to
`fact-tools.ts` / `decision-tools.ts` — keeps the naming clean and makes
it a single delete when the step 7 cleanup lands).

### `saveClaim`

```ts
registerExtendedTool("saveClaim", {
  category: "context",
  description: `Create or update a Claim — a typed assertion with evidence.
Pass claimId to update. This is the RFC v2 replacement for saveFact/recordDecision.
Old tools still work; use saveClaim for new writes.

Kinds:
- context: project-level knowledge claim (payload: { application, audience, surface })
- code: assertion about a file/symbol (evidence.files/symbols required)
- measurement: numeric value (payload: { value, unit, env })
- decision: architectural decision (payload: { alternatives })`,
  parameters: z.object({
    projectId: z.string().describe("Project UUID"),
    kind: z.enum(["context", "code", "measurement", "decision"]),
    statement: z.string().min(1).describe("One-sentence assertion (shown in lists)"),
    body: z.string().default("").describe("Markdown elaboration"),
    evidence: z.object({
      files:    z.array(z.string()).optional(),
      symbols:  z.array(z.string()).optional(),
      urls:     z.array(z.string()).optional(),
      cardIds:  z.array(z.string()).optional(),
    }).default({}).describe("Citations — files, symbols, urls, cardIds"),
    payload: z.record(z.string(), z.unknown()).default({}).describe("Kind-specific structured data — see description"),
    author: z.string().default("AGENT").describe("AGENT_NAME or HUMAN"),
    cardId: z.string().optional().describe("Card UUID or #number — optional anchor"),
    status: z.enum(["active", "superseded", "retired"]).default("active"),
    supersedesId: z.string().optional().describe("Claim UUID this one replaces — old claim marked superseded and cross-linked"),
    recordedAtSha: z.string().optional().describe("Git SHA at record time (code/measurement)"),
    verifiedAt: z.string().optional().describe("ISO datetime — defaults to now on create"),
    expiresAt: z.string().optional().describe("ISO datetime — TTL (measurement)"),
    claimId: z.string().optional().describe("Claim UUID — pass to update"),
  }),
  handler: /* see below */
});
```

Handler logic (pseudocode):

1. `safeExecute` wrapper.
2. Verify project exists — `errWithToolHint("Project not found.", "listProjects", {})` if not.
3. If `cardId` is `#N` form, resolve via `resolveCardRef(cardRef, projectId)` and fail with `err(resolved.message)` on miss.
4. Validate per-kind payload/evidence minimums:
   - `code`: `evidence.files?.length > 0 || evidence.symbols?.length > 0` — else `err("code claims need at least one evidence.files[] or evidence.symbols[]")`.
   - `measurement`: `payload.value` is number and `payload.unit` is non-empty string — else `err(...)`.
   - `context` / `decision`: no payload validation in step 1 (agents may pass the RFC-defined keys or omit them; we don't reject missing-but-recommended fields).
5. Serialize `evidence` and `payload` to JSON strings.
6. Create or update:
   - If `claimId` provided: `findUnique` → if missing, `err("Claim not found.")`. Else `db.claim.update(...)`.
   - Else: `db.claim.create(...)` with `verifiedAt: verifiedAt ?? new Date()`.
7. If `supersedesId` set: load old claim, if missing → `err(...)`, else in a `db.$transaction` mark old `status="superseded"`, `supersededById=new.id`, and the new record already carries `supersedesId`. (Mirrors `recordDecision` supersedes logic.)
8. Return `ok(normalizeClaim(record))` where `normalizeClaim` parses `evidence`/`payload` back to objects before returning.

### `listClaims`

```ts
registerExtendedTool("listClaims", {
  category: "context",
  description: "List claims for a project. Omit kind to list all kinds. Pass claimId for single-claim lookup.",
  parameters: z.object({
    projectId: z.string().describe("Project UUID"),
    claimId: z.string().optional().describe("Fetch a single claim by UUID"),
    kind: z.enum(["context", "code", "measurement", "decision"]).optional(),
    cardId: z.string().optional().describe("Filter by card UUID or #number"),
    status: z.enum(["active", "superseded", "retired"]).optional(),
    author: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  annotations: { readOnlyHint: true },
  handler: /* see below */
});
```

Handler: standard `safeExecute`. If `claimId` provided, single lookup and
return `[normalizeClaim(row)]` or not-found error. Otherwise build the
`where` object from filters, resolve `cardId` via `resolveCardRef` if
#N form, `findMany` with `orderBy: { updatedAt: "desc" }`, return
`{ claims: [...], total: N }`.

Normalizer (private, file-local):

```ts
function normalizeClaim(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    statement: row.statement,
    body: row.body,
    evidence: JSON.parse(row.evidence) as ClaimEvidence,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    author: row.author,
    cardId: row.cardId,
    status: row.status,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    recordedAtSha: row.recordedAtSha,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

## Files to touch (complete list)

Create:
- `docs/IMPL-NOTE-CLAIM.md` (this file)
- `src/mcp/tools/claim-tools.ts`

Modify:
- `prisma/schema.prisma` — add `Claim` model + inverse relations on `Project` and `Card`
- `src/mcp/server.ts` — add `import "./tools/claim-tools.js";` alongside existing tool imports
- `src/mcp/utils.ts` — bump `SCHEMA_VERSION` 5 → 6 (schema change)
- `src/mcp/manifest.ts` — bump `MCP_SERVER_VERSION` 2.3.0 → 2.4.0 (new extended tools added)
- `package.json` — version 2.3.0 → 2.4.0
- `README.md` — tool table is regenerated by `npm run docs:sync`; check the extended-tools table grew by two rows.

Nothing else. No service-layer wrapper (`claim-service.ts`) in step 1 —
the tool talks to Prisma directly like every other extended tool. A
service wrapper lands with step 4 when the tRPC layer starts reading
claims for UI.

## Out of scope — reminders

If I find myself adding any of these, stop:

- Dual-write from `saveFact` / `recordDecision` into `Claim`.
- An alias that makes `saveFact({type:"context", ...})` write to `Claim`.
- Adding a `Note.kind` column to the existing `note` table.
- Wiring `queryKnowledge` / briefMe / UI to read from `claim`.
- Computing `isStale(claim)` anywhere.
- Migrating existing rows from the old tables.

## Commit plan (conventional commits, one concern each)

1. `docs: plan for Note+Claim step 1 (#86)` — this file only.
2. `feat(db): add Claim table (RFC step 1 — #86)` — `schema.prisma` + `npm run db:push` artifact.
3. `feat(mcp): saveClaim and listClaims tools (#86)` — new `claim-tools.ts`, register in `server.ts`, bump schema/server versions, bump `package.json`, run `docs:sync` and commit the regenerated README block.

Three commits so each bisects cleanly — the schema change is independent of the tool surface, and the doc precedes both.

## Validation checklist

Before marking card #86 done:

- [ ] `npm run db:push` succeeds against the local DB and generates the new Prisma client.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx biome check` clean on the two changed files.
- [ ] `npm run mcp:dev` starts, `getTools({category:"context"})` shows `saveClaim` + `listClaims` in the catalog.
- [ ] Smoke test: `saveClaim` each of the four kinds → `listClaims` returns all four → `listClaims({kind:"code"})` filters correctly → supersede flow creates cross-links.
- [ ] `npm run docs:sync` ran; README extended-tools table shows the two new entries.
- [ ] No existing tests regressed (`npm test` if present).

## Rollback

This step is reversible with a single migration: drop the `claim` table,
remove `src/mcp/tools/claim-tools.ts`, revert the two version bumps. No
data loss anywhere else because no other code touches `Claim`.
