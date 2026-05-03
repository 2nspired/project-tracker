# Pigeon

**Pigeon is self-hosting.** It uses its own MCP. Agents working on this codebase have full read/write access to the board they live on — the clearest demonstration is that this file (`CLAUDE.md`) ships in a repo where `briefMe`, `moveCard`, `addComment`, and `saveHandoff` are callable from any session opened here. Start every session with `briefMe`; end with `saveHandoff` (or `/handoff`).

Local-first kanban + MCP for AI-assisted development. Next.js 16 (App Router, Turbopack) + React 19, Prisma 7 + SQLite (`file:./data/tracker.db`), tRPC v11 + React Query v5, shadcn/ui (new-york) + Tailwind 4, @dnd-kit. MCP server (stdio) at `src/mcp/server.ts`.

## Three-layer architecture (#260)

The layering rule the boundary-lint enforces — `lint:boundary` in the pre-commit hook, baseline at `scripts/boundary-lint-baseline.json`:

```
src/lib/services/      pure business logic + ServiceResult; no tRPC, no Next, no MCP SDK imports
src/server/api/routers/  tRPC adapters — thin; wrap services, throw TRPCError on failure
src/mcp/               separate Node process; owns its own db.ts (PrismaClient + WAL + FTS extension)
```

**`src/server/` and `src/mcp/` never import each other.** Both consume `src/lib/services/`. This was finished in v6.2.1 (#260, baseline 18 → 5 violations). When adding a feature both surfaces need, the service goes in `src/lib/services/` as a `createXService(prisma)` factory; thin shims in `src/server/services/` and `src/mcp/tools/` bind the right Prisma client.

## Common pitfalls when editing

- **Don't add tRPC / Next imports to `src/lib/services/`** — `lint:boundary` blocks the commit. Services are pure; tRPC error mapping happens in the router layer.
- **MCP has its own `db.ts`** at `src/mcp/db.ts` — it's a distinct PrismaClient with the FTS5 live-sync extension applied. Schema changes must `npm run db:push` (the launchd service's `service:update` does this automatically); both processes share the same SQLite file under WAL.
- **Pass `boardId` explicitly when in a worktree.** Auto-detection from `cwd` resolves the *parent repo* rather than the worktree's intended board.
- **Don't run `npm run dev` from a worktree.** Turbopack walks up to the parent lockfile and silently 404s new routes. Use the launchd service on port 3100 (or pull the worktree branch into the main checkout for visual checks).

## Commands

- `npm run dev` — dev server (auto-creates DB if missing)
- `npm run setup` — interactive setup wizard
- `npm run mcp:dev` — MCP server standalone (testing)
- `npm run db:push` / `db:seed` / `db:studio` — Prisma
- `npm run service:install` / `:update` / `:status` / `:logs` — launchd background service on port 3100 (always-on web UI; `service:update` rebuilds, runs `prisma db push`, runs the doctor pass)

## Project structure

- `src/lib/services/` — business logic (ServiceResult pattern, factory functions)
- `src/server/services/` — Next.js-bound singletons (thin shims over `src/lib/services/`)
- `src/server/api/routers/` — tRPC routers (all `publicProcedure`, no auth)
- `src/mcp/` — MCP server (separate process, own `db.ts`, own tool registration in `register-all-tools.ts`)
- `src/mcp/manifest.ts` — `ESSENTIAL_TOOLS` (the 10 always-visible tools)
- `src/components/board/` — board UI
- `prisma/schema.prisma` — data model

## Authoritative surfaces

- **`tracker.md`** (repo root) — runtime board policy: project agent prompt, `intent_required_on`, per-column prompts. Hot-reloaded on every MCP call.
- **[`AGENTS.md`](AGENTS.md)** — Pigeon-internal contributor reference (tag conventions, reserved slugs, claim schemas, supersession rules, MCP tool architecture).
- **[`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md)** — universal agent collaboration patterns (session lifecycle, `intent` rule, planCard protocol, worktrees). Project-agnostic; ships with every Pigeon-connected repo.
- **[`docs/SURFACES.md`](docs/SURFACES.md)** — file-by-file authority map. When `tracker.md` overlaps anything, `tracker.md` wins.

## Planning a card

If the user asks you to plan a card, call `runTool({ tool: "planCard", params: { boardId, cardId: "#N" } })` (or use the `/plan-card` slash command). `planCard` is an extended tool — calling it as an essential fails with "tool not found." It returns card context, `tracker.md` policy, investigation hints, and the fixed protocol that produces the four locked plan sections (`## Why now`, `## Plan`, `## Out of scope`, `## Acceptance`). Chat is draft, card is publish — get user confirmation, then `updateCard` writes the plan to the description.
