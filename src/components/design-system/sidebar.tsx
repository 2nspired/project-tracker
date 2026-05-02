"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { DESIGN_NAV } from "./nav";

export function DesignSidebar() {
	const pathname = usePathname();

	return (
		<nav aria-label="Design system navigation" className="flex flex-col gap-6 px-4 py-6 text-sm">
			{DESIGN_NAV.map((section) => (
				<div key={section.heading} className="flex flex-col gap-1">
					<div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{section.heading}
					</div>
					<ul className="flex flex-col gap-0.5">
						{section.items.map((item) => {
							const active = pathname === item.href;
							return (
								<li key={item.href}>
									<Link
										href={item.href}
										aria-current={active ? "page" : undefined}
										className={cn(
											"flex items-center justify-between rounded-md px-2 py-1.5 transition-colors",
											active
												? "bg-accent text-accent-foreground"
												: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
										)}
									>
										<span>{item.label}</span>
										{!item.built ? (
											<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
												Soon
											</span>
										) : null}
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</nav>
	);
}
