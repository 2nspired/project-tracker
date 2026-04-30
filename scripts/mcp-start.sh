#!/usr/bin/env bash
# Legacy launcher for the Pigeon MCP server (renamed from project-tracker).
# Kept so existing `mcpServers.project-tracker` config keys keep working;
# new installs should point at scripts/pigeon-start.sh under key `pigeon`.
# Removed in v6.0. Run `npm run migrate-rebrand` for the full migration.
echo "[pigeon] DEPRECATION: scripts/mcp-start.sh is the legacy entrypoint. Update your mcpServers config to use scripts/pigeon-start.sh under key 'pigeon'. Removed in v6.0." >&2
export MCP_SERVER_BRAND=project-tracker
export MCP_CALLER_CWD="${MCP_CALLER_CWD:-$PWD}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$TRACKER_ROOT"
exec node_modules/.bin/tsx src/mcp/server.ts
