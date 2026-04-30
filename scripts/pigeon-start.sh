#!/usr/bin/env bash
# Launcher for the Pigeon MCP server (canonical entrypoint).
#
# MCP_CALLER_CWD preserves the spawning client's cwd (typically the project
# root, from .mcp.json) so briefMe can auto-detect the project. Without this,
# the server would always see the tracker root after the `cd` below.
export MCP_SERVER_BRAND=pigeon
export MCP_CALLER_CWD="${MCP_CALLER_CWD:-$PWD}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$TRACKER_ROOT"
exec node_modules/.bin/tsx src/mcp/server.ts
