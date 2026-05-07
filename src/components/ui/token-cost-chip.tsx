import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/format-usd";
import { cn } from "@/lib/utils";

type TokenCostChipProps = {
	costUsd: number | null | undefined;
	sessionCount?: number;
	className?: string;
	variant?: "outline" | "secondary";
};

// Compact dollar-cost pill for token usage. Renders nothing when there's no
// data — projects without the Stop hook configured shouldn't see a $0 badge.
// `formatUsd`'s default magnitude buckets (#295) keep micro-costs ($0.0042)
// readable while still collapsing big totals into compact `$12.5K` form.
export function TokenCostChip({
	costUsd,
	sessionCount,
	className,
	variant = "outline",
}: TokenCostChipProps) {
	if (costUsd === null || costUsd === undefined || costUsd === 0) return null;

	const formatted = formatUsd(costUsd);
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
