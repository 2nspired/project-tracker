/**
 * Reads `tracker.md` from a project's repo root and returns the parsed policy
 * object that briefMe (and later getCardContext, MCP middleware) surface to
 * agents. Implementation cards 1/7 + 5/7 of RFC #111 (`docs/RFC-WORKFLOW.md`).
 *
 * Day-one schema: `intent_required_on` + `columns.<name>.prompt` only. Body
 * (everything after the closing front-matter `---`) becomes `policy.prompt`.
 *
 * Read-on-every-call (no cache) — file is small, SQLite is local. That gives
 * the Symphony-style "hot reload" property for free.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load as parseYaml, YAMLException } from "js-yaml";
import { z } from "zod";

const MAX_SUPPORTED_SCHEMA_VERSION = 1;

const TrackerPolicySchema = z.object({
	schema_version: z.number().int().min(1).default(1),
	project_slug: z.string().optional(),
	intent_required_on: z.array(z.string()).default([]),
	columns: z.record(z.string(), z.object({ prompt: z.string() })).default({}),
});

type ValidatedFrontMatter = z.infer<typeof TrackerPolicySchema>;

export type TrackerPolicy = {
	prompt: string;
	intent_required_on: string[];
	columns: Record<string, { prompt: string }>;
	schema_version: number;
};

export type PolicyError = {
	stage: "yaml" | "schema" | "schema_version";
	message: string;
};

export type LoadPolicyResult = {
	policy: TrackerPolicy | null;
	warnings: string[];
	policy_error?: PolicyError;
};

const FILENAME = "tracker.md";
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const CONFLICT_WARNING =
	"Project has both tracker.md and a non-empty projectPrompt. Using tracker.md. Run `migrateProjectPrompt` or delete the DB value to clear this warning.";

export async function loadTrackerPolicy(input: {
	repoPath: string | null;
	projectPrompt: string | null;
}): Promise<LoadPolicyResult> {
	const { repoPath, projectPrompt } = input;
	if (!repoPath) return { policy: null, warnings: [] };

	let raw: string;
	try {
		raw = await readFile(join(repoPath, FILENAME), "utf8");
	} catch {
		// File absent (or unreadable) — both treated as "no policy". A future
		// refinement could split ENOENT from unreadable, but the practical signal
		// for agents is identical: there's no policy to apply.
		return { policy: null, warnings: [] };
	}

	const match = FRONT_MATTER_RE.exec(raw);
	let frontMatterRaw: unknown = {};
	let body: string;
	if (match) {
		try {
			frontMatterRaw = parseYaml(match[1]) ?? {};
		} catch (err) {
			const message = err instanceof YAMLException ? err.message : String(err);
			return {
				policy: null,
				warnings: [],
				policy_error: { stage: "yaml", message },
			};
		}
		body = match[2];
	} else {
		body = raw;
	}

	if (
		typeof frontMatterRaw !== "object" ||
		frontMatterRaw === null ||
		Array.isArray(frontMatterRaw)
	) {
		return {
			policy: null,
			warnings: [],
			policy_error: {
				stage: "schema",
				message: "Front matter must be a YAML mapping (object).",
			},
		};
	}

	const parsed = TrackerPolicySchema.safeParse(frontMatterRaw);
	if (!parsed.success) {
		return {
			policy: null,
			warnings: [],
			policy_error: { stage: "schema", message: formatZodError(parsed.error) },
		};
	}

	const validated: ValidatedFrontMatter = parsed.data;

	if (validated.schema_version > MAX_SUPPORTED_SCHEMA_VERSION) {
		return {
			policy: null,
			warnings: [],
			policy_error: {
				stage: "schema_version",
				message: `tracker.md schema_version ${validated.schema_version} is not supported by this server (max ${MAX_SUPPORTED_SCHEMA_VERSION}).`,
			},
		};
	}

	const prompt = body.trim();

	const policy: TrackerPolicy = {
		prompt,
		intent_required_on: validated.intent_required_on,
		columns: validated.columns,
		schema_version: validated.schema_version,
	};

	const warnings: string[] = [];
	if (prompt.length > 0 && projectPrompt && projectPrompt.trim().length > 0) {
		warnings.push(CONFLICT_WARNING);
	}

	return { policy, warnings };
}

function formatZodError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
			return `${path}: ${issue.message}`;
		})
		.join("; ");
}
