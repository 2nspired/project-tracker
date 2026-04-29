import { describe, expect, it } from "vitest";

import { editDistance, slugify } from "@/lib/slugify";

describe("slugify", () => {
	it("lowercases and replaces spaces with hyphens", () => {
		expect(slugify("Hello World")).toBe("hello-world");
	});

	it("trims whitespace", () => {
		expect(slugify("  hello  ")).toBe("hello");
	});

	it("collapses non-alphanumeric runs into a single hyphen", () => {
		expect(slugify("Bug Fix #42!!")).toBe("bug-fix-42");
	});

	it("strips diacritics via NFKD", () => {
		expect(slugify("Café")).toBe("cafe");
	});

	it("returns empty string when input has no slug-eligible chars", () => {
		expect(slugify("---")).toBe("");
		expect(slugify("")).toBe("");
		expect(slugify("   ")).toBe("");
	});

	it("preserves already-valid slugs", () => {
		expect(slugify("real-time")).toBe("real-time");
		expect(slugify("feature-auth-2")).toBe("feature-auth-2");
	});

	it("caps at 50 chars and strips a trailing hyphen left by the cut", () => {
		const long = "a".repeat(49) + "---bbb";
		expect(slugify(long)).toBe("a".repeat(49));
		expect(slugify("a".repeat(60)).length).toBe(50);
	});

	it("normalizes the same-meaning variants surfaced in diagnosis", () => {
		// "realtime" already detected as 2 spellings — same slug after normalize.
		expect(slugify("realtime")).toBe("realtime");
		expect(slugify("Real Time")).toBe("real-time");
		expect(slugify("REALTIME")).toBe("realtime");
	});
});

describe("editDistance", () => {
	it("returns 0 for identical strings", () => {
		expect(editDistance("hello", "hello")).toBe(0);
	});

	it("counts single edits correctly", () => {
		expect(editDistance("realtime", "realtimes")).toBe(1); // insertion
		expect(editDistance("realtime", "realtim")).toBe(1); // deletion
		expect(editDistance("realtime", "realtome")).toBe(1); // substitution
	});

	it("counts compound edits up to threshold", () => {
		expect(editDistance("bug", "bag")).toBe(1);
		expect(editDistance("bug", "bags")).toBe(2);
	});

	it("short-circuits when length difference exceeds threshold", () => {
		// "hello" vs "hello world" differs by 6 — well past default threshold of 2.
		expect(editDistance("hello", "hello world")).toBe(3); // threshold + 1
	});

	it("exits early when a full row exceeds threshold", () => {
		expect(editDistance("abcdef", "uvwxyz")).toBe(3); // threshold + 1
	});

	it("respects custom threshold", () => {
		expect(editDistance("kitten", "sitting", 3)).toBe(3);
	});
});
