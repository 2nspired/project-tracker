import { describe, expect, it } from "vitest";

import { formatUsd } from "@/lib/format-usd";

describe("formatUsd — magnitude buckets (default)", () => {
	it("renders sub-$1 amounts with 4 decimals so micro-costs stay readable", () => {
		expect(formatUsd(0.0042)).toBe("$0.0042");
		expect(formatUsd(0.42)).toBe("$0.4200");
	});

	it("renders $1–$1K amounts with 2 decimals", () => {
		expect(formatUsd(3.45)).toBe("$3.45");
		expect(formatUsd(123.45)).toBe("$123.45");
		expect(formatUsd(999.99)).toBe("$999.99");
	});

	it("renders $1K–$10K amounts with 0 decimals + thousands separator", () => {
		expect(formatUsd(3023)).toBe("$3,023");
		expect(formatUsd(9481)).toBe("$9,481");
	});

	it("renders ≥$10K amounts in compact notation with 1 decimal", () => {
		expect(formatUsd(12_500)).toBe("$12.5K");
		expect(formatUsd(1_400_000)).toBe("$1.4M");
	});
});

describe("formatUsd — edge cases", () => {
	it("renders zero as $0.00 (not $0.0000)", () => {
		expect(formatUsd(0)).toBe("$0.00");
	});

	it("preserves the negative sign for losses / refunds", () => {
		expect(formatUsd(-3.45)).toBe("-$3.45");
		expect(formatUsd(-12_500)).toBe("-$12.5K");
		expect(formatUsd(-0.0042)).toBe("-$0.0042");
	});

	it("returns the em-dash sentinel for NaN", () => {
		expect(formatUsd(Number.NaN)).toBe("—");
	});

	it("returns the em-dash sentinel for Infinity / -Infinity", () => {
		expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("—");
		expect(formatUsd(Number.NEGATIVE_INFINITY)).toBe("—");
	});
});

describe("formatUsd — { compact: true }", () => {
	it("forces compact notation below the $10K auto-threshold", () => {
		expect(formatUsd(1500, { compact: true })).toBe("$1.5K");
		// Default compact decimals = 1 above $1, so an integer reads as "$123.0".
		// Callers wanting `"$123"` pass `{ compact: true, decimals: 0 }`.
		expect(formatUsd(123, { compact: true })).toBe("$123.0");
		expect(formatUsd(123, { compact: true, decimals: 0 })).toBe("$123");
	});

	it("keeps sub-$1 readable under compact (default 2 decimals below $1)", () => {
		expect(formatUsd(0.42, { compact: true })).toBe("$0.42");
	});

	it("respects an explicit decimals override under compact", () => {
		expect(formatUsd(1500, { compact: true, decimals: 2 })).toBe("$1.50K");
	});
});

describe("formatUsd — { decimals: N } override", () => {
	it("overrides the default decimal count for a bucket", () => {
		expect(formatUsd(3.45, { decimals: 0 })).toBe("$3");
		expect(formatUsd(0.0042, { decimals: 2 })).toBe("$0.00");
		expect(formatUsd(123.45, { decimals: 4 })).toBe("$123.4500");
	});
});
