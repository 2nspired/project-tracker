"use client";

/**
 * Pigeon Overhead section (#274 — revived from #236).
 *
 * Surfaces the project-wide cost the agent paid in `outputPerMTok` to
 * read Pigeon MCP tool responses. F1 (#190) added `responseTokens` on
 * `ToolCallLog`; the per-session and per-card chip variants survived
 * #236, but the project-wide rollup was dropped. Now that the
 * Attribution Engine (#268, #269) writes per-session attribution
 * deterministically, we can resurrect the rollup with the same
 * pricing-per-session-model rule the chip variants use.
 *
 * Hidden when there are zero tool calls — the section is information-
 * dense; an empty state would be noise.
 */

import { SectionHelpLink } from "@/components/costs/section-help-link";
import { formatCost } from "@/lib/format-cost";
import type { RouterOutputs } from "@/trpc/react";

type ProjectOverhead = RouterOutputs["tokenUsage"]["getProjectPigeonOverhead"];

type PigeonOverheadSectionProps = {
	overhead: ProjectOverhead;
};

export function PigeonOverheadSection({ overhead }: PigeonOverheadSectionProps) {
	if (overhead.callCount === 0) return null;

	return (
		<section className="rounded-md border bg-muted/20 px-5 py-4">
			<header className="flex items-baseline justify-between gap-4">
				<div>
					<div className="flex items-center gap-1.5">
						<h2 className="text-sm font-medium">Pigeon overhead</h2>
						<SectionHelpLink anchor="pigeon-overhead" label="How is Pigeon overhead calculated?" />
					</div>
					<p className="mt-0.5 text-2xs text-muted-foreground">
						What this project paid in `outputPerMTok` to read Pigeon's MCP tool responses. Lifetime.
					</p>
				</div>
				<div className="text-right">
					<div className="font-mono text-2xl tabular-nums">{formatCost(overhead.totalCostUsd)}</div>
					<div className="text-2xs text-muted-foreground">
						across {overhead.callCount.toLocaleString()}{" "}
						{overhead.callCount === 1 ? "tool call" : "tool calls"}
					</div>
				</div>
			</header>
		</section>
	);
}
