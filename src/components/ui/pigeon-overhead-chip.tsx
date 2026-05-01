"use client";

import { Badge } from "@/components/ui/badge";
import { formatCost } from "@/lib/format-cost";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

type PigeonOverheadChipProps = {
	/** Session whose Pigeon-tool response cost we're showing. */
	sessionId: string;
	className?: string;
	variant?: "outline" | "secondary";
};

// Compact "Pigeon: $X" pill showing the dollar cost of MCP tool *response*
// payloads on a given session (chars/4 estimator × the session model's
// `outputPerMTok`). Same visual treatment as `TokenCostChip` so the two
// chips read as a matched pair when rendered side-by-side.
//
// Self-hides when:
//   • the session has no `ToolCallLog` rows (`responseTokens > 0` filter
//     happens server-side via `callCount === 0`), or
//   • cost rounds to zero — sessions with only zero-rate models would
//     otherwise show a $0 chip that looks broken.
export function PigeonOverheadChip({
	sessionId,
	className,
	variant = "outline",
}: PigeonOverheadChipProps) {
	const { data } = api.tokenUsage.getSessionPigeonOverhead.useQuery(
		{ sessionId },
		{ enabled: !!sessionId, retry: false }
	);

	if (!data || data.callCount === 0 || data.totalCostUsd === 0) return null;

	return <Chip costUsd={data.totalCostUsd} className={className} variant={variant} />;
}

type CardPigeonOverheadChipProps = {
	cardId: string;
	className?: string;
	variant?: "outline" | "secondary";
};

// Card-scoped variant — aggregates Pigeon overhead across every session
// that touched the card. Lives next to `<TokenCostChip>` on the card
// detail sheet, where the existing chip is itself card-aggregate. Same
// visual contract as the session chip.
export function CardPigeonOverheadChip({
	cardId,
	className,
	variant = "outline",
}: CardPigeonOverheadChipProps) {
	const { data } = api.tokenUsage.getCardPigeonOverhead.useQuery(
		{ cardId },
		{ enabled: !!cardId, retry: false }
	);

	if (!data || data.callCount === 0 || data.totalCostUsd === 0) return null;

	return <Chip costUsd={data.totalCostUsd} className={className} variant={variant} />;
}

function Chip({
	costUsd,
	className,
	variant,
}: {
	costUsd: number;
	className?: string;
	variant: "outline" | "secondary";
}) {
	return (
		<Badge
			variant={variant}
			title="Pigeon tool overhead this session"
			className={cn("font-mono text-[10px] tabular-nums", className)}
		>
			Pigeon: {formatCost(costUsd)}
		</Badge>
	);
}
