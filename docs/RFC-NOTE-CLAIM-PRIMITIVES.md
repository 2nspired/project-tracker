# RFC: Two Primitives — Note + Claim

> Status: **Draft** · Authored 2026-04-16 · Blocks cards #77–83 · Card: #76

## Problem

The tracker currently stores persistent knowledge in **seven** tables:

| Table | Intent | Shape |
|---|---|---|
| `PersistentContextEntry` | Narrative project knowledge | `claim + rationale + application + details[] + citedFiles[]` |
| `CodeFact` | Assertion about a file/symbol | `path + symbol? + fact` |
| `MeasurementFact` | Numeric measurement | `value + unit + env + path?` |
| `Decision` | Architectural decision | `title + decision + alternatives[] + rationale + status + supersedes?` |
| `SessionHandoff` | End-of-session dump | `workingOn[] + findings[] + nextSteps[] + blockers[] + summary` |
| `AgentScratch` | Ephemeral working memory | `key/value + expiresAt` |
| `Note` | Free-form project note | `title + content + tags[]` |

This shape carries three real costs:

1. **Agents hesitate** at write time — "is this a Note, a context entry, or a code fact?" The seven-way decision is paid on every save and most of the time the distinction isn't load-bearing.
2. **The human sees drift** — `saveHandoff`, `saveFact`, `createNote`, `recordDecision` each grow their own fields, tools, and UI surfaces, and the vocabulary diverges from what appears in the board.
3. **Staleness logic is replicated** — three different staleness classes live across these tables, with subtle differences that aren't principled.

The collapse target: **two** tables, each with a small enumerated `kind`.

## Proposal (TL;DR)

Replace the seven tables with two primitives:

- **`Note`** — free-form narrative. Kinds: `general`, `handoff`, `scratch`.
- **`Claim`** — structured assertion with evidence. Kinds: `context`, `code`, `measurement`, `decision`.

`kind` drives staleness policy, UI surface, and tool ergonomics. The storage shape stays uniform.

## The Two Primitives

### `Note` — narrative, human-first

A piece of prose the human (or agent) wants to keep. Unstructured on purpose.

```
Note {
  id:             String   // UUID
  projectId:      String?  // null allowed → project-independent notes
  kind:           Enum     // 'general' | 'handoff' | 'scratch'
  title:          String
  content:        String   // markdown body
  tags:           JSON     // string[]
  author:         String   // AGENT_NAME or HUMAN
  cardId:         String?  // optional card anchor
  boardId:        String?  // handoffs and scratch scoped to boards
  expiresAt:      DateTime?  // scratch-only auto-expiry
  metadata:       JSON     // kind-specific fields (see below)
  createdAt:      DateTime
  updatedAt:      DateTime
}
```

**Per-kind `metadata` contents:**

- `general` — `{}` (nothing extra)
- `handoff` — `{ workingOn: string[], findings: string[], nextSteps: string[], blockers: string[] }` (the structured arrays currently living in top-level `SessionHandoff` columns become a metadata blob)
- `scratch` — `{ key: string }` (the old `AgentScratch.key` becomes a metadata field; the body lives in `content`)

Handoffs and scratch become Note kinds — not a separate type — because their *shape* is narrative, even though their intent differs. The human reads a handoff the same way they read a general note: top-to-bottom prose.

### `Claim` — structured assertion with evidence

A typed statement the tracker can reason about: staleness, citation, supersession.

```
Claim {
  id:             String    // UUID
  projectId:      String
  kind:           Enum      // 'context' | 'code' | 'measurement' | 'decision'
  statement:      String    // the one-sentence assertion
  body:           String    // markdown elaboration (rationale, alternatives, details)
  evidence:       JSON      // citations — files[], symbols[], urls[], cardIds[]
  author:         String    // AGENT_NAME or HUMAN
  cardId:         String?   // optional card anchor
  status:         Enum      // 'active' | 'superseded' | 'retired'
  supersedesId:   String?   // link to prior Claim this one replaces
  supersededById: String?   // inverse link
  recordedAtSha:  String?   // git SHA at record time (for code/measurement)
  verifiedAt:     DateTime? // last time the claim was re-checked
  expiresAt:      DateTime? // TTL (measurement-only in practice)
  payload:        JSON      // kind-specific structured data (see below)
  createdAt:      DateTime
  updatedAt:      DateTime
}
```

**Per-kind `payload` contents:**

- `context` — `{ application: string, audience: 'all'|'agent'|'human', surface: 'ambient'|'indexed'|'surfaced' }`
  The narrative breakdown (`claim`, `rationale`, `application`, `details[]`) collapses: `statement` = claim, `body` = rationale + details, `application` and `audience`/`surface` stay structured because tool logic branches on them.
- `code` — `{}` — all the specific-ness lives in `evidence.files[]` + `evidence.symbols[]`
- `measurement` — `{ value: number, unit: string, env: Record<string,string> }`
  `statement` is the human-readable description; `payload.value + payload.unit` is the number.
- `decision` — `{ alternatives: string[] }` — `statement` = title, `body` = decision + rationale; supersession via `supersedesId`/`supersededById` on the row itself, not in payload.

**Why `statement` + `body` + `payload`:**

Every claim needs a one-liner you can display in a list (staleness warnings, board badges, search results). That's `statement`. Every claim needs room for prose the human can actually read. That's `body`. Some claims have structured fields other claims don't — that's `payload`, and only the fields that drive *logic* (value, unit, env for drift detection; application/audience/surface for visibility; alternatives for ADR review) live there.

## Mapping Existing Tables

| Current table | New shape | `kind` | Notes |
|---|---|---|---|
| `Note` | `Note` | `general` | 1:1, add `author` + `cardId` if missing |
| `SessionHandoff` | `Note` | `handoff` | `workingOn/findings/nextSteps/blockers` → `metadata`; `summary` → `content` |
| `AgentScratch` | `Note` | `scratch` | `key` → `metadata.key`; `value` → `content`; `expiresAt` kept |
| `PersistentContextEntry` | `Claim` | `context` | `claim` → `statement`; `rationale + details` → `body`; `application/audience/surface` → `payload`; `citedFiles` → `evidence.files` |
| `CodeFact` | `Claim` | `code` | `fact` → `statement`; `path + symbol` → `evidence.files + evidence.symbols`; `needsRecheck` derives from `verifiedAt` vs `recordedAtSha` |
| `MeasurementFact` | `Claim` | `measurement` | `description` → `statement`; `value/unit/env` → `payload`; `path/symbol` → `evidence`; `ttl` → `expiresAt` |
| `Decision` | `Claim` | `decision` | `title` → `statement`; `decision + rationale` → `body`; `alternatives` → `payload`; `supersedes/supersededBy` → columns on `Claim`; `status` unified into `active/superseded/retired` |

## Staleness Per Kind

A single `isStale(claim)` function with a `kind` switch replaces the three staleness implementations scattered today. Notes don't stale — they rot on human eye, not on system policy. Only `Claim`s carry staleness logic:

| Kind | Trigger | Source of truth |
|---|---|---|
| `context` | `age × no-human-touch` heuristic | `createdAt` + `author` + `updatedAt` (used as human-touch proxy) |
| `code` | `evidence.files[]` latest commit SHA ≠ `recordedAtSha` | `git log` for cited paths |
| `measurement` | (a) `expiresAt` past OR (b) any `evidence.files[]` SHA changed since `recordedAtSha` OR (c) age > 30d | ttl + git + clock |
| `decision` | `status = 'superseded'` OR cited file SHA drift (if `evidence.files[]` present) | `status` field + git |

Notes have no staleness flag. `handoff` notes use a simple age filter in list queries (most recent N per board).

## UI Surfacing

A single `/knowledge/:projectId` page replaces the scattered surfaces today. Grouped by primitive, not by old-table identity:

- **Notes** — Timeline view. Filter by `kind` (all / general / handoff / scratch). Handoffs get a badge; scratch gets a countdown to `expiresAt`.
- **Claims** — Table view. Columns: kind, statement, status, author, verifiedAt, staleness pill. Filter by kind and status.
- **On a card detail sheet** — two collapsible sections: "Notes" (general + handoff anchored to this card) and "Claims" (claims where `cardId = this.id`).
- **Staleness banner on briefMe** — lists stale claims by kind with actionable hints (`re-verify`, `supersede`, `retire`).

Old surfaces (`listNotes`, `listHandoffs`, `getDecisions`, `listFacts`) stay as tools but become thin views over `listClaims({ kind })` / `listNotes({ kind })`. This keeps agent code working through the migration.

## Tools

The 20+ existing save/list/get tools collapse to 4 core tools, each with a `kind` param:

- `saveNote({ kind, title, content, tags?, cardId?, boardId?, metadata?, expiresAt? }) → Note`
- `listNotes({ projectId, kind?, cardId?, boardId?, author? }) → Note[]`
- `saveClaim({ kind, statement, body?, evidence?, cardId?, payload?, supersedesId?, ... }) → Claim`
- `listClaims({ projectId, kind?, cardId?, status?, stale? }) → Claim[]`

`deleteClaim`/`deleteNote`, `verifyClaim` (bump `verifiedAt`), and `supersedeClaim` (wrapper that creates a new claim + links it) round out the surface. The old tool names remain as 3-line aliases for one minor version, then get removed.

## Migration Order

The seven-to-two collapse is risky at once. Stage it so read paths always work:

1. **Add `Claim` table + `saveClaim`/`listClaims` tools.** No dual-write yet — this is a parallel write surface agents can opt into. (Card #77)
2. **Add unified `Note` model (extend the existing `Note` table with `kind`, `metadata`, `author`, `cardId`, `boardId`, `expiresAt`).** (Card #78)
3. **Dual-write phase.** Every existing save tool also writes to the new primitives. Reads still come from old tables. This lets the new storage accumulate without regressing anything. (#77 + #78)
4. **Cutover reads.** `listFacts`, `getDecisions`, `listHandoffs`, etc., switch to reading from `Claim`/`Note`. Old tables become write-only shadows. Verify UI surfaces and FTS5 `queryKnowledge` against the new source. (Card #79)
5. **Surface in UI.** Handoff banner, claim badges on cards, knowledge page. (Cards #80–81)
6. **Staleness pipeline operates on `Claim.kind`.** Delete the three duplicated implementations. (Card #82)
7. **Drop the old tables + old-named tools.** Irrevocable step — only take after the knowledge page has been in use for a full iteration. (Card #83)

A rollback exists through step 4. After step 7 the migration is permanent.

## Open Questions

- **Do scratch notes warrant staying separate?** Ephemeral, board-scoped, agent-owned — they behave differently from narrative notes. Keeping them as a `kind` is honest but tempts the system to treat them as first-class when they probably should not outlive a session. Decision deferred to #78.
- **`evidence` shape.** Defined here as `{ files, symbols, urls, cardIds }`. If measurement-env lookup needs richer structure (e.g., `{ hardware, modelBuild, ollamaVersion }`), those stay in `payload.env` for `measurement` kind rather than generalizing `evidence`.
- **FTS5 schema.** The existing FTS5 virtual table indexes eight sources. After migration it indexes two. The index rebuild in step 4 is the moment to verify ranking still works for mixed queries.
- **Web UI ownership.** The knowledge page is mentioned in step 5 but could be deferred further. The primitive collapse has value even without the new page — agents save and query through tools. The UI surface is a second-order benefit that can ship independently.

## Out of Scope for This RFC

- Multi-user `authorId`/`audienceId` (still deferred, per `docs/DESIGN-CONTEXT-MODEL.md`)
- Vocabulary canonicalization / alias resolution across claims
- Branch-local facts (hard problem #3 in the design doc — the two-primitive collapse does not address it, but also does not make it harder)
- Changing the `activity` table, `comment` table, or `cardRelation` table — those are card-adjacent, not knowledge-primitives

## Acceptance for This Card (#76)

- [x] Field shapes for Note and Claim defined, including per-kind `metadata`/`payload`
- [x] Mapping table from each of the 7 tables to the new shape
- [x] Staleness policy per kind, with a single unified trigger function
- [x] UI surfacing described per primitive and per kind
- [x] Migration order with rollback boundary identified
- [x] Open questions enumerated so #77–83 don't rediscover them
