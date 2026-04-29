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
	title: {
		template: "%s - Project Tracker",
		default: "Project Tracker",
	},
	description: "Visual kanban board with MCP integration for AI-assisted development",
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
						<TooltipProvider>
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
