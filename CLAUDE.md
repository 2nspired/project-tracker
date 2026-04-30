# Pigeon

Local-first kanban board with MCP integration for AI-assisted development. Pigeon carries context between AI sessions — `briefMe` at session start, `endSession` at session end.

## Tech Stack

- Next.js 16 (App Router, Turbopack) + React 19
- Prisma 7 + SQLite (file:./data/tracker.db)
- tRPC v11 + React Query v5 (SSE real-time updates, polling fallback)
- shadcn/ui (new-york) + Tailwind CSS 4
- @dnd-kit for drag-and-drop
- MCP server (stdio) at src/mcp/server.ts

## Commands

- `npm run dev` — start dev server (auto-creates DB if missing)
- `npm run setup` — interactive setup wizard
- `npm run mcp:dev` — run MCP server standalone (for testing)
- `npm run db:push` — push schema changes to SQLite
- `npm run db:seed` — seed tutorial project
- `npm run db:studio` — open Prisma Studio

### Background Service (launchd)

The web UI can run as a persistent background service via macOS launchd on port 3100, so it's always available without manually starting a dev server.

- `npm run service:install` — build and register the launchd service
- `npm run service:uninstall` — stop and remove the service
- `npm run service:start` — start the service
- `npm run service:stop` — stop the service
- `npm run service:disable` — stop and prevent auto-start on login
- `npm run service:enable` — re-enable auto-start on login
- `npm run service:status` — check if the service is running
- `npm run service:logs` — tail stdout/stderr logs
- `npm run service:update` — rebuild and restart after code changes

## Project Structure

- `src/server/services/` — business logic (ServiceResult pattern)
- `src/server/api/routers/` — tRPC routers (all publicProcedure, no auth)
- `src/mcp/` — MCP server (separate process, own db.ts)
- `src/components/board/` — board UI components
- `prisma/schema.prisma` — data model

## Agent Guidelines

See [AGENTS.md](AGENTS.md) for board usage guidelines, column definitions, workflow conventions, and connection instructions. Those guidelines apply to all agents (Claude, Codex, etc.).

If the user asks you to plan a card, call `planCard({ boardId, cardId: "#N" })` (or use the `/plan-card` slash command). It returns the card context, tracker.md policy, investigation hints, and a fixed protocol that produces the four locked plan sections.
