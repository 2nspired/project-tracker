import { describe, expect, it } from "vitest";
import { LEGACY_BRAND_DEPRECATION, resolveServerBrand } from "../brand";

describe("resolveServerBrand", () => {
	it("returns 'pigeon' when MCP_SERVER_BRAND is unset", () => {
		expect(resolveServerBrand({})).toBe("pigeon");
	});

	it("returns 'pigeon' when MCP_SERVER_BRAND is the canonical value", () => {
		expect(resolveServerBrand({ MCP_SERVER_BRAND: "pigeon" })).toBe("pigeon");
	});

	it("returns 'project-tracker' only when explicitly set to the legacy value", () => {
		expect(resolveServerBrand({ MCP_SERVER_BRAND: "project-tracker" })).toBe("project-tracker");
	});

	it("falls back to 'pigeon' for unknown values", () => {
		expect(resolveServerBrand({ MCP_SERVER_BRAND: "anything-else" })).toBe("pigeon");
	});
});

describe("LEGACY_BRAND_DEPRECATION", () => {
	it("names the new entrypoint, the legacy entrypoint, and the migration command", () => {
		expect(LEGACY_BRAND_DEPRECATION).toContain("pigeon-start.sh");
		expect(LEGACY_BRAND_DEPRECATION).toContain("mcp-start.sh");
		expect(LEGACY_BRAND_DEPRECATION).toContain("migrate-rebrand");
	});

	it("declares when the alias goes away", () => {
		expect(LEGACY_BRAND_DEPRECATION).toMatch(/v6\.0/);
	});
});
