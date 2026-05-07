// Per-model energy coefficients (watt-hours per token) and a single
// world-average grid-intensity constant. Mirrors the shape and conventions
// of `token-pricing-defaults.ts`: hardcoded defaults with per-row citations,
// an `_LAST_VERIFIED` stamp the UI nudges against, and a fallback row for
// unknown models that returns zero rather than a guess.
//
// Estimates only. Token-derived energy is approximate by ~±50% — see
// `docs/ENERGY-METHODOLOGY.md` for the assumptions, sources, and override
// path. We deliberately model only `inputTokens` and `outputTokens`;
// cache-read tokens are loaded without a forward pass and are effectively
// free, and cache-creation tokens are within an input-token-of-magnitude
// (the simplification is documented).

export type EnergyCoefficient = {
	wattHoursPerInputToken: number;
	wattHoursPerOutputToken: number;
	source: string;
	citationUrl: string;
};

export const COEFFICIENTS_LAST_VERIFIED = "2026-05";

// Single world-average grid intensity, per IEA 2024 (Electricity 2024
// Analysis and Forecast to 2026). Per-region selection is deferred — see
// the out-of-scope notes on card #180.
export const WORLD_AVG_GCO2_PER_KWH = 475;
export const GRID_INTENSITY_SOURCE = "IEA 2024 — world average grid intensity";
export const GRID_INTENSITY_CITATION_URL = "https://www.iea.org/reports/electricity-2024";

// Per-model coefficients. Anchored on the de Vries (2023, Joule), Luccioni
// et al. (Hugging Face AI Energy Score, 2024), and Strubell et al. (2019)
// public-research families, scaled by relative parameter count where the
// frontier-model figures aren't directly published. Output tokens cost ~10×
// input tokens because autoregressive decoding runs one forward pass per
// emitted token.
const DEFAULT_COEFFICIENTS_INTERNAL: Record<string, EnergyCoefficient> = {
	// Anthropic — Opus-class (frontier). Anchored on de Vries' ~3 Wh per
	// long ChatGPT-class response, scaled for a model in Opus's parameter
	// range. Anthropic has not published per-token figures.
	"claude-opus-4-7": {
		wattHoursPerInputToken: 0.0005,
		wattHoursPerOutputToken: 0.005,
		source: "de Vries 2023 (Joule), scaled for Opus-class parameter count",
		citationUrl: "https://doi.org/10.1016/j.joule.2023.09.004",
	},
	"claude-opus-4-6": {
		wattHoursPerInputToken: 0.0005,
		wattHoursPerOutputToken: 0.005,
		source: "de Vries 2023 (Joule), scaled for Opus-class parameter count",
		citationUrl: "https://doi.org/10.1016/j.joule.2023.09.004",
	},
	// Anthropic — Sonnet-class (mid-tier). ~3× cheaper than Opus per
	// Anthropic's published price ratio, used as a parameter-count proxy.
	"claude-sonnet-4-6": {
		wattHoursPerInputToken: 0.00015,
		wattHoursPerOutputToken: 0.0015,
		source: "de Vries 2023, scaled by Anthropic Sonnet/Opus price ratio (~3×)",
		citationUrl: "https://doi.org/10.1016/j.joule.2023.09.004",
	},
	// Anthropic — Haiku-class (small). ~10× cheaper than Opus per the
	// same price-ratio proxy.
	"claude-haiku-4-5": {
		wattHoursPerInputToken: 0.00005,
		wattHoursPerOutputToken: 0.0005,
		source: "de Vries 2023, scaled by Anthropic Haiku/Opus price ratio (~10×)",
		citationUrl: "https://doi.org/10.1016/j.joule.2023.09.004",
	},
	// OpenAI — GPT-4o (mid-large). Hugging Face AI Energy Score's GPT-4-class
	// reference range; chosen at the lower end since 4o is meaningfully more
	// efficient than the original 4.
	"gpt-4o": {
		wattHoursPerInputToken: 0.0003,
		wattHoursPerOutputToken: 0.003,
		source: "Luccioni et al. 2024 (Hugging Face AI Energy Score), GPT-4-class lower-bound",
		citationUrl: "https://huggingface.co/spaces/AIEnergyScore/Leaderboard",
	},
	"gpt-4o-mini": {
		wattHoursPerInputToken: 0.00005,
		wattHoursPerOutputToken: 0.0005,
		source: "Luccioni et al. 2024 (Hugging Face AI Energy Score), small-model band",
		citationUrl: "https://huggingface.co/spaces/AIEnergyScore/Leaderboard",
	},
	"gpt-4-turbo": {
		wattHoursPerInputToken: 0.0005,
		wattHoursPerOutputToken: 0.005,
		source: "de Vries 2023, original GPT-4-class (pre-4o efficiency gains)",
		citationUrl: "https://doi.org/10.1016/j.joule.2023.09.004",
	},
	// OpenAI — o1 (reasoning). Reasoning models emit hidden chain-of-thought
	// tokens that aren't separately metered; output cost is bumped to
	// approximate the actual decode work. Treat as a ceiling, not a floor.
	o1: {
		wattHoursPerInputToken: 0.0005,
		wattHoursPerOutputToken: 0.008,
		source: "de Vries 2023, GPT-4-class with reasoning-token uplift on output",
		citationUrl: "https://doi.org/10.1016/j.joule.2023.09.004",
	},
	// Honest fallback: zero rather than a wrong guess. Mirrors the
	// `__default__` row in DEFAULT_PRICING — the UI flags unknown models
	// rather than silently inventing a number.
	__default__: {
		wattHoursPerInputToken: 0,
		wattHoursPerOutputToken: 0,
		source: "fallback for unknown models — add to defaults file to populate",
		citationUrl: "",
	},
};

export const DEFAULT_COEFFICIENTS: Readonly<Record<string, EnergyCoefficient>> =
	DEFAULT_COEFFICIENTS_INTERNAL;

// Same shape as TokenUsageInput from token-pricing-defaults.ts. Re-declared
// here so this file is import-clean from the pricing file (and vice versa).
export type EnergyTokenInput = {
	model: string;
	inputTokens: number;
	outputTokens: number;
};

export type EnergyResult = {
	wattHoursTotal: number;
	gramsCO2: number;
};

// Pure function — inputs × per-token coefficient, then convert kWh → grams CO₂
// via the world-average grid intensity. Falls back to the zero `__default__`
// row when the model has no coefficient (matches `computeCost`'s shape).
export function computeEnergy(
	event: EnergyTokenInput,
	coefficients: Record<string, EnergyCoefficient> = DEFAULT_COEFFICIENTS
): EnergyResult {
	const rates =
		coefficients[event.model] ?? coefficients.__default__ ?? DEFAULT_COEFFICIENTS.__default__;
	const wattHoursTotal =
		event.inputTokens * rates.wattHoursPerInputToken +
		event.outputTokens * rates.wattHoursPerOutputToken;
	// kWh × g/kWh = g. wattHoursTotal is in Wh, so divide by 1000 first.
	const gramsCO2 = (wattHoursTotal / 1000) * WORLD_AVG_GCO2_PER_KWH;
	return { wattHoursTotal, gramsCO2 };
}
