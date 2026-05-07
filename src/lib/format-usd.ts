// One USD formatter for every money-rendering surface in the app (#295).
//
// Built on `Intl.NumberFormat('en-US', { currency: 'USD' })` so locale-aware
// separators (`$1,234`, `$12.5K`) come for free without hand-rolled string
// concatenation. Pre-#295 the codebase had two independent helpers (`formatCost`
// in `src/lib/format-cost.ts` and a private `formatCost` in `src/lib/services/
// cost-export.ts`) plus ad-hoc `${value.toFixed(2)}` sites — they disagreed on
// where to break, whether to comma-separate, and what to do with NaN.
// Standardizing here means the Costs page, BoardPulse, chips, and tooltips all
// stay readable at every magnitude.
//
// Default magnitude buckets (no opts) — chosen for cost-tracking surfaces
// where micro-amounts ($0.0042 / Haiku call) sit alongside macro totals
// ($1.4M project-lifetime):
//
//   < $1     → 4 decimals  ($0.0042)   so sub-cent costs don't round to $0.00
//   $1–$1K   → 2 decimals  ($3.45, $123.45)
//   $1K–$10K → 0 decimals  ($3,023, $9,481)   thousands separator readable
//   ≥ $10K   → compact, 1 decimal  ($12.5K, $1.4M)
//
// Negatives keep their sign (Intl handles `-$3.45` natively). Zero renders as
// `$0.00`. NaN / Infinity → "—" (em-dash, the project's standard "no data"
// sentinel — matches the `formatRelative(null)` and `formatBoardShare`
// pre-zero-denominator behavior).

type FormatUsdOptions = {
	/** Force compact notation (`$0.42`, `$1.2K`) regardless of magnitude. Useful for tight chip surfaces. */
	compact?: boolean;
	/** Override the default decimal count for the given magnitude bucket. */
	decimals?: number;
};

const NO_DATA_SENTINEL = "—";

export function formatUsd(amountUsd: number, opts: FormatUsdOptions = {}): string {
	if (!Number.isFinite(amountUsd)) return NO_DATA_SENTINEL;

	const abs = Math.abs(amountUsd);
	const { compact, decimals } = opts;

	// Compact mode — single Intl pass, default `decimals: 1` to match the
	// `≥ $10K` bucket's compact behavior. Below $1 we still want some
	// precision (`$0.42`) rather than `$0`, so when the caller passes
	// `compact: true` for a sub-$1 chip we lift to 2 decimals by default.
	// Caller's explicit `decimals` always wins.
	if (compact) {
		const compactDecimals = decimals ?? (abs < 1 ? 2 : 1);
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			notation: "compact",
			maximumFractionDigits: compactDecimals,
			minimumFractionDigits: compactDecimals,
		}).format(amountUsd);
	}

	if (abs >= 10_000) {
		const d = decimals ?? 1;
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			notation: "compact",
			maximumFractionDigits: d,
			minimumFractionDigits: d,
		}).format(amountUsd);
	}

	let bucketDecimals: number;
	if (abs >= 1_000) bucketDecimals = 0;
	else if (abs >= 1) bucketDecimals = 2;
	else if (amountUsd === 0)
		bucketDecimals = 2; // exact zero → "$0.00", not "$0.0000"
	else bucketDecimals = 4; // sub-$1 (incl. very small negatives)

	const d = decimals ?? bucketDecimals;
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: d,
		minimumFractionDigits: d,
	}).format(amountUsd);
}
