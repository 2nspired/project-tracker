import { Badge } from "@/components/ui/badge";
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
			className={cn("font-mono text-[10px] tabular-nums", className)}
		>
			{formatted}
		</Badge>
	);
}

// Show 4 significant figures so we can distinguish $0.0042 from $0.0420.
// Drops to standard 2-decimal currency formatting once we cross $1.
function formatCost(value: number): string {
	if (value >= 100) return `$${value.toFixed(0)}`;
	if (value >= 1) return `$${value.toFixed(2)}`;
	if (value >= 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toPrecision(2)}`;
}
