"use client";

import { BookOpen } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/command-palette";
import { McpCatalogTrigger } from "@/components/header/mcp-catalog-trigger";
import { ServerStatusPill } from "@/components/layout/server-status-pill";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const DOCS_URL = "https://2nspired.github.io/pigeon/quickstart/";

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
					<Tooltip>
						<TooltipTrigger asChild>
							<a
								href={DOCS_URL}
								target="_blank"
								rel="noopener noreferrer"
								aria-label="Open Pigeon documentation"
								className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground sm:h-auto sm:w-auto sm:gap-1.5 sm:px-2 sm:py-1 sm:text-xs"
							>
								<BookOpen className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
								<span className="hidden sm:inline">Docs</span>
							</a>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={6}>
							Open documentation on GitHub
						</TooltipContent>
					</Tooltip>
					<ServerStatusPill />
					<ThemeToggle />
				</div>
			</header>
			<main className="flex-1">{children}</main>
			<CommandPalette />
		</div>
	);
}
