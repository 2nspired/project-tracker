import { describe, expect, it } from "vitest";
import { getSlashCommands } from "@/lib/slash-commands";

describe("slash-commands catalog", () => {
	const commands = getSlashCommands();

	it("returns a non-empty list", () => {
		expect(commands.length).toBeGreaterThan(0);
	});

	it("includes the three common entry points", () => {
		const names = commands.map((c) => c.name);
		expect(names).toContain("/brief-me");
		expect(names).toContain("/handoff");
		expect(names).toContain("/plan-card");
	});

	it("flags only the curated set as common", () => {
		const common = commands.filter((c) => c.common).map((c) => c.name);
		expect(common.sort()).toEqual(["/brief-me", "/handoff", "/plan-card"].sort());
	});

	it("orders common commands first", () => {
		const firstThree = commands.slice(0, 3).every((c) => c.common);
		expect(firstThree).toBe(true);
	});

	it("uses saveHandoff (not endSession) for /handoff tools", () => {
		const handoff = commands.find((c) => c.name === "/handoff");
		expect(handoff).toBeDefined();
		expect(handoff?.tools).toContain("saveHandoff");
		expect(handoff?.tools).not.toContain("endSession");
	});

	it("populates description and at least one tool per command", () => {
		for (const cmd of commands) {
			expect(cmd.description.length).toBeGreaterThan(0);
			expect(cmd.tools.length).toBeGreaterThan(0);
		}
	});
});
