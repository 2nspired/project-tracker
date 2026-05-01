# Commands reference

Every npm script Pigeon ships, with the moment you'd reach for it.

## Day-to-day

| Script | When to run | What it does |
|---|---|---|
| `npm run dev` | Foreground development on `:3000` | Starts Next.js with Turbopack hot reload; auto-creates the DB if missing. |
| `npm run mcp:dev` | Testing the MCP surface in isolation | Runs the MCP server standalone over stdio (no web UI). |
| `npm run setup` | First install, or to re-run the wizard | Interactive: creates DB, optionally seeds the tutorial, optionally writes a `.mcp.json` to a target project. |
| `npm run doctor` | After install + after every `git pull` | 8-check install-health diagnostic — flags legacy config drift, version skew, DB state, with copy-pasteable fix commands. Exit code is `0` on green, `1` on any failure. |

## macOS background service (launchd)

The persistent background service runs on `:3100` so the UI is always available without a foreground terminal.

| Script | What it does |
|---|---|
| `npm run service:install` | Build + register the launchd service. |
| `npm run service:uninstall` | Stop and remove the service entirely. |
| `npm run service:start` / `:stop` | Start or stop the service. |
| `npm run service:enable` / `:disable` | Toggle auto-start on login. |
| `npm run service:status` | Is the service running? |
| `npm run service:logs` | Tail stdout/stderr. |
| `npm run service:update` | Rebuild + restart after code changes (run after every `git pull` if you use the service). |

## Database

| Script | When to run | What it does |
|---|---|---|
| `npm run db:push` | When `CHANGELOG` says `SCHEMA_VERSION` bumped | Applies the Prisma schema to `data/tracker.db`. Drops removed columns/tables. |
| `npm run db:generate` | Rarely (Prisma postinstall handles it) | Regenerates the Prisma client. |
| `npm run db:migrate` | Schema authoring | Creates a Prisma migration for the current schema diff. |
| `npm run db:seed` | Fresh install only | Seeds the Learn Pigeon tutorial project. Idempotent. |
| `npm run db:studio` | Debugging | Opens Prisma Studio to inspect the DB. |

## Quality gates

| Script | What it does |
|---|---|
| `npm run test` | Vitest run (unit + integration tests against an in-memory DB). |
| `npm run lint` | Biome check on `src/`. |
| `npm run lint:fix` | Biome auto-fix. |
| `npm run format` | Biome formatter. |
| `npm run type-check` | `tsc --noEmit`. |

## Tool catalog + docs sync

These keep the auto-generated tool tables in sync with the live MCP registry. Run after adding, removing, or renaming MCP tools.

| Script | What it does |
|---|---|
| `npm run docs:sync` | Regenerates the Essential + Extended tool tables in `README.md` and the docs site's `tools.mdx`. |
| `npm run docs:check` | CI gate — exits 1 if the tool tables would change (parity check). |
| `npm run catalog:sync` | Regenerates `src/lib/tool-catalog.generated.ts` (consumed by the in-app `?` Commands catalog). |
| `npm run catalog:check` | CI gate version of `catalog:sync`. |

## Docs site

The docs site lives at `docs-site/` (Astro 5 + Starlight).

| Script | What it does |
|---|---|
| `npm run docs:dev` | Astro dev server with hot reload. |
| `npm run docs:build` | Static build to `docs-site/dist/`. |
| `npm run docs:preview` | Preview the production build locally. |
| `npm run docs:install` | Install the docs site's own dependencies. |

## Release + migrations

| Script | When to run | What it does |
|---|---|---|
| `npm run release` | Cutting a new version | Verifies version agreement across `package.json` and `MCP_SERVER_VERSION` in `manifest.ts`, then tags and pushes. **Does not** run lint/test/type-check — run those manually before invoking. |
| `npm run migrate-rebrand` | Once when upgrading from v4.x or v5.x to v6+ | One-shot: tutorial DB rename + `.mcp.json` key rewrites + a checklist for manual steps (e.g. renaming the launchd service label). Idempotent. |
