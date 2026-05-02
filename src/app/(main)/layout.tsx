"use client";

import { CommandPaletteProvider } from "@/components/command-palette";
import { TopNav } from "@/components/layout/top-nav";

export default function MainLayout({ children }: { children: React.ReactNode }) {
	return (
		<CommandPaletteProvider>
			<div className="flex min-h-dvh flex-col">
				<TopNav />
				<main className="flex-1">{children}</main>
			</div>
		</CommandPaletteProvider>
	);
}
