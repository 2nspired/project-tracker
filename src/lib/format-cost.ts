// Cost formatting shared between TokenCostChip (per-card/session/project chip)
// and the BoardPulse strip (project-level rollup). 4 significant figures so a
// $0.0042 value doesn't round to $0.00 and look like nothing happened.

export function formatCost(value: number): string {
	if (value >= 100) return `$${value.toFixed(0)}`;
	if (value >= 1) return `$${value.toFixed(2)}`;
	if (value >= 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toPrecision(2)}`;
}
