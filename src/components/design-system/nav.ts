import type { Route } from "next";

/**
 * Sidebar navigation spec for `/dev/design`.
 *
 * Each section has a heading and a list of leaf pages. Pages with `built: true`
 * link to a real implementation; `built: false` resolves to a placeholder
 * route that renders a "Coming in v6.2" card. Adding a real implementation in
 * a sibling card flips the flag.
 */

export interface DesignNavLeaf {
	/** Display label in the sidebar. */
	label: string;
	/** Route path under `/dev/design`. */
	href: Route;
	/** Whether the page is implemented (true) or a stub (false). */
	built: boolean;
}

export interface DesignNavSection {
	heading: string;
	items: DesignNavLeaf[];
}

export const DESIGN_NAV: DesignNavSection[] = [
	{
		heading: "Foundations",
		items: [
			{
				label: "Colors",
				href: "/dev/design/foundations/colors",
				built: true,
			},
			{
				label: "Typography",
				href: "/dev/design/foundations/typography",
				built: false,
			},
			{
				label: "Spacing",
				href: "/dev/design/foundations/spacing",
				built: false,
			},
			{
				label: "Radius",
				href: "/dev/design/foundations/radius",
				built: false,
			},
			{
				label: "Icons",
				href: "/dev/design/foundations/icons",
				built: false,
			},
		],
	},
	{
		heading: "Primitives",
		items: [
			{ label: "Button", href: "/dev/design/primitives/button", built: false },
			{ label: "Input", href: "/dev/design/primitives/input", built: false },
			{ label: "Badge", href: "/dev/design/primitives/badge", built: false },
			{ label: "Card", href: "/dev/design/primitives/card", built: false },
			{
				label: "Segmented Control",
				href: "/dev/design/primitives/segmented-control",
				built: true,
			},
			{
				label: "Skeleton",
				href: "/dev/design/primitives/skeleton",
				built: false,
			},
		],
	},
	{
		heading: "Patterns",
		items: [
			{
				label: "Loading, Empty, Error",
				href: "/dev/design/patterns/loading-empty-error",
				built: true,
			},
			{
				label: "Step Section",
				href: "/dev/design/patterns/step-section",
				built: false,
			},
		],
	},
	{
		heading: "Surfaces",
		items: [{ label: "Surfaces", href: "/dev/design/surfaces", built: false }],
	},
];
