"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";

const RELEASES_URL = "https://github.com/2nspired/pigeon/releases/latest";

export function ServerStatusPill() {
	const { data } = api.system.info.useQuery(undefined, {
		refetchOnWindowFocus: true,
		staleTime: 60_000,
	});
	const [host, setHost] = useState<string | null>(null);
	const [origin, setOrigin] = useState<string | null>(null);

	useEffect(() => {
		setHost(window.location.host);
		setOrigin(window.location.origin);
	}, []);

	const { data: versionCheck } = api.system.versionCheck.useQuery(undefined, {
		staleTime: 1000 * 60 * 60 * 6,
		refetchOnWindowFocus: false,
	});

	if (!data) return null;

	const isOutdated = versionCheck?.isOutdated === true;
	const latest = versionCheck?.latest ?? null;

	const href = isOutdated ? RELEASES_URL : (origin ?? "#");
	const ariaLabel = isOutdated
		? `New version v${latest ?? ""} available — view release notes`
		: undefined;

	const tooltipText = isOutdated
		? `New version v${latest ?? ""} available — click to view release notes`
		: host
			? `Server up · v${data.version} · ${host}`
			: `Server up · v${data.version}`;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<a
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={ariaLabel}
					className="hidden items-center gap-1.5 rounded-full border bg-background/50 px-2 py-0.5 font-mono text-2xs text-muted-foreground sm:inline-flex"
				>
					{isOutdated ? (
						<span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
					) : null}
					<span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
					<span>v{data.version}</span>
					{host ? (
						<>
							<span className="opacity-60">·</span>
							<span>{host}</span>
						</>
					) : null}
				</a>
			</TooltipTrigger>
			<TooltipContent>{tooltipText}</TooltipContent>
		</Tooltip>
	);
}
