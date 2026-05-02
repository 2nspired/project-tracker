import { Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ComingSoonProps {
	/** Section name (e.g. "Typography"). */
	title: string;
	/** One-line teaser of what this page will hold. */
	teaser: string;
	/** Optional milestone label; defaults to v6.2. */
	milestone?: string;
}

/**
 * Placeholder card used by every unbuilt page in the design-system sidebar.
 *
 * Keeps the nav fully reachable (no 404s) while the real content is owned by
 * sibling cards in v6.2. Replace the page body with the real implementation
 * when shipping the matching foundation/primitive/pattern card.
 */
export function ComingSoon({ title, teaser, milestone = "v6.2" }: ComingSoonProps) {
	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<div className="flex items-center gap-2">
					<Sparkles className="size-4 text-muted-foreground" />
					<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						Coming in {milestone}
					</span>
				</div>
				<CardTitle className="text-2xl">{title}</CardTitle>
				<CardDescription>{teaser}</CardDescription>
			</CardHeader>
			<CardContent className="text-sm text-muted-foreground">
				This page is part of Pigeon's design-system shell (#237). The content lands when the
				matching {milestone} card ships.
			</CardContent>
		</Card>
	);
}
