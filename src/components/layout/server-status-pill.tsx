"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/trpc/react";

const RELEASES_URL = "https://github.com/2nspired/pigeon/releases/latest";

export function ServerStatusPill() {
	const { data } = api.system.info.useQuery(undefined, {
		refetchOnWindowFocus: true,
		staleTime: 60_000,
	});

	const { data: versionCheck } = api.system.versionCheck.useQuery(undefined, {
		staleTime: 1000 * 60 * 60 * 6,
		refetchOnWindowFocus: false,
	});

	if (!data) return null;

	const isOutdated = versionCheck?.isOutdated === true;
	const latest = versionCheck?.latest ?? null;

	const pill = (
		<div className="hidden items-center gap-1.5 rounded-full border bg-background/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
			{isOutdated ? (
				<span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
			) : null}
			<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
			<span>v{data.version}</span>
			<span className="opacity-60">·</span>
			<span>{data.mode}</span>
		</div>
	);

	const trigger = isOutdated ? (
		<a
			href={RELEASES_URL}
			target="_blank"
			rel="noreferrer noopener"
			aria-label={`New version v${latest ?? ""} available — view release notes`}
		>
			{pill}
		</a>
	) : (
		pill
	);

	const tooltipText = isOutdated
		? `New version v${latest ?? ""} available — click to view release notes`
		: `Server up · v${data.version} (${data.mode})`;

	return (
		<Tooltip>
			<TooltipTrigger asChild>{trigger}</TooltipTrigger>
			<TooltipContent>{tooltipText}</TooltipContent>
		</Tooltip>
	);
}
