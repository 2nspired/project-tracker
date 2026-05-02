import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { BreakpointIndicator } from "@/components/dev/breakpoint-indicator";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TRPCReactProvider } from "@/trpc/react";

import "./globals.css";

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export const metadata: Metadata = {
	metadataBase: new URL("http://localhost:3100"),
	title: {
		template: "%s - Pigeon",
		default: "Pigeon",
	},
	description:
		"Pigeon carries context between your AI sessions. A local-first kanban board with MCP integration for AI-assisted development.",
	openGraph: {
		title: "Pigeon",
		description:
			"Local-first kanban board with MCP integration. Carries context between AI coding sessions.",
		type: "website",
		siteName: "Pigeon",
	},
	twitter: {
		card: "summary_large_image",
		title: "Pigeon",
		description:
			"Local-first kanban board with MCP integration. Carries context between AI coding sessions.",
	},
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${geist.variable} antialiased`} suppressHydrationWarning>
			<body className="min-h-dvh bg-background">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<TRPCReactProvider>
						<TooltipProvider delayDuration={500}>
							{children}
							<Toaster />
						</TooltipProvider>
					</TRPCReactProvider>
				</ThemeProvider>
				<BreakpointIndicator />
			</body>
		</html>
	);
}
