"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Light / dark / system tri-state toggle for the design-system chrome.
 *
 * Distinct from the product `<ThemeToggle />` (which is a binary flip) — the
 * design-system page is the canonical place to verify all three modes, so we
 * surface them explicitly. Wired to the same `next-themes` provider mounted in
 * `RootLayout`; flipping it here flips theming for the rest of the app, which
 * is intentional (one source of truth).
 */
export function ThemeModeToggle() {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const options = [
		{ value: "light", label: "Light", Icon: Sun },
		{ value: "dark", label: "Dark", Icon: Moon },
		{ value: "system", label: "System", Icon: Laptop },
	] as const;

	return (
		<fieldset className="inline-flex items-center rounded-md border bg-background p-0.5">
			<legend className="sr-only">Theme mode</legend>
			{options.map(({ value, label, Icon }) => {
				const active = mounted && theme === value;
				return (
					<button
						key={value}
						type="button"
						aria-pressed={active}
						aria-label={label}
						title={label}
						onClick={() => setTheme(value)}
						className={cn(
							"inline-flex h-7 w-8 items-center justify-center rounded-sm transition-colors",
							active
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:text-foreground"
						)}
					>
						<Icon className="size-3.5" />
					</button>
				);
			})}
		</fieldset>
	);
}
