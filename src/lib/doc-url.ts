// Single-source helper for the MCP docs URL convention. Until tools.mdx
// has anchors for every tool name, the link still resolves — the page
// just won't jump to the right section. scripts/sync-tool-docs.ts is the
// safety net that keeps docs and registry in lockstep.
const DEFAULT_DOCS_BASE = "https://2nspired.github.io/pigeon";

export function docUrl(toolName: string): string {
	const base = process.env.NEXT_PUBLIC_DOCS_BASE ?? DEFAULT_DOCS_BASE;
	return `${base}/tools/#${toolName}`;
}

// Slash commands have their own docs page — Starlight slugifies the
// `/brief-me` heading to `brief-me`, so we strip the leading slash for
// the anchor while the route itself stays at `/slash-commands`.
export function slashCommandDocUrl(commandName: string): string {
	const base = process.env.NEXT_PUBLIC_DOCS_BASE ?? DEFAULT_DOCS_BASE;
	const anchor = commandName.replace(/^\//, "");
	return `${base}/slash-commands/#${anchor}`;
}

// Costs explainer (#276) — the per-section "How is this calculated?"
// helper deep-links from each Costs page section header to the matching
// anchor on `/costs`. Anchor is Starlight's slugified heading; e.g. the
// `## Pricing model` heading becomes `#pricing-model`. Pass `""` for
// the page root.
export function costsExplainerUrl(anchor = ""): string {
	const base = process.env.NEXT_PUBLIC_DOCS_BASE ?? DEFAULT_DOCS_BASE;
	return anchor ? `${base}/costs/#${anchor}` : `${base}/costs/`;
}
