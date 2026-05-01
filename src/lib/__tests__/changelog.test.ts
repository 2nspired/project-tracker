import { describe, expect, it } from "vitest";
import { extractSection } from "@/lib/changelog";

const SAMPLE_CHANGELOG = `# Changelog

Some preamble that should never appear inside a section.

## [Unreleased]

### Added

- **Pending change** that should never be returned for any explicit version.

## [6.1.0] - 2026-04-01

### Added

- **6.1.0 marker.**

### Fixed

- **6.1.0 fix.**

## [6.0.0] - 2026-03-15

### Added

- **6.0.0 marker.**

## [5.0.0] - 2025-11-01

### Removed

- **5.0.0 marker.**
`;

describe("extractSection (#210 PR-B)", () => {
	it("extracts the body of a known version", () => {
		const body = extractSection(SAMPLE_CHANGELOG, "6.1.0");
		expect(body).not.toBeNull();
		expect(body).toContain("6.1.0 marker");
		expect(body).toContain("6.1.0 fix");
		// Should not bleed into adjacent sections.
		expect(body).not.toContain("6.0.0 marker");
		expect(body).not.toContain("Pending change");
	});

	it("returns null for [Unreleased] (semver-only pattern excludes it)", () => {
		expect(extractSection(SAMPLE_CHANGELOG, "Unreleased")).toBeNull();
		expect(extractSection(SAMPLE_CHANGELOG, "[Unreleased]")).toBeNull();
	});

	it("isolates a version with multiple later versions present", () => {
		const body = extractSection(SAMPLE_CHANGELOG, "6.0.0");
		expect(body).not.toBeNull();
		expect(body).toContain("6.0.0 marker");
		expect(body).not.toContain("6.1.0 marker");
		expect(body).not.toContain("5.0.0 marker");
		expect(body).not.toContain("Pending change");
	});

	it("returns null for a version that isn't in the file", () => {
		expect(extractSection(SAMPLE_CHANGELOG, "9.9.9")).toBeNull();
	});

	it("returns null for non-semver input (defends against regex-metachar injection)", () => {
		expect(extractSection(SAMPLE_CHANGELOG, ".*")).toBeNull();
		expect(extractSection(SAMPLE_CHANGELOG, "6.1")).toBeNull();
		expect(extractSection(SAMPLE_CHANGELOG, "")).toBeNull();
	});

	it("handles a CHANGELOG that ends with the target section (no trailing heading)", () => {
		const body = extractSection(SAMPLE_CHANGELOG, "5.0.0");
		expect(body).not.toBeNull();
		expect(body).toContain("5.0.0 marker");
	});
});
