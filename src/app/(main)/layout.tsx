"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/command-palette";
import { McpCatalogTrigger } from "@/components/header/mcp-catalog-trigger";
import { ServerStatusPill } from "@/components/layout/server-status-pill";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function MainLayout({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();

	return (
		<div className="flex min-h-dvh flex-col">
			<header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
				<div className="flex h-14 items-center gap-6 px-4">
					<Link href="/" className="flex items-center gap-2 text-lg font-semibold">
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
						Pigeon
					</Link>
					<nav className="flex flex-1 items-center gap-4 text-sm">
						<Link
							href="/projects"
							className={
								pathname.startsWith("/projects")
									? "text-foreground font-medium transition-colors"
									: "text-muted-foreground transition-colors hover:text-foreground"
							}
						>
							Projects
						</Link>
						<Link
							href="/dashboard"
							className={
								pathname.startsWith("/dashboard")
									? "text-foreground font-medium transition-colors"
									: "text-muted-foreground transition-colors hover:text-foreground"
							}
						>
							Dashboard
						</Link>
						<Link
							href="/notes"
							className={
								pathname.startsWith("/notes")
									? "text-foreground font-medium transition-colors"
									: "text-muted-foreground transition-colors hover:text-foreground"
							}
						>
							Notes
						</Link>
					</nav>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={() =>
									document.dispatchEvent(
										new KeyboardEvent("keydown", {
											key: "k",
											metaKey: true,
										})
									)
								}
								className="hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent sm:flex"
							>
								Search
								<kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={6}>
							Press <kbd className="font-mono">?</kbd> for the full command catalog
						</TooltipContent>
					</Tooltip>
					<McpCatalogTrigger />
					<ServerStatusPill />
					<ThemeToggle />
				</div>
			</header>
			<main className="flex-1">{children}</main>
			<CommandPalette />
		</div>
	);
}
