"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/trpc/react";

const DISMISSED_VERSION_KEY = "pigeon:upgrade-dismissed-version";

/**
 * "What's new in v{version}" strip rendered above `<BoardPulse>` (#210 PR-B).
 *
 * Reads the running server version from `system.info` and the matching
 * CHANGELOG section from `system.releaseNotes`. Renders the section body
 * via the shared `<Markdown>` component so formatting matches every other
 * markdown surface (card descriptions, comments, handoffs).
 *
 * Dismissal is keyed on the version string in localStorage. If the user
 * dismisses for v6.1.0, then `service:update` bumps to v6.2.0, the stored
 * value no longer matches the running version → panel reappears with the
 * v6.2.0 notes. We use `!==` rather than semver `>` deliberately: a user
 * who downgrades is in a weird state by definition and showing the older
 * notes is not load-bearing — keeping the comparison off the client
 * bundle is worth more than that edge case.
 */
export function UpgradePanel() {
	const { data: info } = api.system.info.useQuery(undefined, {
		staleTime: 60_000,
	});

	const currentVersion = info?.version ?? null;

	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		try {
			setDismissedVersion(window.localStorage.getItem(DISMISSED_VERSION_KEY));
		} catch {
			// Private mode / disabled storage — treat as never-dismissed.
			setDismissedVersion(null);
		}
		setHydrated(true);
	}, []);

	const shouldShow = hydrated && currentVersion !== null && currentVersion !== dismissedVersion;

	const { data: notes } = api.system.releaseNotes.useQuery(
		{ version: currentVersion ?? "" },
		{
			enabled: shouldShow && currentVersion !== null,
			staleTime: 1000 * 60 * 60, // 1h — server caches forever within a process
		}
	);

	if (!shouldShow || !notes?.body) return null;

	function handleDismiss() {
		if (!currentVersion) return;
		try {
			window.localStorage.setItem(DISMISSED_VERSION_KEY, currentVersion);
		} catch {
			// no-op — degrade silently when storage is unavailable
		}
		setDismissedVersion(currentVersion);
	}

	return (
		<aside
			className="flex items-start gap-3 border-b bg-violet-500/[0.06] px-4 py-2.5 text-xs"
			aria-label="Release notes"
		>
			<span className="mt-0.5 flex shrink-0 items-center gap-2 font-medium text-foreground">
				<Sparkles className="h-3.5 w-3.5 text-violet-500" />
				What's new in v{currentVersion}
			</span>
			<div className="min-w-0 flex-1 text-muted-foreground">
				<Markdown>{notes.body}</Markdown>
			</div>
			<button
				type="button"
				onClick={handleDismiss}
				aria-label="Dismiss release notes"
				className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</aside>
	);
}
