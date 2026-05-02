import { Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { DesignSidebar } from "@/components/design-system/sidebar";
import { ThemeModeToggle } from "@/components/design-system/theme-mode-toggle";
import { Input } from "@/components/ui/input";

/**
 * `/dev/design` chrome — sibling of `(main)` and `(auth)` route groups, so it
 * is NOT wrapped in product chrome (no app header, no command palette).
 *
 * Layout convention: top bar (brand + search shell + theme toggle) above a
 * two-column body (sidebar nav + content pane). Mirrors shadcn/ui docs and
 * GitHub Primer layout — the structure designers/POs already recognize.
 */
export default function DesignLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
				<div className="flex h-14 items-center gap-4 px-4">
					<Link href="/dev/design" className="flex items-center gap-2 text-sm font-semibold">
						<Image
							src="/pigeon-dark.png"
							alt=""
							width={20}
							height={20}
							className="h-5 w-5 dark:hidden"
							priority
						/>
						<Image
							src="/pigeon-light.png"
							alt=""
							width={20}
							height={20}
							className="hidden h-5 w-5 dark:block"
							priority
						/>
						<span>Pigeon</span>
						<span className="text-muted-foreground">/</span>
						<span className="text-muted-foreground">Design</span>
					</Link>
					<div className="relative ml-2 hidden flex-1 max-w-md md:block">
						<Search
							className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							type="search"
							placeholder="Search tokens, primitives, patterns…"
							aria-label="Search design system"
							disabled
							className="h-8 pl-8 text-sm"
						/>
					</div>
					<div className="ml-auto flex items-center gap-3">
						<Link
							href="/"
							className="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Back to app
						</Link>
						<ThemeModeToggle />
					</div>
				</div>
			</header>
			<div className="flex flex-1">
				<aside className="hidden w-60 shrink-0 border-r md:block">
					<div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto">
						<DesignSidebar />
					</div>
				</aside>
				<main className="flex-1 px-6 py-8 md:px-10 md:py-10">
					<div className="mx-auto w-full max-w-5xl">{children}</div>
				</main>
			</div>
		</div>
	);
}
