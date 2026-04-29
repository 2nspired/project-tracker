# Versioning

Project Tracker follows [Semantic Versioning](https://semver.org/). The rules below are what we actually apply — not aspirational. If a change doesn't match a rule, update the rule or pick a different bump.

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

## Release procedure (summary)

Full walkthrough in `scripts/release.ts` comments. Short version:

1. Land all changes for the release on `main`.
2. Bump `package.json` `version` and `MCP_SERVER_VERSION` in the same commit.
3. Bump `SCHEMA_VERSION` if the schema changed.
4. Add a new `## [x.y.z]` section at the top of `CHANGELOG.md`.
5. `npx tsx scripts/release.ts --tag` — validates and pushes the tag.
6. `.github/workflows/release.yml` fires on the tag push and publishes the GitHub Release using the matching CHANGELOG section as the body. No manual step.

For the rare case of shipping without CI (offline, GH Actions outage), `scripts/release.ts --tag --gh` does the tag push and release publish in one local step. Use one path or the other — the workflow skips a release that already exists, but the script does not, so running both creates a race.

## GitHub Release title convention

The workflow titles releases as bare `vX.Y.Z`. For a MAJOR bump where you want a human-readable theme (e.g. `v3.0.0 — Note+Claim cutover final drop`), edit the title in the GitHub UI after the workflow publishes. Bare titles are the rule for MINOR and PATCH.

## Why this matters at two users

- The downstream user can't see `git log` in real time. CHANGELOG + release tags are the async signal that an update requires action.
- A MAJOR bump is the contract we make that says "read UPDATING.md before pulling." Burying a table drop in a MINOR release breaks that contract.
- Once we have three users, anything less rigorous becomes unmanageable — cheaper to enforce the rules now than to retrofit them later.
