"use client";

/**
 * Top-N expensive sessions lens (#211).
 *
 * Companion to the per-card delivery lens — sessions are the unit closest
 * to "what one Claude Code run cost," and for projects with weak card-
 * attribution discipline they're the more honest unit. Now that the
 * Attribution Engine (#269) writes `cardId` deterministically, each row
 * also surfaces the attributed card so the user can pivot from session
 * cost to "which work drove that cost."
 *
 * Tight v1: no period pills (the Costs page doesn't have any yet),
 * no per-model cost split (a fold-out for a follow-up if asked).
 * Hidden when there are zero sessions.
 */

import { SectionHelpLink } from "@/components/costs/section-help-link";
import { formatCost } from "@/lib/format-cost";
import { formatRelativeCompact } from "@/lib/format-date";
import type { RouterOutputs } from "@/trpc/react";

type TopSessions = RouterOutputs["tokenUsage"]["getTopSessions"];

type TopSessionsSectionProps = {
	topSessions: TopSessions;
	projectId: string;
};

export function TopSessionsSection({ topSessions, projectId }: TopSessionsSectionProps) {
	if (topSessions.length === 0) return null;

	return (
		<section className="space-y-3">
			<header>
				<div className="flex items-center gap-1.5">
					<h2 className="text-sm font-medium">Top sessions by cost</h2>
					<SectionHelpLink anchor="top-sessions" label="How are top sessions calculated?" />
				</div>
				<p className="text-2xs text-muted-foreground">
					The {topSessions.length === 1 ? "session" : `${topSessions.length} sessions`} that
					accounted for the most spend. Click an attributed card to dive in.
				</p>
			</header>

			<div className="overflow-hidden rounded-md border">
				<table className="w-full text-sm">
					<thead className="bg-muted/40">
						<tr className="text-2xs uppercase tracking-wide text-muted-foreground">
							<th className="px-3 py-2 text-left font-medium">Session</th>
							<th className="px-3 py-2 text-left font-medium">Model</th>
							<th className="px-3 py-2 text-left font-medium">Card</th>
							<th className="px-3 py-2 text-right font-medium">Cost</th>
							<th className="px-3 py-2 text-right font-medium">When</th>
						</tr>
					</thead>
					<tbody>
						{topSessions.map((s) => (
							<tr key={s.sessionId} className="border-t">
								<td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
									{shortSessionId(s.sessionId)}
								</td>
								<td className="px-3 py-2 text-xs">{shortModel(s.primaryModel)}</td>
								<td className="px-3 py-2 text-xs">
									{s.cardRef && s.cardId ? (
										<a
											href={`/projects/${projectId}/cards/${s.cardId}`}
											className="text-primary underline-offset-2 hover:underline"
											title={s.cardTitle ?? undefined}
										>
											{s.cardRef}
										</a>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</td>
								<td className="px-3 py-2 text-right font-mono tabular-nums">
									{formatCost(s.totalCostUsd)}
								</td>
								<td className="px-3 py-2 text-right text-2xs text-muted-foreground">
									{formatRelativeCompact(s.mostRecentAt)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

// Most session UUIDs are unwieldy in a table cell; first 8 chars are enough
// to disambiguate within a project's lifetime (collision space is 16^8 ≈
// 4 billion, vs. expected lifetime session counts in the low thousands).
function shortSessionId(id: string): string {
	return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// Anthropic model names are long ("claude-opus-4-7", "claude-sonnet-4-6").
// Strip the `claude-` prefix for the lens table — the family is implied by
// context, the variant + version is what the user is scanning for.
function shortModel(model: string): string {
	return model.replace(/^claude-/, "");
}
