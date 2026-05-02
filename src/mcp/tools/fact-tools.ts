import type { Claim } from "prisma/generated/client";
import { z } from "zod";
import { createClaimService, type NormalizedClaim } from "@/lib/services/claim";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

// ─── Unified Fact Tools — legacy aliases ─────────────────────────
//
// Post-cutover (commits 5–6 of docs/IMPL-NOTE-CLAIM-CUTOVER.md)
// saveFact and listFacts are thin wrappers over claim-service /
// Claim reads. Existing agents keep working; prefer saveClaim /
// listClaims for new code. The aliases are slated for removal in the
// next minor MCP version.

const claimService = createClaimService(db);

const FACT_TYPES = ["context", "code", "measurement"] as const;
const VALID_SURFACES = ["ambient", "indexed", "surfaced"] as const;

// ─── Claim → legacy fact shape (reader path) ──────────────────────

function claimToFact(c: Claim | NormalizedClaim) {
	const evidence =
		(typeof c.evidence === "string"
			? (JSON.parse(c.evidence) as { files?: string[]; symbols?: string[] })
			: (c.evidence as { files?: string[]; symbols?: string[] })) ?? {};
	const payload =
		typeof c.payload === "string"
			? (JSON.parse(c.payload) as Record<string, unknown>)
			: ((c.payload as Record<string, unknown>) ?? {});
	const files = evidence.files ?? [];
	const symbols = evidence.symbols ?? [];

	if (c.kind === "context") {
		return {
			id: c.id,
			type: "context" as const,
			projectId: c.projectId,
			content: c.statement,
			author: c.author,
			rationale: c.body,
			application: (payload.application as string) ?? "",
			details: [] as string[],
			audience: (payload.audience as string) ?? "all",
			citedFiles: files,
			recordedAtSha: c.recordedAtSha,
			surface: (payload.surface as string) ?? "indexed",
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		};
	}
	if (c.kind === "code") {
		return {
			id: c.id,
			type: "code" as const,
			projectId: c.projectId,
			content: c.statement,
			path: files[0] ?? "",
			symbol: symbols[0] ?? null,
			author: c.author,
			recordedAtSha: c.recordedAtSha,
			needsRecheck: false,
			lastVerifiedAt: c.verifiedAt,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		};
	}
	// measurement
	return {
		id: c.id,
		type: "measurement" as const,
		projectId: c.projectId,
		content: c.statement,
		value: (payload.value as number) ?? 0,
		unit: (payload.unit as string) ?? "",
		env: (payload.env as Record<string, unknown>) ?? {},
		path: files[0] ?? null,
		symbol: symbols[0] ?? null,
		author: c.author,
		recordedAt: c.createdAt,
		ttl: null as number | null,
		needsRecheck: false,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
	};
}

type LegacyFact = ReturnType<typeof claimToFact>;

// ─── saveFact ─────────────────────────────────────────────────────

registerExtendedTool("saveFact", {
	category: "context",
	description: `Create or update a persistent fact. Pass factId to update. Legacy alias for \`saveClaim\` — prefer \`saveClaim\` for new writes (unified statement + body + evidence + payload shape). \`saveFact\`/\`listFacts\` are slated for removal in the next minor MCP version.

Types:
- **context**: Project-level knowledge claim (content = the claim, plus rationale/application/details)
- **code**: Assertion about a file or symbol (content = the fact, path required)
- **measurement**: Numeric value like latency or bundle size (content = description, value + unit required)`,
	parameters: z.object({
		type: z.enum(FACT_TYPES).describe("Fact type: context | code | measurement"),
		projectId: z.string().describe("Project UUID"),
		content: z
			.string()
			.describe(
				"The fact text — maps to claim (context), fact (code), or description (measurement)"
			),
		author: z.string().default("AGENT").describe("Who recorded this (AGENT or HUMAN)"),
		// Common optional
		path: z
			.string()
			.optional()
			.describe("File path relative to repo root (required for code, optional for measurement)"),
		symbol: z.string().optional().describe("Symbol name (function, class, variable)"),
		recordedAtSha: z.string().optional().describe("Git SHA when this was recorded"),
		factId: z.string().optional().describe("Fact UUID — pass to update an existing fact"),
		// Context-specific
		rationale: z.string().optional().describe("[context] Why this matters"),
		application: z.string().optional().describe("[context] How to apply this knowledge"),
		details: z.array(z.string()).optional().describe("[context] Supporting details"),
		audience: z.string().optional().describe("[context] Who should see it (all, agent, human)"),
		citedFiles: z
			.array(z.string())
			.optional()
			.describe("[context] File paths this fact references"),
		surface: z
			.enum(VALID_SURFACES)
			.optional()
			.describe("[context] Visibility: ambient | indexed | surfaced"),
		// Measurement-specific
		value: z.number().optional().describe("[measurement] Numeric value"),
		unit: z.string().optional().describe("[measurement] Unit (e.g. ms, MB, s, bytes)"),
		env: z
			.record(z.string(), z.string())
			.optional()
			.describe("[measurement] Environment key-value pairs"),
		recordedAt: z
			.string()
			.optional()
			.describe("[measurement] ISO 8601 when measured (defaults to now)"),
		ttl: z.number().int().optional().describe("[measurement] Time-to-live in days"),
	}),
	handler: (params) =>
		safeExecute(async () => {
			const { type, projectId, content, author, path, symbol, recordedAtSha, factId } = params as {
				type: "context" | "code" | "measurement";
				projectId: string;
				content: string;
				author: string;
				path?: string;
				symbol?: string;
				recordedAtSha?: string;
				factId?: string;
			};

			const project = await db.project.findUnique({ where: { id: projectId } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			// Translate legacy saveFact args to a claim-service input per kind.
			const buildClaimInput = ():
				| {
						statement: string;
						body?: string;
						evidence: Record<string, unknown>;
						payload: Record<string, unknown>;
						expiresAt?: Date | null;
				  }
				| { error: string; hint?: string } => {
				if (type === "context") {
					const details = (params.details as string[] | undefined) ?? [];
					const rationale = (params.rationale as string | undefined) ?? "";
					const body = details.length
						? [rationale, ...details.map((d) => `- ${d}`)].filter(Boolean).join("\n")
						: rationale;
					const payload: Record<string, unknown> = {};
					if (params.application !== undefined) payload.application = params.application;
					if (params.audience !== undefined) payload.audience = params.audience;
					else payload.audience = "all";
					if (params.surface !== undefined) payload.surface = params.surface;
					else payload.surface = "indexed";
					const evidence: Record<string, unknown> = {};
					const citedFiles = (params.citedFiles as string[] | undefined) ?? [];
					if (citedFiles.length) evidence.files = citedFiles;
					return { statement: content, body, evidence, payload };
				}
				if (type === "code") {
					if (!path)
						return {
							error: "path is required for code facts.",
							hint: "Provide the file path relative to the repo root.",
						};
					const evidence: Record<string, unknown> = { files: [path] };
					if (symbol) evidence.symbols = [symbol];
					return { statement: content, evidence, payload: {} };
				}
				// measurement
				const value = params.value as number | undefined;
				const unit = params.unit as string | undefined;
				if (value == null || !unit)
					return { error: "value and unit are required for measurements." };
				const evidence: Record<string, unknown> = {};
				if (path) evidence.files = [path];
				if (symbol) evidence.symbols = [symbol];
				const payload: Record<string, unknown> = {
					value,
					unit,
					env: (params.env as Record<string, string> | undefined) ?? {},
				};
				const ttl = params.ttl as number | undefined;
				const expiresAt = ttl ? new Date(Date.now() + ttl * 86400_000) : null;
				return { statement: content, evidence, payload, expiresAt };
			};

			const built = buildClaimInput();
			if ("error" in built) return err(built.error, built.hint);

			if (factId) {
				const existing = await db.claim.findUnique({ where: { id: factId } });
				if (!existing || existing.kind !== type)
					return err(`${type} fact not found.`, "Check the factId and try again.");
				const result = await claimService.update(factId, {
					kind: type,
					statement: built.statement,
					body: built.body,
					evidence: built.evidence,
					payload: built.payload,
					author: author ?? "AGENT",
					recordedAtSha: recordedAtSha ?? null,
					verifiedAt: new Date(),
					...(built.expiresAt !== undefined && { expiresAt: built.expiresAt }),
				});
				if (!result.success) return err(result.error.message);
				return ok(claimToFact(result.data));
			}

			const result = await claimService.create({
				projectId,
				kind: type,
				statement: built.statement,
				body: built.body,
				evidence: built.evidence,
				payload: built.payload,
				author: author ?? "AGENT",
				recordedAtSha: recordedAtSha ?? null,
				...(built.expiresAt !== undefined && { expiresAt: built.expiresAt }),
			});
			if (!result.success) return err(result.error.message);
			return ok(claimToFact(result.data));
		}),
});

// ─── listFacts ────────────────────────────────────────────────────

registerExtendedTool("listFacts", {
	category: "context",
	description:
		"List facts for a project. Omit type to list all types. Filter by path or surface. Pass factId for single-fact lookup. (Reads from the unified Claim table — prefer listClaims for new code.)",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		factId: z.string().optional().describe("Fetch a single fact by UUID"),
		type: z.enum(FACT_TYPES).optional().describe("Filter by fact type"),
		path: z.string().optional().describe("Filter by exact file path (code/measurement)"),
		pathPrefix: z.string().optional().describe("Filter by path prefix (e.g. 'src/mcp/')"),
		surface: z.enum(VALID_SURFACES).optional().describe("Filter context entries by surface level"),
		needsRecheck: z
			.boolean()
			.optional()
			.describe("(deprecated — no longer tracked; filter ignored)"),
		author: z.string().optional().describe("Filter by author (AGENT or HUMAN)"),
		limit: z.number().int().min(1).max(200).default(50).describe("Max facts per type"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) =>
		safeExecute(async () => {
			const {
				projectId,
				factId: singleId,
				type,
				path,
				pathPrefix,
				surface,
				author,
				limit,
			} = params as {
				projectId: string;
				factId?: string;
				type?: string;
				path?: string;
				pathPrefix?: string;
				surface?: string;
				author?: string;
				limit: number;
			};

			if (singleId) {
				const claim = await db.claim.findUnique({ where: { id: singleId } });
				if (!claim || !FACT_TYPES.includes(claim.kind as (typeof FACT_TYPES)[number])) {
					return err("Fact not found.", "Check the factId and try again.");
				}
				return ok({ facts: [claimToFact(claim)], total: 1 });
			}

			const project = await db.project.findUnique({ where: { id: projectId } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const kinds = type ? [type] : (FACT_TYPES as readonly string[]);
			const results: LegacyFact[] = [];

			for (const kind of kinds) {
				const where: Record<string, unknown> = { projectId, kind };
				if (author) where.author = author;
				const claims = await db.claim.findMany({
					where,
					orderBy: { updatedAt: "desc" },
					take: limit,
				});

				for (const c of claims) {
					const fact = claimToFact(c);
					if (fact.type === "context" && surface && fact.surface !== surface) continue;
					if ((fact.type === "code" || fact.type === "measurement") && (path || pathPrefix)) {
						const filePath = fact.path ?? "";
						if (path && filePath !== path) continue;
						if (pathPrefix && !filePath.startsWith(pathPrefix)) continue;
					}
					results.push(fact);
				}
			}

			return ok({ facts: results, total: results.length });
		}),
});
