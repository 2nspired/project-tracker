# Updating Pigeon

One page, written for people who run a local copy. Thomas writes the code; this doc tells you what to do after `git pull`.

## The short version

```bash
git pull
npm install
npm run db:push          # only if CHANGELOG says SCHEMA_VERSION bumped
npm run service:update   # rebuild + restart the launchd service
```

That's it for MINOR and PATCH updates. For MAJOR updates, keep reading.

## Upgrading from v4.x to v5.0 (Pigeon rebrand)

v5.0 renames the tool from "project-tracker" to "Pigeon". The MCP server still answers under the legacy `project-tracker` config key during v5.x (deprecation warning logged on connect); v6.0 drops the alias.

After `git pull` to v5.0:

```bash
npm install
npm run migrate-rebrand    # one-shot: tutorial DB rename + .mcp.json key rewrites + checklist
npm run service:update
```

`migrate-rebrand` is idempotent — safe to re-run. It prints a final checklist for the manual steps it deliberately doesn't auto-execute (e.g. renaming the launchd service label from `com.2nspired.project-tracker` to `com.2nspired.pigeon`).

## Checking the CHANGELOG first

Before running anything, open `CHANGELOG.md` and find the new version. The sections to care about:

- **Removed** — something you were using may be gone.
- **Changed** — look for `SCHEMA_VERSION` bumps or wire-shape changes.
- **Migration** — if present, lists the exact script to run and the order.

If the release is a **MAJOR** bump (e.g. `2.5.0 → 3.0.0`), the CHANGELOG will call out the breaking changes explicitly and link back here.

## MAJOR updates — back up first

A MAJOR bump means tables are dropping, columns are changing, or migration scripts must run. If something goes wrong mid-update, the rollback is "restore the DB." Back it up:

```bash
cp data/tracker.db data/tracker.db.pre-$(node -p "require('./package.json').version")
```

That copies your DB to `data/tracker.db.pre-3.0.0` (or whatever the target version is). If anything breaks, `cp` it back and you're whole again.

Then run the update in order:

```bash
git pull
npm install
# Run any migration scripts listed in CHANGELOG — ORDER MATTERS.
# Example (from the #86 Note+Claim cutover):
#   npx tsx scripts/migrate-notes-claims.mts
npm run db:push          # drop/rename tables per the new schema
npm run service:update
```

Open the UI to sanity-check after:

```bash
npm run db:studio        # eyeball the tables
```

## What each script does

| Command | When to run | What it does |
| --- | --- | --- |
| `npm install` | Every pull | Installs dep changes. Prisma postinstall regenerates the client. |
| `npm run db:push` | When `SCHEMA_VERSION` bumped | Applies the schema to `data/tracker.db`. Drops columns/tables if the schema removed them. |
| `npm run db:studio` | Debugging | Opens Prisma Studio to inspect the DB. Read-only unless you write in the UI. |
| `npm run db:seed` | Fresh install only | Seeds the tutorial project. Idempotent — safe to re-run, does nothing if the tutorial project exists. |
| `npm run service:update` | Every pull (when using the background service) | Builds with Turbopack and restarts the launchd service so the UI at `localhost:3100` picks up the new code. |
| `npm run service:status` | Sanity check | Shows whether the launchd service is running. |
| `npm run service:logs` | Debugging | Tails stdout/stderr from the service. |

## MCP agent connection

If you're running an MCP agent (Claude, Codex, etc.) against Pigeon, restart the agent after an update — the agent caches the server manifest and will show a `_versionMismatch` warning on `briefMe` until it reconnects.

## When something goes wrong

1. `npm run service:logs` — read the tail. Most errors show up here.
2. `npm run db:studio` — check the schema matches what the CHANGELOG described.
3. Restore the backup from step 1 if the DB is in a weird state: `cp data/tracker.db.pre-X.Y.Z data/tracker.db && npm run service:update`.
4. If none of that helps, open an issue with the error and the version you updated from/to.

## If you're behind by multiple versions

CHANGELOG entries describe each step from the previous version to the next. Apply them in order — don't skip. Running migration script for 3.0.0 without having reached 2.5.0 first is not supported and may silently corrupt data.
