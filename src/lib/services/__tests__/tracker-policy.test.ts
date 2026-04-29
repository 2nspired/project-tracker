import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTrackerPolicy } from "@/lib/services/tracker-policy";

describe("loadTrackerPolicy", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "tracker-policy-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("returns policy: null with no warning when tracker.md is absent", async () => {
		const result = await loadTrackerPolicy({
			repoPath: dir,
			projectPrompt: "stale db value",
		});
		expect(result.policy).toBeNull();
		expect(result.warnings).toEqual([]);
		expect(result.policy_error).toBeUndefined();
	});

	it("returns policy: null with no warning when repoPath is null", async () => {
		const result = await loadTrackerPolicy({ repoPath: null, projectPrompt: null });
		expect(result.policy).toBeNull();
		expect(result.warnings).toEqual([]);
		expect(result.policy_error).toBeUndefined();
	});

	it("parses front matter and exposes body as prompt when file present", async () => {
		const md = `---
schema_version: 1
intent_required_on:
  - moveCard
  - deleteCard
columns:
  In Progress:
    prompt: |
      Link commits via syncGitActivity every chunk.
  Review:
    prompt: |
      Don't move to Done without human approval.
---

# Project policy

Run briefMe first. Prefer pinned over scored.
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		const policy = result.policy;
		if (!policy) throw new Error("expected policy to be present");
		expect(policy.schema_version).toBe(1);
		expect(policy.intent_required_on).toEqual(["moveCard", "deleteCard"]);
		expect(policy.columns["In Progress"].prompt).toMatch(/syncGitActivity/);
		expect(policy.columns.Review.prompt).toMatch(/human approval/);
		expect(policy.prompt).toContain("# Project policy");
		expect(policy.prompt).toContain("Run briefMe first");
		expect(result.warnings).toEqual([]);
		expect(result.policy_error).toBeUndefined();
	});

	it("emits conflict warning when both tracker.md body and projectPrompt are populated", async () => {
		const md = `---
schema_version: 1
---

Body content here.
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({
			repoPath: dir,
			projectPrompt: "old DB-stored project prompt",
		});
		expect(result.policy?.prompt).toBe("Body content here.");
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/both tracker\.md and a non-empty projectPrompt/);
		expect(result.warnings[0]).toMatch(/migrateProjectPrompt/);
	});

	it("does not warn when tracker.md body is empty even if projectPrompt exists", async () => {
		const md = `---
schema_version: 1
---

`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({
			repoPath: dir,
			projectPrompt: "still in DB",
		});
		expect(result.policy?.prompt).toBe("");
		expect(result.warnings).toEqual([]);
	});

	it("returns policy_error with stage 'yaml' when YAML front matter is malformed", async () => {
		const md = `---
schema_version: 1
columns:
  In Progress: [unbalanced
---

Body.
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		expect(result.policy).toBeNull();
		expect(result.warnings).toEqual([]);
		expect(result.policy_error?.stage).toBe("yaml");
		expect(result.policy_error?.message).toBeTruthy();
	});

	it("returns policy_error with stage 'schema' when intent_required_on is wrong type", async () => {
		const md = `---
schema_version: 1
intent_required_on: moveCard
---

Body.
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		expect(result.policy).toBeNull();
		expect(result.policy_error?.stage).toBe("schema");
		expect(result.policy_error?.message).toMatch(/intent_required_on/);
	});

	it("returns policy_error with stage 'schema' when columns entry is missing prompt", async () => {
		const md = `---
schema_version: 1
columns:
  In Progress:
    note: oops wrong key
---
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		expect(result.policy).toBeNull();
		expect(result.policy_error?.stage).toBe("schema");
		expect(result.policy_error?.message).toMatch(/prompt/);
	});

	it("returns policy_error with stage 'schema_version' when schema_version is in the future", async () => {
		const md = `---
schema_version: 2
---

Body.
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		expect(result.policy).toBeNull();
		expect(result.policy_error?.stage).toBe("schema_version");
		expect(result.policy_error?.message).toMatch(/schema_version 2 is not supported/);
		expect(result.policy_error?.message).toMatch(/max 1/);
	});

	it("returns policy_error with stage 'schema' when front matter parses to a non-object (e.g. string)", async () => {
		const md = `---
just-a-string
---

Body.
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		expect(result.policy).toBeNull();
		expect(result.policy_error?.stage).toBe("schema");
		expect(result.policy_error?.message).toMatch(/mapping/);
	});

	it("treats a body-only file (no front matter) as the prompt with default schema_version", async () => {
		await writeFile(join(dir, "tracker.md"), "Just a prose policy with no YAML.\n", "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		expect(result.policy?.prompt).toBe("Just a prose policy with no YAML.");
		expect(result.policy?.schema_version).toBe(1);
		expect(result.policy?.intent_required_on).toEqual([]);
		expect(result.policy?.columns).toEqual({});
		expect(result.policy_error).toBeUndefined();
	});

	it("treats whitespace-only front matter as defaults, no error", async () => {
		const md = `---

---

Body content.
`;
		await writeFile(join(dir, "tracker.md"), md, "utf8");

		const result = await loadTrackerPolicy({ repoPath: dir, projectPrompt: null });
		expect(result.policy?.prompt).toBe("Body content.");
		expect(result.policy?.schema_version).toBe(1);
		expect(result.policy_error).toBeUndefined();
	});
});
