#!/usr/bin/env bash
# In-progress summary across every project + board on the local tracker.
# Drop this into your shell rc as `alias tracker-status=…` for one-keystroke
# observability without running MCP.
#
# Requires: jq, curl, the launchd service running on 127.0.0.1:3100
# (or `npm run dev` on :3000 — set TRACKER_URL=http://localhost:3000).
set -euo pipefail

URL="${TRACKER_URL:-http://localhost:3100}/api/state"

curl -s "$URL" | jq -r '
  .projects[] |
  .name as $project |
  .boards[] |
  select(.counts.in_progress > 0) |
  "\($project) / \(.name): \(.counts.in_progress) in progress" +
    (if .counts.blocked > 0 then ", \(.counts.blocked) blocked" else "" end) +
    (if .counts.stale_in_progress > 0 then ", \(.counts.stale_in_progress) stale" else "" end)
'
