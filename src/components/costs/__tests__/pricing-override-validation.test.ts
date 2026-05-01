// Locking tests for the pricing-override Add-Model validation helpers
// (#193 step 5). These rules are part of the wire contract for the
// `tokenUsage.updatePricing` mutation: a saved row's identifier MUST be
// lowercase + alphanumeric (plus `-_.`), MUST NOT collide with a built-in
// default or an existing override, and MUST NOT be empty. Regressing any
// of these would let two pricing rows with the same effective key into
// `AppSettings.tokenPricing`, where `resolvePricing` would silently keep
// only the last-iterated one.
import { describe, expect, it } from "vitest";

import {
	coerceRateValue,
	validateNewModelName,
} from "@/components/costs/pricing-override-validation";

const DEFAULTS = ["claude-opus-4-7", "gpt-4o", "o1"] as const;

describe("validateNewModelName — normalization", () => {
	it("lowercases mixed-case input on success", () => {
		const result = validateNewModelName({
			rawName: "MY-Custom.Model",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.normalized).toBe("my-custom.model");
		}
	});

	it("trims surrounding whitespace before normalizing", () => {
		const result = validateNewModelName({
			rawName: "  some-Model  ",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.normalized).toBe("some-model");
		}
	});
});

describe("validateNewModelName — empty rejection", () => {
	it("rejects an empty string", () => {
		const result = validateNewModelName({
			rawName: "",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("empty");
			expect(result.message).toBe("Model name is required.");
		}
	});

	it("rejects whitespace-only input", () => {
		const result = validateNewModelName({
			rawName: "   ",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("empty");
		}
	});
});

describe("validateNewModelName — duplicate detection", () => {
	it("rejects an exact match against a default key", () => {
		const result = validateNewModelName({
			rawName: "gpt-4o",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("duplicate-default");
		}
	});

	it("rejects a case-mismatched default (GPT-4o → gpt-4o)", () => {
		const result = validateNewModelName({
			rawName: "GPT-4o",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("duplicate-default");
			expect(result.message).toContain("gpt-4o");
		}
	});

	it("rejects a case-mismatched override (CUSTOM-MODEL vs custom-model)", () => {
		const result = validateNewModelName({
			rawName: "CUSTOM-MODEL",
			defaultModelKeys: DEFAULTS,
			overrideKeys: ["custom-model"],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("duplicate-override");
		}
	});

	it("rejects a duplicate against an in-progress add-model row", () => {
		const result = validateNewModelName({
			rawName: "Foo-Model",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: ["foo-model"],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("duplicate-row");
		}
	});

	it("prefers duplicate-default over format error when both fail", () => {
		// `GPT-4o` would fail the format regex (uppercase) AND match a default
		// after normalization. We surface the duplicate copy because that's
		// the actionable path for the user — not "use lowercase".
		const result = validateNewModelName({
			rawName: "GPT-4o",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("duplicate-default");
		}
	});
});

describe("validateNewModelName — format rejection", () => {
	it("rejects a model name with a space", () => {
		const result = validateNewModelName({
			rawName: "gpt 4",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("format");
		}
	});

	it("rejects a model name starting with a hyphen", () => {
		const result = validateNewModelName({
			rawName: "-foo",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("format");
		}
	});

	it("rejects a model name with a forward slash", () => {
		const result = validateNewModelName({
			rawName: "anthropic/claude",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("err");
		if (result.kind === "err") {
			expect(result.code).toBe("format");
		}
	});

	it("accepts dot, underscore, and hyphen", () => {
		const result = validateNewModelName({
			rawName: "claude-opus-4.7_test",
			defaultModelKeys: DEFAULTS,
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("ok");
	});

	it("accepts a single-character alphanumeric name", () => {
		const result = validateNewModelName({
			rawName: "o1",
			defaultModelKeys: ["claude-opus-4-7"],
			overrideKeys: [],
			otherNewRowNames: [],
		});
		expect(result.kind).toBe("ok");
	});
});

describe("coerceRateValue", () => {
	it("returns 0 for empty string", () => {
		expect(coerceRateValue("")).toBe(0);
	});

	it("returns 0 for whitespace-only string", () => {
		expect(coerceRateValue("   ")).toBe(0);
	});

	it("parses a numeric string", () => {
		expect(coerceRateValue("3.5")).toBe(3.5);
	});

	it("returns 0 for negative input (defensive against bypassed HTML5 min)", () => {
		expect(coerceRateValue("-1")).toBe(0);
		expect(coerceRateValue(-1)).toBe(0);
	});

	it("returns 0 for non-numeric string", () => {
		expect(coerceRateValue("abc")).toBe(0);
	});

	it("returns 0 for NaN / Infinity", () => {
		expect(coerceRateValue(Number.NaN)).toBe(0);
		expect(coerceRateValue(Number.POSITIVE_INFINITY)).toBe(0);
	});

	it("passes through a finite non-negative number", () => {
		expect(coerceRateValue(7.25)).toBe(7.25);
		expect(coerceRateValue(0)).toBe(0);
	});

	it("returns 0 for null / undefined", () => {
		expect(coerceRateValue(null)).toBe(0);
		expect(coerceRateValue(undefined)).toBe(0);
	});
});
