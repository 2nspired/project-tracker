// Pure-function validation helpers for the pricing override "Add model" UI.
// Extracted into a sibling module so the component can stay rendering-focused
// and the validation rules get exhaustive Vitest coverage without bringing
// up React Testing Library + tRPC mocks for every edge case.
//
// Rules (verbatim from card #193 step 5):
//   1. Identifiers normalize to **lowercase** before persisting.
//   2. Reject duplicates against built-in defaults, current overrides, and
//      other in-progress add-model rows (case-insensitive — comparison is on
//      the normalized name).
//   3. Reject empty names with a stable copy.
//   4. Format must match `^[a-z0-9][a-z0-9-_.]*$` post-normalization, so a
//      user typing `gpt 4` or `Anthropic/Claude` gets a clear error rather
//      than a silently-broken row.
//
// Returning a tagged-union `ValidationResult` lets the component branch on
// `kind` and render the appropriate inline copy without sprinkling string
// matching across the JSX.

const MODEL_NAME_FORMAT = /^[a-z0-9][a-z0-9\-_.]*$/;

export type ValidationOk = { kind: "ok"; normalized: string };
export type ValidationErr = {
	kind: "err";
	code: "empty" | "format" | "duplicate-default" | "duplicate-override" | "duplicate-row";
	message: string;
};
export type ValidationResult = ValidationOk | ValidationErr;

export type ValidateModelNameInput = {
	/** Raw user input — leading/trailing whitespace is trimmed before validating. */
	rawName: string;
	/** Keys of the built-in `DEFAULT_PRICING` (excluding `__default__`). */
	defaultModelKeys: readonly string[];
	/** Keys of the persisted `AppSettings.tokenPricing` overrides. */
	overrideKeys: readonly string[];
	/** Other in-progress add-model rows (their already-normalized names). */
	otherNewRowNames: readonly string[];
};

// Normalize → check format → check each duplicate bucket in turn. The order
// matters for the error copy: a `Gpt-4o` (uppercase) input that matches a
// default after normalization is reported as "duplicate-default", not a
// format error, because the *intent* was to rename a known model — we want
// the user redirected to the existing row, not told to try lowercase.
export function validateNewModelName(input: ValidateModelNameInput): ValidationResult {
	const trimmed = input.rawName.trim();
	if (trimmed.length === 0) {
		return { kind: "err", code: "empty", message: "Model name is required." };
	}

	const normalized = trimmed.toLowerCase();

	// Duplicate checks come first so `GPT-4o` → `gpt-4o` is reported as a dup.
	const defaultSet = new Set(input.defaultModelKeys.map((k) => k.toLowerCase()));
	if (defaultSet.has(normalized)) {
		return {
			kind: "err",
			code: "duplicate-default",
			message: `Model '${normalized}' already exists. Edit the existing row above instead.`,
		};
	}

	const overrideSet = new Set(input.overrideKeys.map((k) => k.toLowerCase()));
	if (overrideSet.has(normalized)) {
		return {
			kind: "err",
			code: "duplicate-override",
			message: `Model '${normalized}' already exists. Edit the existing row above instead.`,
		};
	}

	const otherRows = new Set(input.otherNewRowNames.map((k) => k.toLowerCase()));
	if (otherRows.has(normalized)) {
		return {
			kind: "err",
			code: "duplicate-row",
			message: `Model '${normalized}' already exists. Edit the existing row above instead.`,
		};
	}

	if (!MODEL_NAME_FORMAT.test(normalized)) {
		return {
			kind: "err",
			code: "format",
			message:
				"Model name must start with a letter or digit and use only lowercase letters, digits, '-', '_', or '.'.",
		};
	}

	return { kind: "ok", normalized };
}

// Defensive coercion for rate inputs. The HTML5 `min=0` + `step=0.001`
// already blocks negatives at the browser layer, but `updatePricing` writes
// straight into `AppSettings.tokenPricing` JSON — a stale form state or a
// programmatic event could still smuggle a NaN/negative through. We map
// everything non-finite or negative to 0 so the persisted JSON always has
// the same shape `resolvePricing` expects.
//
// Empty string → 0 by spec ("If any rate is empty, store as 0"). The
// `resolvePricing` `numericOr` fallback would still recover via defaults,
// but we persist explicit zeros so saved overrides round-trip identically.
export function coerceRateValue(raw: string | number | undefined | null): number {
	if (raw === undefined || raw === null) return 0;
	if (typeof raw === "number") {
		return Number.isFinite(raw) && raw >= 0 ? raw : 0;
	}
	const trimmed = raw.trim();
	if (trimmed === "") return 0;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
