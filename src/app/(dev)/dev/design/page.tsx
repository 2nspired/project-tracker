import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { DESIGN_NAV } from "@/components/design-system/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
	title: "Design System",
};

/**
 * Landing page for `/dev/design`.
 *
 * Mirrors the shadcn/ui docs landing — a brief intro and a grid of section
 * cards that link into the sidebar's groups. Built sections show a "Live"
 * badge; placeholders show "Coming soon" to telegraph progress.
 */
export default function DesignLanding() {
	return (
		<div className="flex flex-col gap-10">
			<div className="flex flex-col gap-3">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Pigeon design system
				</span>
				<h1 className="text-4xl font-semibold tracking-tight">The destination for every UI fix.</h1>
				<p className="max-w-2xl text-muted-foreground">
					A living showcase of Pigeon's tokens, primitives, patterns, and surfaces — built on
					shadcn/ui (new-york). Every component renders live against the same theme variables the
					product uses, so what you see here is what ships.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				{DESIGN_NAV.map((section) => {
					const builtCount = section.items.filter((i) => i.built).length;
					const totalCount = section.items.length;
					const firstHref = section.items[0]?.href ?? "/dev/design";
					return (
						<Link
							key={section.heading}
							href={firstHref}
							className="group block focus-visible:outline-none"
						>
							<Card className="h-full transition-colors group-hover:border-foreground/20 group-focus-visible:border-foreground/20 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50">
								<CardHeader>
									<div className="flex items-center justify-between">
										<CardTitle>{section.heading}</CardTitle>
										<ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
									</div>
									<CardDescription>
										{builtCount} of {totalCount} {totalCount === 1 ? "page" : "pages"} live
									</CardDescription>
								</CardHeader>
								<CardContent>
									<ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
										{section.items.map((item) => (
											<li key={item.href} className={item.built ? "text-foreground" : undefined}>
												{item.label}
											</li>
										))}
									</ul>
								</CardContent>
							</Card>
						</Link>
					);
				})}
			</div>
		</div>
	);
}
