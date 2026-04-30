#!/usr/bin/env bash
#
# Connect a project to the Pigeon MCP server.
#
# Usage:
#   From any project directory:
#     /path/to/pigeon/scripts/connect.sh
#
#   Or with an explicit target:
#     /path/to/pigeon/scripts/connect.sh /path/to/my-project
#

set -euo pipefail

# Resolve the Pigeon root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Target directory is the argument, or current working directory
TARGET_DIR="${1:-$(pwd)}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

MCP_FILE="$TARGET_DIR/.mcp.json"

# Sanity check: don't connect Pigeon to itself
if [ "$TARGET_DIR" = "$TRACKER_ROOT" ]; then
  echo "Error: You're inside the Pigeon directory itself. Run this from a different project."
  exit 1
fi

# Resolve git repo root if possible — this is what briefMe matches on.
REPO_ROOT=""
if git -C "$TARGET_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git -C "$TARGET_DIR" rev-parse --show-toplevel)"
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
else
  echo "Warning: $TARGET_DIR is not inside a git repo."
  echo "  Auto-detect for briefMe needs a git root — skipping registration."
fi

# Register the repo with Pigeon so briefMe can auto-detect it.
if [ -n "$REPO_ROOT" ]; then
  DEFAULT_NAME="$(basename "$REPO_ROOT")"
  read -r -p "Project name for this repo [$DEFAULT_NAME]: " PROJECT_NAME </dev/tty || PROJECT_NAME=""
  PROJECT_NAME="${PROJECT_NAME:-$DEFAULT_NAME}"

  echo "Registering $REPO_ROOT as \"$PROJECT_NAME\"..."
  (cd "$TRACKER_ROOT" && npx tsx scripts/register-repo.ts "$REPO_ROOT" "$PROJECT_NAME")
fi

# Check if .mcp.json already exists
if [ -f "$MCP_FILE" ]; then
  # Check if Pigeon is already configured (under either the new or legacy key)
  if grep -qE '"(pigeon|project-tracker)"' "$MCP_FILE" 2>/dev/null; then
    echo "Pigeon is already configured in $MCP_FILE"
    exit 0
  fi

  echo "Warning: $MCP_FILE already exists with other MCP servers."
  echo "You'll need to manually add the Pigeon entry."
  echo ""
  echo "Add this to the \"mcpServers\" object in $MCP_FILE:"
  echo ""
  echo "  \"pigeon\": {"
  echo "    \"command\": \"$TRACKER_ROOT/scripts/pigeon-start.sh\","
  echo "    \"args\": []"
  echo "  }"
  exit 0
fi

# Detect agent name — default to "Claude", override with AGENT_NAME env var or flag
AGENT_NAME="${AGENT_NAME:-Claude}"

# Reject values that would break the JSON we're about to write.
case "$AGENT_NAME" in
  *[\"\\]*|*$'\n'*)
    echo "Error: AGENT_NAME must not contain quotes, backslashes, or newlines." >&2
    exit 1
    ;;
esac

# Create .mcp.json
cat > "$MCP_FILE" <<EOF
{
  "mcpServers": {
    "pigeon": {
      "command": "$TRACKER_ROOT/scripts/pigeon-start.sh",
      "args": [],
      "env": {
        "AGENT_NAME": "$AGENT_NAME"
      }
    }
  }
}
EOF

echo "Created $MCP_FILE"
echo "Pigeon MCP is now available in this project."
echo "Agent name: $AGENT_NAME (set AGENT_NAME env var to change)"
echo ""
echo "Tip: Add this to your project's CLAUDE.md:"
echo ""
cat <<'SNIPPET'
  ## Project Tracking

  This project uses Pigeon (a kanban board with MCP integration) for context
  continuity across AI sessions.

  **Session lifecycle:** Call `briefMe()` at the start of each conversation
  for a one-shot session primer (handoff, top work, blockers, pulse). Call
  `endSession({ summary, ... })` before wrapping up — it saves the handoff,
  links new commits, reports touched cards, and returns a copy-pasteable
  resume prompt for the next chat. Both auto-detect the board from your git
  repo — no args needed.

  **Tool architecture:** 9 essential tools are always visible (briefMe,
  endSession, createCard, updateCard, moveCard, addComment, checkOnboarding,
  getTools, runTool). ~60 extended tools live behind `getTools`/`runTool` —
  including getBoard, searchCards, and getRoadmap, which briefMe composes
  internally. Call `getTools()` with no args to see all categories.

  **Basics:** Reference cards by #number (e.g. "working on #7"). Move cards to
  reflect progress. Use `addComment` for decisions and blockers. Call
  `endSession` to save a handoff so the next conversation picks up in context.

  **Intent on writes:** `moveCard` and `deleteCard` require a short `intent`
  string (≤120 chars) explaining *why* — humans watching the board read it live
  in the activity strip and card banner. `updateCard` accepts it optionally;
  pass one when the edit reflects a decision, skip it for mechanical fixes.
SNIPPET
