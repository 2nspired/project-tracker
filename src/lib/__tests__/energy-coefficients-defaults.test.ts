import { describe, expect, it } from "vitest";

import {
	computeEnergy,
	DEFAULT_COEFFICIENTS,
	WORLD_AVG_GCO2_PER_KWH,
} from "@/lib/energy-coefficients-defaults";

describe("computeEnergy", () => {
	it("scales linearly with token count for a known model", () => {
		const small = computeEnergy({
			model: "claude-opus-4-7",
			inputTokens: 1_000,
			outputTokens: 1_000,
		});
		const large = computeEnergy({
			model: "claude-opus-4-7",
			inputTokens: 10_000,
			outputTokens: 10_000,
		});
		expect(large.wattHoursTotal).toBeCloseTo(10 * small.wattHoursTotal, 5);
		expect(large.gramsCO2).toBeCloseTo(10 * small.gramsCO2, 5);
	});

	it("derives gCO2 from the world-average grid intensity", () => {
		const result = computeEnergy({
			model: "claude-opus-4-7",
			inputTokens: 0,
			outputTokens: 1_000_000, // 1M output tokens × 0.005 Wh = 5,000 Wh = 5 kWh
		});
		expect(result.wattHoursTotal).toBeCloseTo(5_000, 5);
		// 5 kWh × 475 g/kWh = 2,375 g CO₂
		expect(result.gramsCO2).toBeCloseTo(5 * WORLD_AVG_GCO2_PER_KWH, 5);
	});

	it("falls back to the zero __default__ row for unknown models", () => {
		const result = computeEnergy({
			model: "claude-opus-7-1-future",
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
		});
		expect(result.wattHoursTotal).toBe(0);
		expect(result.gramsCO2).toBe(0);
	});

	it("Opus output is ~10× input cost (autoregressive decode ratio)", () => {
		const opus = DEFAULT_COEFFICIENTS["claude-opus-4-7"];
		expect(opus.wattHoursPerOutputToken).toBeCloseTo(10 * opus.wattHoursPerInputToken, 6);
	});

	it("Sonnet is meaningfully cheaper per token than Opus", () => {
		const opus = DEFAULT_COEFFICIENTS["claude-opus-4-7"];
		const sonnet = DEFAULT_COEFFICIENTS["claude-sonnet-4-6"];
		expect(sonnet.wattHoursPerOutputToken).toBeLessThan(opus.wattHoursPerOutputToken);
	});
});
