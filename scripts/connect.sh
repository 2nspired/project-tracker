#!/usr/bin/env bash
#
# Connect a project to the Project Tracker MCP server.
#
# Usage:
#   From any project directory:
#     /path/to/project-tracker/scripts/connect.sh
#
#   Or with an explicit target:
#     /path/to/project-tracker/scripts/connect.sh /path/to/my-project
#

set -euo pipefail

# Resolve the project-tracker root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Target directory is the argument, or current working directory
TARGET_DIR="${1:-$(pwd)}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

MCP_FILE="$TARGET_DIR/.mcp.json"

# Sanity check: don't connect project-tracker to itself
if [ "$TARGET_DIR" = "$TRACKER_ROOT" ]; then
  echo "Error: You're inside project-tracker itself. Run this from a different project."
  exit 1
fi

# Check if .mcp.json already exists
if [ -f "$MCP_FILE" ]; then
  # Check if project-tracker is already configured
  if grep -q "project-tracker" "$MCP_FILE" 2>/dev/null; then
    echo "project-tracker is already configured in $MCP_FILE"
    exit 0
  fi

  echo "Warning: $MCP_FILE already exists with other MCP servers."
  echo "You'll need to manually add the project-tracker entry."
  echo ""
  echo "Add this to the \"mcpServers\" object in $MCP_FILE:"
  echo ""
  echo "  \"project-tracker\": {"
  echo "    \"command\": \"$TRACKER_ROOT/scripts/mcp-start.sh\","
  echo "    \"args\": []"
  echo "  }"
  exit 0
fi

# Detect agent name — default to "Claude", override with AGENT_NAME env var or flag
AGENT_NAME="${AGENT_NAME:-Claude}"

# Create .mcp.json
cat > "$MCP_FILE" <<EOF
{
  "mcpServers": {
    "project-tracker": {
      "command": "$TRACKER_ROOT/scripts/mcp-start.sh",
      "args": [],
      "env": {
        "AGENT_NAME": "$AGENT_NAME"
      }
    }
  }
}
EOF

echo "Created $MCP_FILE"
echo "Project Tracker MCP is now available in this project."
echo "Agent name: $AGENT_NAME (set AGENT_NAME env var to change)"
echo ""
echo "Tip: Add this to your project's CLAUDE.md:"
echo ""
cat <<'SNIPPET'
  ## Project Tracking

  This project uses a Project Tracker board via MCP.

  **Session lifecycle:** Call `briefMe({ boardId })` at the start of each
  conversation for a one-shot session primer (handoff, top work, blockers, pulse).
  Use the `end-session` MCP prompt before wrapping up to save a handoff.

  **Tool architecture:** 11 essential tools are always visible (getBoard, createCard,
  updateCard, moveCard, addComment, searchCards, getRoadmap, briefMe, checkOnboarding,
  getTools, runTool). 70+ extended tools live behind `getTools`/`runTool` — call
  `getTools()` with no args to see all categories.

  **Basics:** Reference cards by #number (e.g. "working on #7"). Move cards to
  reflect progress. Use `addComment` for decisions and blockers. Call
  `end-session` to save a handoff so the next conversation picks up in context.
SNIPPET
