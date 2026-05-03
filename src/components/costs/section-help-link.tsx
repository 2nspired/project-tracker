"use client";

/**
 * Section help link (#276).
 *
 * Renders a small `?` icon button next to a Costs page section header,
 * deep-linking to the matching anchor on the cost-tracking explainer in
 * docs-site. Visual weight is intentionally tiny (`text-2xs`,
 * `size-3.5`) — the link is for engineers who want to check the math,
 * not a primary affordance.
 *
 * `anchor` is the Starlight-slugified heading on `/costs` (e.g.
 * `pricing-model`, `attribution-engine`, `the-3-bucket-gap`). Pass an
 * empty string to point at the page root.
 */

import { HelpCircle } from "lucide-react";

import { costsExplainerUrl } from "@/lib/doc-url";

type Props = {
	/** Anchor slug on `/costs`. Empty string targets the page root. */
	anchor: string;
	/** Accessible label — "How is the X calculated?" */
	label: string;
};

export function SectionHelpLink({ anchor, label }: Props) {
	return (
		<a
			href={costsExplainerUrl(anchor)}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={label}
			title={label}
			className="inline-flex items-center text-muted-foreground/60 transition-colors hover:text-muted-foreground"
		>
			<HelpCircle className="size-3.5" aria-hidden />
		</a>
	);
}
