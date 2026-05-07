import { describe, expect, it } from "vitest";

import { formatCo2, formatEnergy } from "@/lib/format-energy";

describe("formatEnergy — magnitude buckets", () => {
	it("renders sub-Wh values with 4 decimals so Haiku-call energy stays readable", () => {
		expect(formatEnergy(0.0042)).toBe("0.0042 Wh");
		expect(formatEnergy(0.42)).toBe("0.4200 Wh");
	});

	it("renders 1–1K Wh with 1 decimal", () => {
		expect(formatEnergy(12.3)).toBe("12.3 Wh");
		expect(formatEnergy(987)).toBe("987.0 Wh");
	});

	it("rolls 1K Wh up to kWh with 2 decimals", () => {
		expect(formatEnergy(1_230)).toBe("1.23 kWh");
		expect(formatEnergy(987_000)).toBe("987.00 kWh");
	});

	it("rolls 1M Wh up to MWh with 2 decimals", () => {
		expect(formatEnergy(1_400_000)).toBe("1.40 MWh");
	});

	it("renders zero as `0 Wh`", () => {
		expect(formatEnergy(0)).toBe("0 Wh");
	});

	it("returns the em-dash sentinel for NaN / Infinity", () => {
		expect(formatEnergy(Number.NaN)).toBe("—");
		expect(formatEnergy(Number.POSITIVE_INFINITY)).toBe("—");
	});
});

describe("formatCo2 — magnitude buckets", () => {
	it("renders sub-gram values with 3 decimals", () => {
		expect(formatCo2(0.42)).toBe("0.420 g CO₂");
	});

	it("renders 1–1K g with 1 decimal", () => {
		expect(formatCo2(12.3)).toBe("12.3 g CO₂");
		expect(formatCo2(987)).toBe("987.0 g CO₂");
	});

	it("rolls 1K g up to kg with 2 decimals", () => {
		expect(formatCo2(1_230)).toBe("1.23 kg CO₂");
	});

	it("rolls 1M g up to tonnes with 2 decimals", () => {
		expect(formatCo2(1_400_000)).toBe("1.40 t CO₂");
	});

	it("renders zero as `0 g CO₂`", () => {
		expect(formatCo2(0)).toBe("0 g CO₂");
	});

	it("returns the em-dash sentinel for NaN", () => {
		expect(formatCo2(Number.NaN)).toBe("—");
	});
});

describe("formatEnergy — { compact: true }", () => {
	it("drops to 1 decimal for kWh / MWh", () => {
		expect(formatEnergy(1_230, { compact: true })).toBe("1.2 kWh");
		expect(formatEnergy(1_400_000, { compact: true })).toBe("1.4 MWh");
	});
});
