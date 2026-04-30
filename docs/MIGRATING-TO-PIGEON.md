# Migrating to Pigeon (v5.0.0)

> The tool you've been calling **project-tracker** is now **Pigeon**. The metaphor: it carries context between your AI sessions like a homing pigeon carries a message — agents release it at session end, the next agent catches it at session start.
>
> This document walks you (and your AI agent) through the v4.x → v5.0 upgrade end-to-end. Hand it to your agent and ask it to walk through with you, or follow it yourself.

## TL;DR

```bash
cd /path/to/your/project-tracker     # your existing local clone
git pull                              # pulls v5.0.0+
npm install
npm run migrate-rebrand               # idempotent — safe to re-run
# Then follow the printed manual-step checklist (launchd + ~/.claude.json),
# and verify with:
npm run doctor                        # added in v5.1 — runs 8 install checks
```

The whole thing should take <10 minutes. There are exactly **two manual steps** the script deliberately doesn't auto-run because they're destructive: the launchd label rename and your Claude Code config edit. Both are documented below. After both, run `npm run doctor` to confirm everything wired up correctly.

---

## Before you start

### 1. You should already be on v4.2.0

v5.0.0 builds on v4.2.0. If you skipped v4.2, do that first — it's additive (no breaking API or data changes), and gives you the taxonomy primitives the v5 work assumes. From your existing local clone:

```bash
git pull                  # pulls v4.2.0
npm install
npm run db:push           # v4.2 bumped SCHEMA_VERSION 9 → 10 (new Tag, CardTag,
                          # AppSettings, TokenUsageEvent tables; Milestone.state)
npm run service:update
```

### 2. ⚠️ STOP — clear any `projectPrompt` content before pulling v5.0

> **Anything still in the `projectPrompt` DB column when you pull v5.0 is lost when the column drops.** This is the only data-loss path in the migration. Read this section before running `git pull`.

v5.0 drops the legacy `projectPrompt` column entirely (Phase 3 of the `tracker.md` migration). The v4.0 `migrateProjectPrompt` tool writes a `tracker.md` from the column's value; v4.1 added a deprecation warning when content remained.

**On v4.x, in any agent session:**

```
briefMe()
```

Look at the response. If `_warnings[]` mentions `projectPrompt`, you have content that needs migrating. To get the project ID:

```
runTool('listProjects')
```

Then for each project that has `projectPrompt` content:

```
runTool('migrateProjectPrompt', { projectId: '<your project id>' })
```

The migration writes `tracker.md` to that project's `repoPath` (idempotent — aborts if the file already exists). After it completes, clear the DB column manually via Prisma Studio (`npm run db:studio`) or by editing the project's prompt to empty in the UI. Commit the new `tracker.md` to your repo.

If `briefMe()` does **not** include a `projectPrompt` warning, you're clear to upgrade.

### 3. Back up your database

```bash
cp data/tracker.db data/tracker.db.pre-v5.0.0
```

If anything goes sideways during the migration, restoring this file gets you back to v4.2 state.

---

## What's changing in v5.0

### Identity rename
- **Tool name:** `project-tracker` → `Pigeon`
- **npm package name:** `project-tracker` → `pigeon-mcp` (private, not published — internal only)
- **MCP entrypoint:** `scripts/mcp-start.sh` → `scripts/pigeon-start.sh` (legacy still works during v5.x — see "Deprecation alias" below)
- **MCP config key:** `mcpServers.project-tracker` → `mcpServers.pigeon`
- **launchd service label:** `com.2nspired.project-tracker` → `com.2nspired.pigeon`
- **Logs directory:** `~/Library/Logs/project-tracker/` → `~/Library/Logs/pigeon/`
- **Tutorial project name:** "Learn Project Tracker" → "Learn Pigeon"
- **All UI / docs / CLI banners** updated to say Pigeon

### What is NOT changing
These are deliberately preserved so your existing data and tooling keep working:

- `tracker.db` filename — your SQLite DB stays at `data/tracker.db`
- `tracker.md` filename — your project policy file keeps the same name
- All MCP tool names: `briefMe`, `endSession`, `createCard`, `moveCard`, etc.
- Prisma table names and DB schema (other than the projectPrompt drop in #129)
- `tracker://` URI scheme for MCP resources
- The tutorial project's slug (`learn-project-tracker`) — internal idempotency guard
- The on-disk repo directory name (you can keep your local clone at `project-tracker/`; renaming it is your call)

### Deprecation alias (this is what makes the upgrade non-breaking)

`scripts/mcp-start.sh` still exists and still works. Your existing `mcpServers.project-tracker` config in Claude Code keeps functioning — Pigeon just announces a `_brandDeprecation` field in `briefMe`/`checkOnboarding` responses nudging you to migrate. The alias is removed in **v6.0**, so you can do the manual `~/.claude.json` rename at your own pace before then.

---

## Migration steps

### Step 1 — Pull v5.0.0

```bash
cd /path/to/your/project-tracker
git pull
npm install
```

### Step 2 — Run `npm run migrate-rebrand`

```bash
npm run migrate-rebrand
```

**This is idempotent — safe to re-run.** Two stages:

1. **Database rewrites (your tutorial project, if you have one):**
   - Tutorial project name: "Learn Project Tracker" → "Learn Pigeon"
   - Tutorial cards' titles and bodies that mention the brand
   - Best-practices note content
   - Stale "5 columns" tutorial finding → "4 columns" (drive-by fix; v4.0.0 removed Up Next)

2. **Filesystem rewrites (every connected project's `.mcp.json`):**
   - For each `Project.repoPath` row in your DB, the script reads `<repoPath>/.mcp.json` and rewrites:
     - `mcpServers.project-tracker` key → `mcpServers.pigeon`
     - `scripts/mcp-start.sh` command path → `scripts/pigeon-start.sh`
   - **Backups:** every modified file gets a sibling backup at `.mcp.json.bak.<timestamp>` written with the `wx` flag (won't clobber an existing backup).
   - **Other server keys preserved:** if you have other MCP servers in the same `.mcp.json`, they're left untouched.

After both stages run, the script prints the **manual-step checklist** described next. Read every line of the printed output before continuing.

### Step 3 — Rename the launchd service (the printed checklist's Step 1)

`service:uninstall` no longer recognizes the old `com.2nspired.project-tracker` label, so it can't stop the legacy service for you. Run the explicit bootout first, then install fresh:

```bash
launchctl bootout gui/$(id -u)/com.2nspired.project-tracker || true
rm -f ~/Library/LaunchAgents/com.2nspired.project-tracker.plist
npm run service:install
```

The `|| true` is intentional — the bootout will fail if the legacy service was never installed, and that's fine. The `rm -f` cleans up the old plist file so launchd doesn't have stale config.

Verify:

```bash
npm run service:status
# Service:    com.2nspired.pigeon
# URL:        http://localhost:3100
# State:      running
```

Old logs at `~/Library/Logs/project-tracker/` can be deleted by hand once you've confirmed Pigeon is running on `http://localhost:3100`. New logs land at `~/Library/Logs/pigeon/`.

### Step 4 — Update Claude Code's MCP config (the printed checklist's Step 2)

The migration script does **not** auto-edit `~/.claude.json` (or `~/.claude-alt/.claude.json` if you use an alt profile) — that file lives outside the repo and we don't want to silently rewrite it. Open it manually and rename:

**Before:**
```json
{
  "mcpServers": {
    "project-tracker": {
      "type": "stdio",
      "command": "/absolute/path/to/your/project-tracker/scripts/mcp-start.sh",
      "args": []
    }
  }
}
```

**After:**
```json
{
  "mcpServers": {
    "pigeon": {
      "type": "stdio",
      "command": "/absolute/path/to/your/project-tracker/scripts/pigeon-start.sh",
      "args": []
    }
  }
}
```

Two changes only: the key name and the script filename in the command path. Everything else (the absolute path prefix, any `env`/`AGENT_NAME` overrides) stays exactly as it was.

#### Don't miss: `mcp_tool` hooks reference the server key by name

If you have any Claude Code hooks that call MCP tools — e.g., a `Stop` hook that records token usage, or a `PreToolUse` hook that logs activity — they hard-code the server name. Search your config:

```bash
grep -n '"server": "project-tracker"' ~/.claude.json ~/.claude-alt/.claude.json 2>/dev/null
```

Each match needs `"server": "project-tracker"` → `"server": "pigeon"`. These do **not** fall back to the deprecation alias — a stale `server` reference makes the hook silently no-op (the hook fires, can't find the server, drops the call). You won't see an error, you just stop getting the data.

Skill-usage telemetry entries like `mcp__project-tracker__some-tool` (under `slashCommandLastUsed` or similar) are harmless — they're stats, not wiring. Leave them alone.

#### Optional during v5.x

This step is technically optional during v5.x — the legacy `mcpServers.project-tracker` + `mcp-start.sh` combination still works with a deprecation warning. But the warning will show up in every session until you do the rename, and the alias goes away in v6.0.

### Step 5 — Run `npm run doctor` to verify everything wired up

v5.1 adds a one-command install verifier:

```bash
npm run doctor
```

It runs 8 checks and prints a green/red list with copy-pasteable fix commands:

1. **MCP registration** — confirms `mcpServers.pigeon` is in `~/.claude.json` / `~/.claude-alt/.claude.json`; flags legacy `project-tracker` keys.
2. **Hook drift** — finds `mcp_tool` hooks that still reference `"server": "project-tracker"` (these silently no-op post-rename).
3. **launchd label** — confirms `com.2nspired.pigeon` is loaded; flags stale `com.2nspired.project-tracker`.
4. **Connected repos** — for each project's `repoPath`, verifies `.mcp.json` uses the new key shape.
5. **Server version** — running service version vs `package.json` (catches missed `service:update`).
6. **Per-project `tracker.md`** — exists and parseable for every connected project.
7. **WAL hygiene** — flags an unhealthy SQLite WAL size that triggers Prisma's phantom-drop foot-gun.
8. **FTS5 sanity** — verifies the `knowledge_fts` virtual table and shadow tables are consistent.

Exit code is `0` when nothing failed (warnings are OK), `1` when at least one check is in `fail`.

### Step 6 — Restart any running MCP sessions

Close any active Claude Code (or Codex / Cursor / Windsurf) conversations that have Pigeon connected, then start a new one. Verify in the new session:

```
briefMe()
```

- The response should **not** include a `_brandDeprecation` field. If it does, you're still running under the legacy entrypoint — re-check Step 4.
- The pulse line should mention your project name normally.
- The `_serverVersion` field should read `5.0.0` or higher.

---

## Verifying it worked

The fastest path is `npm run doctor` (Step 5 above). For a manual cross-check:

```bash
# 1. Service is running under the new label
npm run service:status   # should show com.2nspired.pigeon

# 2. Web UI is up
open http://localhost:3100   # browser title should say "Pigeon"

# 3. MCP server announces the new identity (smoke check)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | ./scripts/pigeon-start.sh
# look for: "name":"pigeon" in the response, no _brandDeprecation field

# 4. Tutorial project (if you ever seeded one) has the new name
# Open localhost:3100, look for "Learn Pigeon" in the project list
```

If your agent calls `briefMe()` and the response has a `_brandDeprecation` field present, you're still running under the legacy entrypoint. Go back to Step 4.

---

## Rollback

If something is wrong and you want to revert:

```bash
# 1. Stop the new service
launchctl bootout gui/$(id -u)/com.2nspired.pigeon || true
rm -f ~/Library/LaunchAgents/com.2nspired.pigeon.plist

# 2. Restore the database
cp data/tracker.db.pre-v5.0.0 data/tracker.db

# 3. Restore each .mcp.json from its .bak.<timestamp>
# The migration script wrote backups next to each rewritten file.
# Find them: `find ~ -name '.mcp.json.bak.*' 2>/dev/null`
# Restore: `mv path/.mcp.json.bak.<ts> path/.mcp.json`

# 4. Check out the prior tag
git checkout v4.2.0
npm install
npm run service:install   # re-creates com.2nspired.project-tracker

# 5. Restore your ~/.claude.json from your own backup
# (You did make one before editing it manually, right?)
```

If you didn't keep a backup of `~/.claude.json` and need to revert, the rollback is just renaming the key back: `mcpServers.pigeon` → `mcpServers.project-tracker` and the path back to `mcp-start.sh`. The script files themselves still exist on the v4.2 checkout.

---

## For your agent

If you ask Claude (or Codex, Cursor, Windsurf, etc.) to help with this migration mid-session, here's what your agent should know:

- **The single command** that does the heavy lifting: `npm run migrate-rebrand`. It is idempotent. Re-running it never destroys data.
- **The script does NOT touch** `~/.claude.json` or your launchd-installed service. Those are the two manual steps in the printed checklist.
- **A `_brandDeprecation` field** in `briefMe` / `checkOnboarding` responses means the agent is connecting via the legacy entrypoint. The fix is Step 4 above (rename the `mcpServers` key + the command path).
- **Backups exist.** Every rewritten `.mcp.json` has a sibling `.bak.<timestamp>`. The DB has whatever pre-migration backup you made (Step 0). If the agent suggests something that feels destructive, ask it to confirm a backup is in place first.
- **Out of scope for this migration:** changing `tracker.db` filename, `tracker.md` filename, MCP tool names like `briefMe`/`endSession`, the `tracker://` URI scheme, the on-disk repo directory name, or the GitHub repo URL slug. All preserved.
- **Final restart matters.** Tools cache the server manifest at handshake time — your agent will keep showing the old brand until you start a fresh session after Step 4.

---

## Why all this?

Short version: the tool's positioning got clearer this year. "project-tracker" reads as generic infrastructure; the differentiator is the multi-session context-carrying loop (briefMe → endSession → next session's briefMe), which is exactly what a homing pigeon does. Renaming makes the tool talkable and gives it an identity that survives outside the dev's head — which matters for adoption beyond the original two users.

The migration is non-breaking by design. Every breaking change has a deprecation alias that lasts through v5.x and goes away in v6.0. You can do the manual `~/.claude.json` edit at your own pace; the legacy script keeps working with a nudge.

If anything in this doc is unclear or breaks for you, ping me and I'll fix the doc + the script.
