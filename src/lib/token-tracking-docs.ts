// Shared docs target for the token-tracking setup CTAs (Pulse strip,
// card-detail empty state, and the in-app setup dialog's "Read more"
// footer). Single source so all three surfaces stay in sync.
//
// Points at the local `docs/token-tracking.md` operator setup guide
// — Stop-hook wiring, agent coverage matrix, silent-drop debugging.
// Conceptual content (attribution, savings formula, pricing decisions,
// limits) lives in the docs-site `/costs/` page (COST_TRACKING_DOCS_URL
// below) — these are intentionally split so the dialog footer points at
// the operator how-to and the methodology Sheet points at the narrative.

export const TOKEN_TRACKING_DOCS_URL =
	"https://github.com/2nspired/pigeon/blob/main/docs/token-tracking.md";

// Energy methodology doc (#180) — coefficient sources, grid-intensity
// assumption, the "approximate" caveat, and how to override coefficients.
// Linked from the SummaryStrip's Energy cell tooltip and the RELEASES.md
// highlight bullet. Same in-repo-Markdown convention as the token-tracking
// link above; the doc renders on GitHub.
export const ENERGY_METHODOLOGY_DOCS_URL =
	"https://github.com/2nspired/pigeon/blob/main/docs/ENERGY-METHODOLOGY.md";

// Docs-site page that explains the cost surface — what gets recorded, how
// attribution works, what overhead/savings measure, and the input-rate
// decision (#204). Linked from `<TokenTrackingSetupDialog>`'s "Read more"
// footer alongside the operator setup guide at docs/token-tracking.md.
// (Was also linked from `<SavingsMethodologySheet>` until that component
// was removed alongside the savings lens in #236.)
export const COST_TRACKING_DOCS_URL = "https://2nspired.github.io/pigeon/costs/";

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
