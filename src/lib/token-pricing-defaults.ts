// Provider-agnostic per-million-token pricing. Anthropic populates all five
// fields; OpenAI sessions store 0 for the cacheCreation columns (its caching
// is automatic and free at write time). The 5-column split preserves
// Anthropic pricing fidelity (1h cache write ≈ 2× input, 5m ≈ 1.25× input);
// lumping would lose precision when users adjust pricing later.

export type ModelPricing = {
	inputPerMTok: number;
	outputPerMTok: number;
	cacheReadPerMTok: number;
	cacheCreation1hPerMTok: number;
	cacheCreation5mPerMTok: number;
};

// Stale defaults are still useful but should be visibly stale. The settings
// UI surfaces this to nudge re-verification against the provider's pricing
// page.
export const PRICING_LAST_VERIFIED = "2026-04";

const DEFAULT_PRICING_INTERNAL: Record<string, ModelPricing> = {
	// Anthropic — full five-column fidelity
	"claude-opus-4-7": {
		inputPerMTok: 15,
		outputPerMTok: 75,
		cacheReadPerMTok: 1.5,
		cacheCreation1hPerMTok: 30,
		cacheCreation5mPerMTok: 18.75,
	},
	"claude-opus-4-6": {
		inputPerMTok: 15,
		outputPerMTok: 75,
		cacheReadPerMTok: 1.5,
		cacheCreation1hPerMTok: 30,
		cacheCreation5mPerMTok: 18.75,
	},
	"claude-sonnet-4-6": {
		inputPerMTok: 3,
		outputPerMTok: 15,
		cacheReadPerMTok: 0.3,
		cacheCreation1hPerMTok: 6,
		cacheCreation5mPerMTok: 3.75,
	},
	"claude-haiku-4-5": {
		inputPerMTok: 1,
		outputPerMTok: 5,
		cacheReadPerMTok: 0.1,
		cacheCreation1hPerMTok: 2,
		cacheCreation5mPerMTok: 1.25,
	},
	// OpenAI — caching is automatic, so cache-creation rates are 0
	"gpt-4o": {
		inputPerMTok: 2.5,
		outputPerMTok: 10,
		cacheReadPerMTok: 1.25,
		cacheCreation1hPerMTok: 0,
		cacheCreation5mPerMTok: 0,
	},
	"gpt-4o-mini": {
		inputPerMTok: 0.15,
		outputPerMTok: 0.6,
		cacheReadPerMTok: 0.075,
		cacheCreation1hPerMTok: 0,
		cacheCreation5mPerMTok: 0,
	},
	"gpt-4-turbo": {
		inputPerMTok: 10,
		outputPerMTok: 30,
		cacheReadPerMTok: 0,
		cacheCreation1hPerMTok: 0,
		cacheCreation5mPerMTok: 0,
	},
	o1: {
		inputPerMTok: 15,
		outputPerMTok: 60,
		cacheReadPerMTok: 7.5,
		cacheCreation1hPerMTok: 0,
		cacheCreation5mPerMTok: 0,
	},
	// Honest fallback: zero rather than a wrong guess. The UI shows a warning
	// when an event hits this; the user is expected to add the model to the
	// settings table.
	__default__: {
		inputPerMTok: 0,
		outputPerMTok: 0,
		cacheReadPerMTok: 0,
		cacheCreation1hPerMTok: 0,
		cacheCreation5mPerMTok: 0,
	},
};

export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = DEFAULT_PRICING_INTERNAL;

export type TokenUsageInput = {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreation1hTokens: number;
	cacheCreation5mTokens: number;
};

// Sums all five token classes × their per-million rate. Falls back to
// __default__ (zeros) if the model isn't priced — produces 0 instead of NaN
// or a bogus number.
export function computeCost(event: TokenUsageInput, pricing: Record<string, ModelPricing>): number {
	const rates = pricing[event.model] ?? pricing.__default__ ?? DEFAULT_PRICING.__default__;
	return (
		(event.inputTokens * rates.inputPerMTok +
			event.outputTokens * rates.outputPerMTok +
			event.cacheReadTokens * rates.cacheReadPerMTok +
			event.cacheCreation1hTokens * rates.cacheCreation1hPerMTok +
			event.cacheCreation5mTokens * rates.cacheCreation5mPerMTok) /
		1_000_000
	);
}

// Merges user-overridden rates over defaults. Fail-soft: a malformed JSON
// blob in AppSettings returns DEFAULT_PRICING — we'd rather underprice than
// crash a briefMe call.
export function resolvePricing(
	storedJson: string | null | undefined
): Record<string, ModelPricing> {
	if (!storedJson) return { ...DEFAULT_PRICING };
	try {
		const parsed = JSON.parse(storedJson) as unknown;
		if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PRICING };
		const overrides = parsed as Record<string, Partial<ModelPricing>>;
		const merged: Record<string, ModelPricing> = { ...DEFAULT_PRICING };
		for (const [model, partial] of Object.entries(overrides)) {
			const base = merged[model] ?? merged.__default__;
			merged[model] = {
				inputPerMTok: numericOr(partial.inputPerMTok, base.inputPerMTok),
				outputPerMTok: numericOr(partial.outputPerMTok, base.outputPerMTok),
				cacheReadPerMTok: numericOr(partial.cacheReadPerMTok, base.cacheReadPerMTok),
				cacheCreation1hPerMTok: numericOr(
					partial.cacheCreation1hPerMTok,
					base.cacheCreation1hPerMTok
				),
				cacheCreation5mPerMTok: numericOr(
					partial.cacheCreation5mPerMTok,
					base.cacheCreation5mPerMTok
				),
			};
		}
		return merged;
	} catch {
		return { ...DEFAULT_PRICING };
	}
}

function numericOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
