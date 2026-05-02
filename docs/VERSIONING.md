# Versioning

Pigeon follows [Semantic Versioning](https://semver.org/). The rules below are what we actually apply — not aspirational. If a change doesn't match a rule, update the rule or pick a different bump.

## Semver triggers

### MAJOR (`x.0.0`)

Bump MAJOR when the change forces downstream users to do work beyond `npm install` + `db:push`:

- Schema drops or renames (tables, columns, relations).
- Column type changes that require data coercion.
- Breaking MCP tool wire-shape changes — param renamed, required param added, response shape changed.
- Breaking tRPC router wire-shape changes.
- Migration scripts the user must run manually in a specific order.
- Removing an essential MCP tool or renaming it.

A MAJOR bump gets a dedicated CHANGELOG section listing every breaking change and a pointer to the exact commands the user must run — see `docs/UPDATING.md`.

### MINOR (`x.y.0`)

Bump MINOR for additive, non-breaking changes:

- New MCP tools or new extended tool parameters with safe defaults.
- New tRPC procedures.
- New columns that are nullable or have a default.
- New UI features.
- Deprecating (but not removing) an existing tool — MAJOR removes it.

### PATCH (`x.y.z`)

Bump PATCH for:

- Bug fixes with no behavior contract change.
- Doc updates.
- Internal refactors that don't change any public surface (MCP tools, tRPC routers, schema, UI).
- Performance changes that keep the same output.

## Version carriers

Three places track the version and must move together on every release:

| Location | Purpose |
| --- | --- |
| `package.json` `version` | npm metadata; source of truth for `scripts/release.ts`. |
| `src/mcp/manifest.ts` `MCP_SERVER_VERSION` | Reported in the MCP boot banner and `tracker://server/manifest`. |
| Git tag `vMAJOR.MINOR.PATCH` | Immutable pointer; what users `git checkout` to pin. |

`scripts/release.ts` verifies `package.json` and `MCP_SERVER_VERSION` agree before tagging.

## `SCHEMA_VERSION` — a separate counter

`SCHEMA_VERSION` (in `src/mcp/utils.ts`) is an integer that increments on every schema change, regardless of semver level. It is not the package version.

- A MAJOR semver bump with schema changes → `SCHEMA_VERSION` increments.
- A MINOR semver bump that adds a nullable column → `SCHEMA_VERSION` also increments.
- A PATCH that only fixes a bug → `SCHEMA_VERSION` stays.

The MCP server exposes `SCHEMA_VERSION` in its handshake so connected agents can detect drift when the DB on disk is older than the server binary expects. Downstream users who pull new code see a `SCHEMA_VERSION` bump in the CHANGELOG and know to run `npm run db:push`.

## Git tag convention

- Tag format: `v<MAJOR>.<MINOR>.<PATCH>` — e.g. `v2.5.0`, `v3.0.0`.
- Tag the commit that ships the release (usually the one that bumps `package.json`).
- `git push --tags` after the tag is created.
- `scripts/release.ts` does both automatically.

Pre-release and build metadata (`-rc.1`, `+sha.abc123`) are not used. Two-user project — we don't need the overhead.

## Release cadence — `[Unreleased]`-as-you-go

The CHANGELOG only works as an async signal if it stays current between tags. The rule:

- **Every PR adds a line to `[Unreleased]`** under the right Keep-a-Changelog category (`### Added` / `### Changed` / `### Fixed` / `### Deprecated` / `### Chore`) before merge. The line links the tracker card ref so future readers can trace it back.
- **Cut a tag when the section feels meaningful** — roughly 3–5 PRs of additive work, or any one breaking change, or any one schema bump. Don't wait until the section is overwhelming; the v5.2.0 backfill (#176) is the cautionary tale.
- **PR review checks `[Unreleased]`.** If a non-trivial PR doesn't touch CHANGELOG, that's a review block.

Skip the entry only for: pure formatting/lint commits, CHANGELOG itself, dependency bumps without behavior change, internal refactors with no public-surface delta. When in doubt, add the line — a one-line entry is cheap.

### CI enforcement

`.github/workflows/changelog.yml` enforces the rule on every PR to `main`. If the PR diff touches `src/`, `prisma/`, `scripts/`, `docs/`, `docs-site/`, or `package.json` and the `## [Unreleased]` section in `CHANGELOG.md` is byte-identical to the base branch's, the check fails. Add the entry, or apply the `skip-changelog` label for the rare PR that genuinely warrants no line (CI-only, test-only, vendored config). The skip path is the escape valve, not the default — every use is visible on the PR.

## CHANGELOG entry style

Entries are read by users after `npm run service:update`, not by reviewers running a postmortem. Write them for the audience that will encounter them.

**The rule:** one short paragraph per bullet, leading with what changed and why it matters, ending with the `(#NNN)` tracker link. Forensic detail (file paths, removed type names, conflict resolution, multi-PR rollup) belongs on the card; the link is the escape hatch for anyone who wants it.

**Soft cap: ~280 characters / 1–2 sentences per bullet.** A bullet that runs longer is a signal the detail belongs on the card, not in the notes. Rare exception: a single MAJOR breaking change may need more — for those, link `docs/UPDATING.md` and keep the bullet itself short.

### What to leave out

- Lists of files touched or moved.
- Names of removed types, helpers, exports.
- Inline grep or verification commands.
- Conflict-resolution narrative from a merge.
- Internal-only baseline metrics (e.g. "boundary-lint drops 7 → 5") unless a downstream user would notice.

These are valuable — they belong on the linked card and in the PR body. They're not what a user wants while deciding whether to upgrade.

### Pattern grounding

This is the shape the JS ecosystem already converges on: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) buckets carrying paragraph-level entries that link out for detail. Linear's public changelog and most well-run GitHub Releases follow the same pattern — short paragraph of reader-relevant context, link.

The **release-section intro paragraph** above the buckets (the headline + optional `### Why now` from the release procedure) is where narrative goes. The bullets stay tight.

### Worked example — heavy → light

**Heavy** (an actual v6.2.0 entry, ~1,500 characters):

> **#260 cluster 6/6 — move `runVersionCheck` and `findStaleInProgress` to `src/lib/services/`, drop two grandfathered `mcp-imports-server` boundary violations.** Final structural cluster of the umbrella refactor (decision a5a4cde6 — `src/server/` and `src/mcp/` cannot import each other; both consume `src/lib/`). `runVersionCheck` (the GitHub Releases probe behind the header pill + briefMe upgrade-info block) moves from `src/server/api/routers/system.ts` to a new `src/lib/services/version-check.ts`; `system.ts` re-exports the symbols so the existing tRPC procedure + `system.versionCheck.test.ts` keep working […]

**Light** (~280 characters, same value to a user):

> Finished the #260 layering refactor — `src/server/` and `src/mcp/` no longer import each other; both consume `src/lib/services/`. Boundary-lint baseline drops to 5 grandfathered violations; the FTS path and `buildBriefPayload` are deferred to v6.3. (#260)

Anyone wanting the file list, symbol moves, or deferred-work calculus follows `(#260)`.

## Release procedure (summary)

Full walkthrough in `scripts/release.ts` comments. Short version:

1. Land all changes for the release on `main`. (Each PR should already have appended to `[Unreleased]`.)
2. Promote `[Unreleased]` to a new `## [x.y.z] — YYYY-MM-DD` section at the top of `CHANGELOG.md`. Add an intro paragraph naming the headline change and a "### Why now" if the release has a coherent narrative. Reset `[Unreleased]` to a placeholder.
3. Bump `package.json` `version` and `MCP_SERVER_VERSION` in the same commit.
4. Bump `SCHEMA_VERSION` if the schema changed (or call out the existing bump in the CHANGELOG body if it landed in an earlier PR).
5. Open a release-prep PR; let CI run; merge to main.
6. From a clean main: `npx tsx scripts/release.ts --tag` — validates carriers, tags, and pushes.
7. `.github/workflows/release.yml` fires on the tag push and publishes the GitHub Release using the matching CHANGELOG section as the body. No manual step.

For the rare case of shipping without CI (offline, GH Actions outage), `scripts/release.ts --tag --gh` does the tag push and release publish in one local step. Use one path or the other — the workflow skips a release that already exists, but the script does not, so running both creates a race.

## GitHub Release title convention

The workflow titles releases as bare `vX.Y.Z`. For a MAJOR bump where you want a human-readable theme (e.g. `v3.0.0 — Note+Claim cutover final drop`), edit the title in the GitHub UI after the workflow publishes. Bare titles are the rule for MINOR and PATCH.

## Why this matters at two users

- The downstream user can't see `git log` in real time. CHANGELOG + release tags are the async signal that an update requires action.
- A MAJOR bump is the contract we make that says "read UPDATING.md before pulling." Burying a table drop in a MINOR release breaks that contract.
- Once we have three users, anything less rigorous becomes unmanageable — cheaper to enforce the rules now than to retrofit them later.
