# Implementation Plan: Note + Claim — Step 2

> Status: **Shipped (with amendments)** · Authored 2026-04-16 · Amended 2026-04-17

## Amendment (2026-04-17)

Scratch was removed end-to-end in **#98** after the RFC was accepted with conditions (see `RFC-NOTE-CLAIM-PRIMITIVES.md` amendments). All references below to `createScratch`, `kind='scratch'`, `scratch` metadata, and the `agent_scratch` table are historical — those concepts no longer exist. The `NOTE_KINDS` enum is now `{ general, handoff }`. Step-6 staleness / TTL sweep remains planned for `handoff` age-filtering only.

## Scope of this plan

**Only step 2 of the RFC migration.** Extend the existing `Note` table with
the columns the final unified model needs (`kind`, `metadata`, `author`,
`cardId`, `boardId`, `expiresAt`), and widen `createNote` / `listNotes` /
`updateNote` so callers may set and filter on them. **No dual-write yet.**
`saveHandoff`, `createScratch`, and `listHandoffs` continue to read and write
the legacy `session_handoff` and `agent_scratch` tables untouched.

This mirrors step 1's rollback boundary: if we abandon the migration after
this step, the cost is seven unused columns on `note` and six widened tool
parameters. No data moves, no reader changes behavior.

Explicitly **not** in this step:

- Dual-write from `saveHandoff` into `note(kind=handoff)` — that is step 3.
- Dual-write from `saveScratch` into `note(kind=scratch)` — step 3.
- Reading `note(kind=handoff)` anywhere (`listHandoffs`, briefMe,
  `endSession`, UI) — step 4.
- Staleness / auto-expiry on `note.expiresAt` — step 6.
- Migrating historical `session_handoff` / `agent_scratch` rows.
- Any UI change on `/notes` or the project notes pane.

## Audit — what exists today

### `Note` Prisma model (`prisma/schema.prisma:212`)

```
id, projectId?, title, content, tags, createdAt, updatedAt
```

Two indexes: `[projectId]`, `[updatedAt]`. One relation: `Project` via
`SetNull`.

### Note tooling

- **MCP extended tools** (`src/mcp/extended-tools.ts:706-778`):
  `listNotes`, `createNote`, `updateNote` — each takes only the current
  shape (`title` / `content` / `tags` / optional `projectId`).
- **Service** (`src/server/services/note-service.ts`): `list / create /
  update / delete`, returns `Note & { project }`.
- **Schemas** (`src/lib/schemas/note-schemas.ts`): `createNoteSchema`,
  `updateNoteSchema` — both tag-shaped, no extra columns.
- **tRPC router** (`src/server/api/routers/note.ts`): thin wrapper over the
  service, validates with the schemas above.
- **UI** (`src/app/(main)/notes/page.tsx`,
  `src/app/(main)/projects/[projectId]/page.tsx`): reads `title`,
  `content`, `tags`, `project` — ignores anything else returned.

### Adjacent legacy tables (NOT touched in step 2)

- `SessionHandoff` (`schema.prisma:246`) — still the source of truth for
  handoffs. `saveHandoff` tool + `handoff-service` + briefMe all keep
  reading/writing it.
- `AgentScratch` — still the source of truth for scratch.

These tables get dual-write treatment in step 3 and disappear at step 7.

## Target — extended `Note` Prisma model

```prisma
model Note {
  id        String    @id @default(uuid())
  projectId String?   @map("project_id")
  kind      String    @default("general")           // 'general' | 'handoff' | 'scratch'
  title     String
  content   String    @default("")
  tags      String    @default("[]")
  author    String    @default("HUMAN")             // AGENT_NAME or HUMAN
  cardId    String?   @map("card_id")
  boardId   String?   @map("board_id")
  metadata  String    @default("{}")                // JSON — kind-specific
  expiresAt DateTime? @map("expires_at")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  card    Card?    @relation(fields: [cardId],    references: [id], onDelete: SetNull)
  board   Board?   @relation(fields: [boardId],   references: [id], onDelete: SetNull)

  @@index([projectId])
  @@index([projectId, kind])
  @@index([boardId, kind])
  @@index([cardId])
  @@index([kind])
  @@index([expiresAt])
  @@index([updatedAt])
  @@map("note")
}
```

Inverse relations added on `Card` (`notes Note[]`) and `Board`
(`notes Note[]`) so the `SetNull` cascade semantics work. `Project.notes`
already exists — unchanged.

### Notes on field choices

- `kind` default `"general"` keeps every existing row valid without a
  backfill. A bare `INSERT` from the current `createNote` tool (which does
  not pass `kind`) is still a valid general note.
- `author` default `"HUMAN"` — the tracker's current notes are created
  through the web UI, which is human. Agent-authored notes through MCP
  will set `author = AGENT_NAME` explicitly from step 2 forward. Existing
  rows stay attributed to HUMAN, which is accurate.
- `metadata` is a JSON string following the same pattern as `tags`,
  `evidence`, `payload` elsewhere in the schema. Per-kind shape mirrors
  the RFC:
  - `general` → `{}`
  - `handoff` → `{ workingOn, findings, nextSteps, blockers }`
  - `scratch` → `{ key }`
- `boardId` is nullable because `general` notes are project-scoped or
  global; only `handoff` and `scratch` actually scope to a board. The
  `[boardId, kind]` index covers the step-4 read pattern: "latest N
  handoffs for this board."
- `expiresAt` is nullable for the same reason — only `scratch` uses it.
  The `[expiresAt]` index lets a future cleanup job sweep efficiently.
- No `needsRecheck` / `verifiedAt` on `Note`. Notes don't stale (RFC
  §Staleness Per Kind).

### Indexes chosen

Seven indexes, each tied to a read we know we need in step 4+:

- `[projectId]` — existing, keep.
- `[projectId, kind]` — `listNotes({ projectId, kind: 'general' })`.
- `[boardId, kind]` — `listHandoffs(boardId)` after step-4 cutover.
- `[cardId]` — card detail sheet Notes section.
- `[kind]` — cross-project `listNotes({ kind: 'handoff' })`.
- `[expiresAt]` — scratch sweep job (step 6).
- `[updatedAt]` — existing, keep (timeline ordering).

## Target — widened tools

All three existing note tools accept the new columns as **optional**
parameters. No caller of `createNote` / `listNotes` / `updateNote` needs
to change. Default-only calls keep producing general notes with
`author = HUMAN`.

### `createNote` additions

```ts
// added to the zod object in src/mcp/extended-tools.ts
kind:     z.enum(["general", "handoff", "scratch"]).default("general"),
author:   z.string().default(AGENT_NAME).describe("AGENT_NAME or HUMAN"),
cardId:   z.string().optional().describe("Card UUID or #number — optional anchor"),
boardId:  z.string().optional().describe("Board UUID — required for handoff/scratch kinds (step 3)"),
metadata: z.record(z.string(), z.unknown()).default({}).describe("Kind-specific metadata — see saveNote description"),
expiresAt: z.string().optional().describe("ISO datetime — scratch TTL"),
```

Handler changes:

- If `cardId` is `#N` form, resolve via `resolveCardRef` (existing
  helper — same pattern as `saveClaim`). Fail with `err(...)` on miss.
- Serialize `metadata` to JSON before write.
- No per-kind validation in step 2. Agents may pass `kind='handoff'` and
  `metadata={}`; we accept it. Step 3's dual-write is where the handoff
  shape gets enforced, and even then we enforce by construction from
  `saveHandoff`, not by rejecting direct `createNote` calls.
- Return value gains `kind`, `author`, `cardId`, `boardId` so the caller
  gets back what it wrote.

### `listNotes` additions

```ts
kind:    z.enum(["general", "handoff", "scratch"]).optional().describe("Filter by kind"),
cardId:  z.string().optional().describe("Filter by card UUID or #number"),
boardId: z.string().optional().describe("Filter by board UUID"),
author:  z.string().optional().describe("Filter by author (AGENT_NAME or HUMAN)"),
```

Handler: build the `where` object from the optional filters. `cardId`
resolution via `resolveCardRef` if `#N` form and `projectId` is also
supplied (same scoping rule `saveClaim` uses). List output gains `kind`
and `author` fields per row so agents can tell handoffs from general
notes without a second lookup.

### `updateNote` additions

Same parameter set as `createNote` (minus `kind`/`boardId` — those stay
immutable once set; change-kind is a new-note operation in the final
design, but step 2 just preserves the current fields plus adds the rest
as editable). Practical step-2 rule: `kind` and `boardId` **may** be
updated here since we haven't locked the semantics yet; we will tighten
in step 4 if the dual-write phase reveals problems. Rationale: step 2
should be minimally opinionated — it's a storage extension, not a policy
layer.

## Target — service / router / schemas

### `src/lib/schemas/note-schemas.ts`

Add the new optional fields to `createNoteSchema` and `updateNoteSchema`:

```ts
kind:      z.enum(["general", "handoff", "scratch"]).default("general"),
author:    z.string().max(120).default("HUMAN"),
cardId:    z.string().uuid().nullable().optional(),
boardId:   z.string().uuid().nullable().optional(),
metadata:  z.record(z.string(), z.unknown()).default({}),
expiresAt: z.coerce.date().nullable().optional(),
```

The `create` variant defaults `kind` / `author` / `metadata`. The
`update` variant leaves all six optional with no default (omit =
unchanged), matching every other `update*Schema` in the codebase.

### `src/server/services/note-service.ts`

- `list(projectId?)` grows a second optional filter object:
  `list(projectId?: string | null, filter?: { kind?; cardId?; boardId?; author? })`.
  Keep the single-arg call site working (used by tRPC today) — default
  `filter = {}`.
- `create(data)` — stringify `metadata` before `db.note.create`.
- `update(id, data)` — stringify `metadata` on the update payload when
  present.
- Return `NoteWithProject` as today; no UI-visible change.

### `src/server/api/routers/note.ts`

No structural change. `list` input grows a `kind?` and `boardId?` pair
(optional) so the `/notes` page could filter in a future PR, but none of
the existing queries change behavior. tRPC input validation flows from
the widened zod schemas.

## Files to touch (complete list)

Create:
- `docs/IMPL-NOTE-CLAIM-STEP2.md` (this file)

Modify:
- `prisma/schema.prisma` — extend `Note`, add `notes` inverse on `Card` and `Board`
- `src/mcp/extended-tools.ts` — widen `createNote` / `listNotes` /
  `updateNote` parameter schemas and handlers; update list response shape
- `src/lib/schemas/note-schemas.ts` — widen `createNoteSchema` and
  `updateNoteSchema`
- `src/server/services/note-service.ts` — accept new fields, stringify
  `metadata`, optional `filter` arg on `list`
- `src/server/api/routers/note.ts` — optional `kind`/`boardId` input on
  `list` (forward to service)
- `src/mcp/utils.ts` — bump `SCHEMA_VERSION` 6 → 7
- `src/mcp/manifest.ts` — bump `MCP_SERVER_VERSION` 2.4.0 → 2.5.0
- `package.json` — version 2.4.0 → 2.5.0
- `README.md` — regenerated by `npm run docs:sync` after tool schema widens

Nothing else. No UI file changes.

## Out of scope — reminders

Stop if I find myself doing any of these in step 2:

- Making `saveHandoff` also write to `note(kind=handoff)`.
- Making `createScratch` also write to `note(kind=scratch)`.
- Making `listHandoffs` / briefMe / `endSession` read from `note`.
- Migrating historical `session_handoff` / `agent_scratch` rows.
- Adding a `stale?` filter to `listNotes`. Notes don't stale.
- Per-kind payload validation beyond what step 1 established for claims.

## Commit plan (conventional commits, one concern each)

1. `docs: plan for Note+Claim step 2 (#86)` — this file only.
2. `feat(db): extend Note table with kind/metadata/author (RFC step 2 — #86)` —
   `schema.prisma` + `npm run db:push` artifact.
3. `feat(mcp): note tools accept kind/author/cardId/boardId/metadata (#86)` —
   `extended-tools.ts`, `note-schemas.ts`, `note-service.ts`, `note.ts`
   router, version bumps, regenerated README.

Three commits; each bisects cleanly. Storage change is independent of
the tool-surface change, and the plan precedes both.

## Validation checklist

Before marking step 2 done:

- [ ] `npm run db:push` succeeds and Prisma client regenerates.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx biome check` clean on touched files.
- [ ] `npm run mcp:dev` starts; `getTools({category:"notes"})` shows the
  three tools with their new parameters.
- [ ] Smoke test: `createNote({title,content})` defaults to
  `kind=general`, `author=HUMAN`. `createNote({title, kind:'handoff',
  boardId, metadata:{workingOn:[...]}})` round-trips. `listNotes({kind:
  'handoff'})` filters correctly.
- [ ] Existing notes UI still loads and lists legacy notes unchanged.
- [ ] `npm run docs:sync` ran; README extended-tools table reflects the
  widened note tools.

## Rollback

Reversible with one migration: drop the six new columns on `note`, drop
the six new indexes, drop the two inverse relations, revert the tool
widening, undo version bumps. No data loss because the pre-existing
columns were not touched and no reader depends on the new ones.
