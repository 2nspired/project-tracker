import { describe, expect, it } from "vitest";

import { promoteNoteToCardSchema } from "@/lib/schemas/note-schemas";

describe("promoteNoteToCardSchema", () => {
	const validBase = {
		noteId: "11111111-1111-4111-8111-111111111111",
		columnId: "22222222-2222-4222-8222-222222222222",
	};

	it("accepts a minimal payload (defaults priority to NONE, title optional)", () => {
		const result = promoteNoteToCardSchema.parse(validBase);
		expect(result.priority).toBe("NONE");
		expect(result.title).toBeUndefined();
	});

	it("accepts all priority values", () => {
		for (const priority of ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const) {
			const result = promoteNoteToCardSchema.parse({ ...validBase, priority });
			expect(result.priority).toBe(priority);
		}
	});

	it("accepts an explicit title up to 200 chars", () => {
		const title = "A".repeat(200);
		const result = promoteNoteToCardSchema.parse({ ...validBase, title });
		expect(result.title).toBe(title);
	});

	it("rejects empty title (validate non-empty when present)", () => {
		expect(() => promoteNoteToCardSchema.parse({ ...validBase, title: "" })).toThrow();
	});

	it("rejects title over 200 chars", () => {
		expect(() => promoteNoteToCardSchema.parse({ ...validBase, title: "A".repeat(201) })).toThrow();
	});

	it("rejects non-uuid noteId / columnId", () => {
		expect(() => promoteNoteToCardSchema.parse({ ...validBase, noteId: "not-a-uuid" })).toThrow();
		expect(() => promoteNoteToCardSchema.parse({ ...validBase, columnId: "not-a-uuid" })).toThrow();
	});

	it("rejects unknown priority values", () => {
		expect(() => promoteNoteToCardSchema.parse({ ...validBase, priority: "BLOCKER" })).toThrow();
	});
});
