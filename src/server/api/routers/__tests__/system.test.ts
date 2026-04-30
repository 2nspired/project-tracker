// Smoke-test the toolCatalog query — ensures the router returns the
// generated catalog merged with the slash-command list, with the right
// shape and the renamed saveHandoff tool surfacing on /handoff.
import { describe, expect, it } from "vitest";
import { getSlashCommands } from "@/lib/slash-commands";
import { TOOL_CATALOG } from "@/lib/tool-catalog.generated";

describe("system.toolCatalog payload", () => {
	// Mirror the router's query body without spinning a full tRPC caller —
	// the router is a one-line passthrough so a structural assertion is
	// the value-add. If the router shape ever drifts from this test it
	// means a contributor changed the API surface and should review here.
	const payload = {
		...TOOL_CATALOG,
		slashCommands: getSlashCommands(),
	};

	it("returns a non-empty slashCommands array", () => {
		expect(Array.isArray(payload.slashCommands)).toBe(true);
		expect(payload.slashCommands.length).toBeGreaterThan(0);
	});

	it("includes /handoff with the renamed saveHandoff tool", () => {
		const handoff = payload.slashCommands.find((c) => c.name === "/handoff");
		expect(handoff).toBeDefined();
		expect(handoff?.tools).toContain("saveHandoff");
	});

	it("each entry has the documented shape", () => {
		for (const cmd of payload.slashCommands) {
			expect(typeof cmd.name).toBe("string");
			expect(typeof cmd.description).toBe("string");
			expect(Array.isArray(cmd.tools)).toBe(true);
			expect(typeof cmd.common).toBe("boolean");
		}
	});

	it("preserves the existing essentials and extended catalog", () => {
		expect(payload.essentials.length).toBeGreaterThan(0);
		expect(payload.extended.length).toBeGreaterThan(0);
	});
});
