import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateProjectPromptToFile } from "@/lib/services/migrate-project-prompt";
import { loadTrackerPolicy, type TrackerPolicy } from "@/lib/services/tracker-policy";

describe("migrateProjectPromptToFile", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "migrate-prompt-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("writes tracker.md with the projectPrompt body verbatim", async () => {
		const body = "Run briefMe first.\n\nPrefer pinned over scored.";
		const result = await migrateProjectPromptToFile({
			repoPath: dir,
			slug: "my-project",
			projectPrompt: body,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.path).toBe(join(dir, "tracker.md"));

		const written = await readFile(result.path, "utf8");
		expect(written).toBe(`---\nschema_version: 1\nproject_slug: my-project\n---\n\n${body}\n`);
	});

	it("appends a trailing newline only when missing (no double newlines)", async () => {
		const body = "Body that already ends with newline.\n";
		const result = await migrateProjectPromptToFile({
			repoPath: dir,
			slug: "p",
			projectPrompt: body,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const written = await readFile(result.path, "utf8");
		// Body already ends in \n; we should not add another one.
		expect(written.endsWith(`${body}`)).toBe(true);
		expect(written.endsWith("\n\n")).toBe(false);
	});

	it("aborts with already_exists when tracker.md is present (no overwrite)", async () => {
		const existing = "---\nschema_version: 1\n---\nExisting content\n";
		await writeFile(join(dir, "tracker.md"), existing, "utf8");

		const result = await migrateProjectPromptToFile({
			repoPath: dir,
			slug: "p",
			projectPrompt: "should not be written",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("already_exists");

		// Confirm the original file is untouched.
		const after = await readFile(join(dir, "tracker.md"), "utf8");
		expect(after).toBe(existing);
	});

	it("produces a tracker.md that loadTrackerPolicy can round-trip", async () => {
		const body = "# Project policy\n\nRun briefMe first.";
		const writeResult = await migrateProjectPromptToFile({
			repoPath: dir,
			slug: "round-trip",
			projectPrompt: body,
		});
		expect(writeResult.ok).toBe(true);

		const load = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		const policy = load.policy as TrackerPolicy | null;
		if (!policy) throw new Error("expected policy to load");

		expect(policy.schema_version).toBe(1);
		expect(policy.intent_required_on).toEqual([]);
		expect(policy.columns).toEqual({});
		expect(policy.prompt).toBe(body);
		expect(load.warnings).toEqual([]);
		expect(load.policy_error).toBeUndefined();
	});

	it("emits a conflict warning via loadTrackerPolicy when DB still has projectPrompt", async () => {
		await migrateProjectPromptToFile({
			repoPath: dir,
			slug: "p",
			projectPrompt: "body in file",
		});

		const load = await loadTrackerPolicy({
			repoPath: dir,
			projectPrompt: "stale db value",
		});
		expect(load.warnings.length).toBeGreaterThan(0);
		expect(load.warnings[0]).toMatch(/migrateProjectPrompt|delete the DB value/);
	});
});
