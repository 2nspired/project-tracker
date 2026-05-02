/**
 * Design-system token registry.
 *
 * Lists every CSS variable defined in `src/app/globals.css` (`:root` / `.dark`)
 * along with a human-readable label and the group it belongs to. The token
 * NAMES live here; the VALUES are resolved at runtime via
 * `getComputedStyle(document.documentElement)` in the colors page — so updating
 * a value in `globals.css` requires no code change here.
 *
 * When you add a new `--*` variable to `globals.css`, add it here too. The
 * `/dev/design/foundations/colors` page renders this list as the spec for
 * which swatches to draw.
 */

export type ColorTokenGroup = "Surfaces" | "Brand" | "Borders & Inputs" | "Charts" | "Sidebar";

export interface ColorToken {
	/** CSS variable name without the leading `--`. e.g. `background`. */
	name: string;
	/** Optional friendly label; falls back to a humanized `name`. */
	label?: string;
	/** Group bucket on the colors page. */
	group: ColorTokenGroup;
	/** One-line description shown under the swatch. */
	description?: string;
}

export const COLOR_TOKENS: ColorToken[] = [
	// Surfaces
	{
		name: "background",
		group: "Surfaces",
		description: "App-level page background.",
	},
	{
		name: "foreground",
		group: "Surfaces",
		description: "Default text color on `background`.",
	},
	{ name: "card", group: "Surfaces", description: "Card surface background." },
	{
		name: "card-foreground",
		group: "Surfaces",
		description: "Default text color on `card`.",
	},
	{
		name: "popover",
		group: "Surfaces",
		description: "Popover / menu surface background.",
	},
	{
		name: "popover-foreground",
		group: "Surfaces",
		description: "Default text color on `popover`.",
	},
	{
		name: "muted",
		group: "Surfaces",
		description: "Subtle background for inactive areas.",
	},
	{
		name: "muted-foreground",
		group: "Surfaces",
		description: "De-emphasized text color (timestamps, helper text).",
	},
	{
		name: "accent",
		group: "Surfaces",
		description: "Hover / selected surface tint.",
	},
	{
		name: "accent-foreground",
		group: "Surfaces",
		description: "Text color on `accent`.",
	},
	// Brand
	{
		name: "primary",
		group: "Brand",
		description: "Primary action color (CTA buttons, focus emphasis).",
	},
	{
		name: "primary-foreground",
		group: "Brand",
		description: "Text color on `primary`.",
	},
	{
		name: "secondary",
		group: "Brand",
		description: "Secondary action surface.",
	},
	{
		name: "secondary-foreground",
		group: "Brand",
		description: "Text color on `secondary`.",
	},
	{
		name: "destructive",
		group: "Brand",
		description: "Destructive / error state.",
	},
	// Borders & Inputs
	{
		name: "border",
		group: "Borders & Inputs",
		description: "Default border color.",
	},
	{
		name: "input",
		group: "Borders & Inputs",
		description: "Form input border / background tint.",
	},
	{
		name: "ring",
		group: "Borders & Inputs",
		description: "Focus ring color.",
	},
	// Charts
	{ name: "chart-1", group: "Charts" },
	{ name: "chart-2", group: "Charts" },
	{ name: "chart-3", group: "Charts" },
	{ name: "chart-4", group: "Charts" },
	{ name: "chart-5", group: "Charts" },
	// Sidebar
	{
		name: "sidebar",
		group: "Sidebar",
		description: "Sidebar surface background.",
	},
	{
		name: "sidebar-foreground",
		group: "Sidebar",
		description: "Default text color in the sidebar.",
	},
	{
		name: "sidebar-primary",
		group: "Sidebar",
		description: "Sidebar primary action.",
	},
	{
		name: "sidebar-primary-foreground",
		group: "Sidebar",
		description: "Text color on `sidebar-primary`.",
	},
	{
		name: "sidebar-accent",
		group: "Sidebar",
		description: "Sidebar hover / selected tint.",
	},
	{
		name: "sidebar-accent-foreground",
		group: "Sidebar",
		description: "Text color on `sidebar-accent`.",
	},
	{ name: "sidebar-border", group: "Sidebar" },
	{ name: "sidebar-ring", group: "Sidebar" },
];

export const COLOR_TOKEN_GROUPS: ColorTokenGroup[] = [
	"Surfaces",
	"Brand",
	"Borders & Inputs",
	"Charts",
	"Sidebar",
];
