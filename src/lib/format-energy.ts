// Sibling to `format-usd.ts`. Two formatters: `formatEnergy(wattHours)` and
// `formatCo2(gramsCo2)`. Both pick a unit bucket by magnitude so a Haiku
// session (a fraction of a Wh) and a project-lifetime total (a few kWh) both
// render readably without the caller managing units.
//
// Energy buckets:
//   < 1 Wh    → 4 decimals  (`0.0042 Wh`)
//   1–1K Wh   → 1 decimal   (`12.3 Wh`)
//   1K–1M Wh  → 2 decimals in kWh  (`1.23 kWh`)
//   ≥ 1M Wh   → 2 decimals in MWh  (`1.40 MWh`)
//
// CO₂ buckets (the "g CO₂" suffix renders the subscript ₂ literally):
//   < 1 g     → 3 decimals (`0.420 g CO₂`)
//   1–1K g    → 1 decimal  (`12.3 g CO₂`)
//   1K–1M g   → 2 decimals in kg  (`1.23 kg CO₂`)
//   ≥ 1M g    → 2 decimals in tonnes (`1.40 t CO₂`)
//
// NaN / Infinity → `"—"` (matches `formatUsd`'s no-data sentinel).

const NO_DATA_SENTINEL = "—";
const CO2_SUFFIX = " g CO₂"; // CO₂ — explicit codepoint for grep-friendliness

type FormatOptions = {
	/** Force compact (no decimal padding) — useful for tight chip surfaces. */
	compact?: boolean;
};

export function formatEnergy(wattHours: number, opts: FormatOptions = {}): string {
	if (!Number.isFinite(wattHours)) return NO_DATA_SENTINEL;
	const abs = Math.abs(wattHours);
	const sign = wattHours < 0 ? "-" : "";
	const { compact } = opts;

	if (abs >= 1_000_000) {
		const mwh = wattHours / 1_000_000;
		return `${formatNumber(mwh, compact ? 1 : 2)} MWh`;
	}
	if (abs >= 1_000) {
		const kwh = wattHours / 1_000;
		return `${formatNumber(kwh, compact ? 1 : 2)} kWh`;
	}
	if (abs >= 1) {
		return `${formatNumber(wattHours, 1)} Wh`;
	}
	if (wattHours === 0) {
		return "0 Wh";
	}
	// Sub-Wh — keep 4 decimals so a single Haiku call doesn't render as "0 Wh"
	return `${sign}${Math.abs(wattHours).toFixed(4)} Wh`;
}

export function formatCo2(gramsCo2: number, opts: FormatOptions = {}): string {
	if (!Number.isFinite(gramsCo2)) return NO_DATA_SENTINEL;
	const abs = Math.abs(gramsCo2);
	const sign = gramsCo2 < 0 ? "-" : "";
	const { compact } = opts;

	if (abs >= 1_000_000) {
		const tonnes = gramsCo2 / 1_000_000;
		return `${formatNumber(tonnes, compact ? 1 : 2)} t CO₂`;
	}
	if (abs >= 1_000) {
		const kg = gramsCo2 / 1_000;
		return `${formatNumber(kg, compact ? 1 : 2)} kg CO₂`;
	}
	if (abs >= 1) {
		return `${formatNumber(gramsCo2, 1)}${CO2_SUFFIX}`;
	}
	if (gramsCo2 === 0) {
		return `0${CO2_SUFFIX}`;
	}
	return `${sign}${Math.abs(gramsCo2).toFixed(3)}${CO2_SUFFIX}`;
}

function formatNumber(value: number, decimals: number): string {
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	}).format(value);
}
