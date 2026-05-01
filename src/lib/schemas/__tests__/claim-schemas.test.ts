import { describe, expect, it } from "vitest";

import { measurementPayloadSchema } from "@/lib/schemas/claim-schemas";

describe("measurementPayloadSchema env field", () => {
	it("accepts string env values (regression — original behavior)", () => {
		const result = measurementPayloadSchema.parse({
			value: 42,
			unit: "ms",
			env: { dataset: "small", region: "us-east-1" },
		});
		expect(result.env).toEqual({ dataset: "small", region: "us-east-1" });
	});

	it("accepts numeric env values (#178 — was rejected before)", () => {
		const result = measurementPayloadSchema.parse({
			value: 42,
			unit: "ms",
			env: { cards: 84, rows: 50 },
		});
		expect(result.env).toEqual({ cards: 84, rows: 50 });
	});

	it("accepts boolean env values", () => {
		const result = measurementPayloadSchema.parse({
			value: 42,
			unit: "ms",
			env: { cached: true, warmup: false },
		});
		expect(result.env).toEqual({ cached: true, warmup: false });
	});

	it("accepts mixed env values", () => {
		const result = measurementPayloadSchema.parse({
			value: 42,
			unit: "ms",
			env: { dataset: "small", cards: 84, cached: true },
		});
		expect(result.env).toEqual({ dataset: "small", cards: 84, cached: true });
	});

	it("rejects nested-object env values (still bounded to scalars)", () => {
		expect(() =>
			measurementPayloadSchema.parse({
				value: 42,
				unit: "ms",
				env: { nested: { foo: "bar" } },
			})
		).toThrow();
	});

	it("defaults env to empty object when omitted", () => {
		const result = measurementPayloadSchema.parse({ value: 42, unit: "ms" });
		expect(result.env).toEqual({});
	});
});
