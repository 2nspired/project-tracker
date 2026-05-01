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

# Install Claude Code slash commands into the target project. Idempotent: a
# pre-existing file with the same name is left untouched, so users can edit a
# command locally and re-run connect.sh without losing their changes. Pigeon's
# commands are thin wrappers around MCP tools, so they have no value without
# the .mcp.json — that's why this lives here, not in a separate script.
install_slash_commands() {
  local src_dir="$TRACKER_ROOT/.claude/commands"
  local dest_dir="$TARGET_DIR/.claude/commands"

  [ -d "$src_dir" ] || return 0
  shopt -s nullglob
  local sources=("$src_dir"/*.md)
  shopt -u nullglob
  [ ${#sources[@]} -gt 0 ] || return 0

  mkdir -p "$dest_dir"

  local installed=() skipped=()
  local src name
  for src in "${sources[@]}"; do
    name="$(basename "$src")"
    if [ -e "$dest_dir/$name" ]; then
      skipped+=("$name")
    else
      cp "$src" "$dest_dir/$name"
      installed+=("$name")
    fi
  done

  if [ ${#installed[@]} -gt 0 ]; then
    echo "Installed ${#installed[@]} slash command(s) into $dest_dir:"
    printf '  /%s\n' "${installed[@]%.md}"
  fi
  if [ ${#skipped[@]} -gt 0 ]; then
    echo "Slash commands already present (left as-is):"
    printf '  /%s\n' "${skipped[@]%.md}"
  fi
}

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
    install_slash_commands
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
  install_slash_commands
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
install_slash_commands
echo ""
echo "Tip: Add this to your project's CLAUDE.md:"
echo ""
# Snippet text is derived from src/mcp/manifest.ts + the live extended-tool
# registry so the essential count, essential names, and extended count never
# drift from reality. Edit scripts/print-connect-snippet.ts to change the
# template. (#187)
(cd "$TRACKER_ROOT" && npx tsx scripts/print-connect-snippet.ts)
