import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { BreakpointIndicator } from "@/components/dev/breakpoint-indicator";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TRPCReactProvider } from "@/trpc/react";

import "./globals.css";

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export const metadata: Metadata = {
	title: {
		template: "%s - Pigeon",
		default: "Pigeon",
	},
	description:
		"Pigeon carries context between your AI sessions. A local-first kanban board with MCP integration for AI-assisted development.",
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
						{children}
						<Toaster />
					</TRPCReactProvider>
				</ThemeProvider>
				<BreakpointIndicator />
			</body>
		</html>
	);
}
