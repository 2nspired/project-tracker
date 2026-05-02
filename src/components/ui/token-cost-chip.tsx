import { Badge } from "@/components/ui/badge";
import { formatCost } from "@/lib/format-cost";
import { cn } from "@/lib/utils";

type TokenCostChipProps = {
	costUsd: number | null | undefined;
	sessionCount?: number;
	className?: string;
	variant?: "outline" | "secondary";
};

// Compact dollar-cost pill for token usage. Renders nothing when there's no
// data — projects without the Stop hook configured shouldn't see a $0 badge.
// 4 significant figures so a $0.0042 chip doesn't round to $0.00 and look
// like nothing happened.
export function TokenCostChip({
	costUsd,
	sessionCount,
	className,
	variant = "outline",
}: TokenCostChipProps) {
	if (costUsd === null || costUsd === undefined || costUsd === 0) return null;

	const formatted = formatCost(costUsd);
	const tooltip =
		typeof sessionCount === "number"
			? `${formatted} across ${sessionCount} session${sessionCount === 1 ? "" : "s"}`
			: formatted;

	return (
		<Badge
			variant={variant}
			title={tooltip}
			className={cn("font-mono text-2xs tabular-nums", className)}
		>
			{formatted}
		</Badge>
	);
}
