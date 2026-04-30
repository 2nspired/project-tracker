#!/usr/bin/env bash
# Claude Code Stop hook entrypoint. Wired into ~/.claude-alt/.claude.json as
# the `command:` for the Stop event.
#
# Just `cd`s to the project root (so Prisma's relative
# `file:./data/tracker.db` URL resolves) and pipes stdin into the tsx script.
# Always exits 0 — Stop hooks must never block CC.

set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR" || exit 0

exec npx --no-install tsx scripts/stop-hook-record-tokens.ts
