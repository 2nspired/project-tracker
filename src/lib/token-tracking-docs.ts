// Shared docs target for the token-tracking setup CTAs (Pulse strip,
// card-detail empty state, and the in-app setup dialog's "Read more"
// footer). Single source so all three surfaces stay in sync if AGENTS.md
// anchors are renamed.

export const TOKEN_TRACKING_DOCS_URL =
	"https://github.com/2nspired/pigeon/blob/main/AGENTS.md#token-tracking-96";

// Default placeholder when the server hasn't yet resolved a per-machine
// script path. The dialog substitutes this for the real absolute path
// returned by `getDiagnostics().recommendedHookCommand`.
export const TOKEN_TRACKING_HOOK_SCRIPT_PLACEHOLDER = "/path/to/your/pigeon/scripts/stop-hook.sh";

// The Stop hook config users paste into their Claude Code config. Built
// per-machine because the `command:` field is an absolute path. CC 2.1.x
// only honors hooks declared in `settings.json` files (user, project, or
// project-local) — `.claude.json` is internal state and is silently
// ignored. We use `type: "command"` instead of `type: "mcp_tool"`: in
// CC 2.1.123 the latter no-ops without error in this hook config, so
// users would never see any data despite a valid-looking setup.
export function buildTokenTrackingHookSnippet(scriptAbsPath: string): string {
	return `{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${scriptAbsPath}"
          }
        ]
      }
    ]
  }
}`;
}
