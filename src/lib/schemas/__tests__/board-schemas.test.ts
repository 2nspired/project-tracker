import { describe, expect, it } from "vitest";

import { updateBoardSchema } from "@/lib/schemas/board-schemas";

describe("updateBoardSchema — accentColor", () => {
	it("accepts a valid 6-digit lowercase hex", () => {
		const result = updateBoardSchema.parse({ accentColor: "#3b82f6" });
		expect(result.accentColor).toBe("#3b82f6");
	});

	it("accepts a valid 6-digit uppercase hex", () => {
		const result = updateBoardSchema.parse({ accentColor: "#AABBCC" });
		expect(result.accentColor).toBe("#AABBCC");
	});

	it("accepts mixed-case hex", () => {
		const result = updateBoardSchema.parse({ accentColor: "#aB12Ef" });
		expect(result.accentColor).toBe("#aB12Ef");
	});

	it("accepts null (clears the accent)", () => {
		const result = updateBoardSchema.parse({ accentColor: null });
		expect(result.accentColor).toBeNull();
	});

	it("accepts an omitted accentColor (leave unchanged)", () => {
		const result = updateBoardSchema.parse({});
		expect(result.accentColor).toBeUndefined();
	});

	it("rejects a CSS color name", () => {
		expect(() => updateBoardSchema.parse({ accentColor: "red" })).toThrow();
	});

	it("rejects 3-digit shorthand hex", () => {
		expect(() => updateBoardSchema.parse({ accentColor: "#fff" })).toThrow();
	});

	it("rejects out-of-range hex characters", () => {
		expect(() => updateBoardSchema.parse({ accentColor: "#ZZZZZZ" })).toThrow();
	});

	it("rejects 8-digit hex (no alpha channel)", () => {
		expect(() => updateBoardSchema.parse({ accentColor: "#3b82f6ff" })).toThrow();
	});

	it("rejects hex without leading #", () => {
		expect(() => updateBoardSchema.parse({ accentColor: "3b82f6" })).toThrow();
	});

	it("rejects an empty string", () => {
		expect(() => updateBoardSchema.parse({ accentColor: "" })).toThrow();
	});
});
