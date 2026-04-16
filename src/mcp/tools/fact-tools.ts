import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, err, safeExecute, checkVersionConflict } from "../utils.js";

// ─── Unified Fact Tools ──────────────────────────────────────────
//
// Consolidates three separate fact stores (context entries, code
// facts, measurements) into a single CRUD surface.  The underlying
// Prisma tables remain unchanged — this is a tool-layer merge only.

const FACT_TYPES = ["context", "code", "measurement"] as const;
const VALID_SURFACES = ["ambient", "indexed", "surfaced"] as const;

// ─── Normalizers ──────────────────────────────────────────────────

type ContextRow = {
	id: string; projectId: string; claim: string; rationale: string;
	application: string; details: string; author: string; audience: string;
	citedFiles: string; recordedAtSha: string | null; surface: string;
	version: number; createdAt: Date; updatedAt: Date;
};

type CodeRow = {
	id: string; projectId: string; path: string; symbol: string | null;
	fact: string; author: string; recordedAtSha: string | null;
	needsRecheck: boolean; lastVerifiedAt: Date | null;
	version: number; createdAt: Date; updatedAt: Date;
};

type MeasurementRow = {
	id: string; projectId: string; value: number; unit: string;
	description: string; env: string; path: string | null;
	symbol: string | null; author: string; recordedAt: Date;
	ttl: number | null; needsRecheck: boolean;
	createdAt: Date; updatedAt: Date;
};

function normalizeContext(e: ContextRow) {
	return {
		id: e.id, type: "context" as const, projectId: e.projectId,
		content: e.claim, author: e.author,
		rationale: e.rationale, application: e.application,
		details: JSON.parse(e.details) as string[],
		audience: e.audience,
		citedFiles: JSON.parse(e.citedFiles) as string[],
		recordedAtSha: e.recordedAtSha, surface: e.surface,
		version: e.version,
		createdAt: e.createdAt, updatedAt: e.updatedAt,
	};
}

function normalizeCode(f: CodeRow) {
	return {
		id: f.id, type: "code" as const, projectId: f.projectId,
		content: f.fact, path: f.path, symbol: f.symbol,
		author: f.author, recordedAtSha: f.recordedAtSha,
		needsRecheck: f.needsRecheck, lastVerifiedAt: f.lastVerifiedAt,
		version: f.version,
		createdAt: f.createdAt, updatedAt: f.updatedAt,
	};
}

function normalizeMeasurement(m: MeasurementRow) {
	return {
		id: m.id, type: "measurement" as const, projectId: m.projectId,
		content: m.description,
		value: m.value, unit: m.unit,
		env: JSON.parse(m.env) as Record<string, unknown>,
		path: m.path, symbol: m.symbol,
		author: m.author, recordedAt: m.recordedAt,
		ttl: m.ttl, needsRecheck: m.needsRecheck,
		createdAt: m.createdAt, updatedAt: m.updatedAt,
	};
}

// ─── saveFact ─────────────────────────────────────────────────────

registerExtendedTool("saveFact", {
	category: "context",
	description: `Create or update a persistent fact. Pass factId to update.

Types:
- **context**: Project-level knowledge claim (content = the claim, plus rationale/application/details)
- **code**: Assertion about a file or symbol (content = the fact, path required)
- **measurement**: Numeric value like latency or bundle size (content = description, value + unit required)`,
	parameters: z.object({
		type: z.enum(FACT_TYPES).describe("Fact type: context | code | measurement"),
		projectId: z.string().describe("Project UUID"),
		content: z.string().describe("The fact text — maps to claim (context), fact (code), or description (measurement)"),
		author: z.string().default("AGENT").describe("Who recorded this (AGENT or HUMAN)"),
		// Common optional
		path: z.string().optional().describe("File path relative to repo root (required for code, optional for measurement)"),
		symbol: z.string().optional().describe("Symbol name (function, class, variable)"),
		recordedAtSha: z.string().optional().describe("Git SHA when this was recorded"),
		factId: z.string().optional().describe("Fact UUID — pass to update an existing fact"),
		version: z.number().int().optional().describe("Expected version for optimistic locking"),
		// Context-specific
		rationale: z.string().optional().describe("[context] Why this matters"),
		application: z.string().optional().describe("[context] How to apply this knowledge"),
		details: z.array(z.string()).optional().describe("[context] Supporting details"),
		audience: z.string().optional().describe("[context] Who should see it (all, agent, human)"),
		citedFiles: z.array(z.string()).optional().describe("[context] File paths this fact references"),
		surface: z.enum(VALID_SURFACES).optional().describe("[context] Visibility: ambient | indexed | surfaced"),
		// Measurement-specific
		value: z.number().optional().describe("[measurement] Numeric value"),
		unit: z.string().optional().describe("[measurement] Unit (e.g. ms, MB, s, bytes)"),
		env: z.record(z.string(), z.string()).optional().describe("[measurement] Environment key-value pairs"),
		recordedAt: z.string().optional().describe("[measurement] ISO 8601 when measured (defaults to now)"),
		ttl: z.number().int().optional().describe("[measurement] Time-to-live in days"),
	}),
	handler: (params) => safeExecute(async () => {
		const { type, projectId, content, author, path, symbol, recordedAtSha, factId, version } = params as {
			type: string; projectId: string; content: string; author: string;
			path?: string; symbol?: string; recordedAtSha?: string;
			factId?: string; version?: number;
		};

		const project = await db.project.findUnique({ where: { id: projectId } });
		if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

		// ── Context ───────────────────────────────
		if (type === "context") {
			const data = {
				projectId,
				claim: content,
				rationale: (params.rationale as string) ?? "",
				application: (params.application as string) ?? "",
				details: JSON.stringify((params.details as string[]) ?? []),
				author: author ?? "AGENT",
				audience: (params.audience as string) ?? "all",
				citedFiles: JSON.stringify((params.citedFiles as string[]) ?? []),
				recordedAtSha: recordedAtSha ?? null,
				surface: (params.surface as string) ?? "indexed",
			};

			if (factId) {
				const existing = await db.persistentContextEntry.findUnique({ where: { id: factId } });
				if (!existing) return err("Context entry not found.", "Check the factId and try again.");
				const conflict = checkVersionConflict(version, existing.version, "context entry");
				if (conflict) return conflict;
				const updated = await db.persistentContextEntry.update({
					where: { id: factId },
					data: { ...data, version: { increment: 1 } },
				});
				return ok(normalizeContext(updated));
			}

			const created = await db.persistentContextEntry.create({ data });
			return ok(normalizeContext(created));
		}

		// ── Code ──────────────────────────────────
		if (type === "code") {
			if (!path) return err("path is required for code facts.", "Provide the file path relative to the repo root.");

			const data = {
				projectId,
				path,
				fact: content,
				symbol: symbol ?? null,
				author: author ?? "AGENT",
				recordedAtSha: recordedAtSha ?? null,
				needsRecheck: false,
			};

			if (factId) {
				const existing = await db.codeFact.findUnique({ where: { id: factId } });
				if (!existing) return err("Code fact not found.", "Check the factId and try again.");
				const conflict = checkVersionConflict(version, existing.version, "code fact");
				if (conflict) return conflict;
				const updated = await db.codeFact.update({
					where: { id: factId },
					data: { ...data, lastVerifiedAt: new Date(), version: { increment: 1 } },
				});
				return ok(normalizeCode(updated));
			}

			const created = await db.codeFact.create({ data });
			return ok(normalizeCode(created));
		}

		// ── Measurement ───────────────────────────
		if (type === "measurement") {
			const value = params.value as number | undefined;
			const unit = params.unit as string | undefined;
			if (value == null || !unit) return err("value and unit are required for measurements.");

			const data = {
				projectId,
				value,
				unit,
				description: content,
				env: JSON.stringify((params.env as Record<string, string>) ?? {}),
				path: path ?? null,
				symbol: symbol ?? null,
				author: author ?? "AGENT",
				recordedAt: params.recordedAt ? new Date(params.recordedAt as string) : new Date(),
				ttl: (params.ttl as number) ?? null,
				needsRecheck: false,
			};

			if (factId) {
				const existing = await db.measurementFact.findUnique({ where: { id: factId } });
				if (!existing) return err("Measurement not found.", "Check the factId and try again.");
				const updated = await db.measurementFact.update({ where: { id: factId }, data });
				return ok(normalizeMeasurement(updated));
			}

			const created = await db.measurementFact.create({ data });
			return ok(normalizeMeasurement(created));
		}

		return err(`Invalid type "${type}".`, "Use: context, code, or measurement.");
	}),
});

// ─── listFacts ────────────────────────────────────────────────────

registerExtendedTool("listFacts", {
	category: "context",
	description: "List facts for a project. Omit type to list all types. Filter by path, surface, or recheck status.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		type: z.enum(FACT_TYPES).optional().describe("Filter by fact type"),
		path: z.string().optional().describe("Filter by exact file path (code/measurement)"),
		pathPrefix: z.string().optional().describe("Filter by path prefix (e.g. 'src/mcp/')"),
		surface: z.enum(VALID_SURFACES).optional().describe("Filter context entries by surface level"),
		needsRecheck: z.boolean().optional().describe("Filter code/measurement facts flagged for recheck"),
		author: z.string().optional().describe("Filter by author (AGENT or HUMAN)"),
		limit: z.number().int().min(1).max(200).default(50).describe("Max facts per type"),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) => safeExecute(async () => {
		const { projectId, type, path, pathPrefix, surface, needsRecheck, author, limit } = params as {
			projectId: string; type?: string; path?: string; pathPrefix?: string;
			surface?: string; needsRecheck?: boolean; author?: string; limit: number;
		};

		const project = await db.project.findUnique({ where: { id: projectId } });
		if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

		const results: Array<ReturnType<typeof normalizeContext> | ReturnType<typeof normalizeCode> | ReturnType<typeof normalizeMeasurement>> = [];

		// Context entries
		if (!type || type === "context") {
			const where: Record<string, unknown> = { projectId };
			if (surface) where.surface = surface;
			if (author) where.author = author;
			const entries = await db.persistentContextEntry.findMany({
				where, orderBy: { updatedAt: "desc" }, take: limit,
			});
			results.push(...entries.map(normalizeContext));
		}

		// Code facts
		if (!type || type === "code") {
			const where: Record<string, unknown> = { projectId };
			if (path) where.path = path;
			if (pathPrefix) where.path = { startsWith: pathPrefix };
			if (needsRecheck === true) where.needsRecheck = true;
			if (author) where.author = author;
			const facts = await db.codeFact.findMany({
				where, orderBy: { updatedAt: "desc" }, take: limit,
			});
			results.push(...facts.map(normalizeCode));
		}

		// Measurements
		if (!type || type === "measurement") {
			const where: Record<string, unknown> = { projectId };
			if (path) where.path = path;
			if (pathPrefix) where.path = { startsWith: pathPrefix };
			if (needsRecheck === true) where.needsRecheck = true;
			if (author) where.author = author;
			const measurements = await db.measurementFact.findMany({
				where, orderBy: { updatedAt: "desc" }, take: limit,
			});
			results.push(...measurements.map(normalizeMeasurement));
		}

		return ok({ facts: results, total: results.length });
	}),
});

// ─── getFact ──────────────────────────────────────────────────────

registerExtendedTool("getFact", {
	category: "context",
	description: "Get a single fact by ID. Searches across all fact types.",
	parameters: z.object({
		factId: z.string().describe("Fact UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ factId }) => safeExecute(async () => {
		const id = factId as string;

		const entry = await db.persistentContextEntry.findUnique({ where: { id } });
		if (entry) return ok(normalizeContext(entry));

		const codeFact = await db.codeFact.findUnique({ where: { id } });
		if (codeFact) return ok(normalizeCode(codeFact));

		const measurement = await db.measurementFact.findUnique({ where: { id } });
		if (measurement) return ok(normalizeMeasurement(measurement));

		return err("Fact not found.", "Check the factId and try again.");
	}),
});

// ─── deleteFact ───────────────────────────────────────────────────

registerExtendedTool("deleteFact", {
	category: "context",
	description: "Delete a fact by ID. Searches across all fact types.",
	parameters: z.object({
		factId: z.string().describe("Fact UUID"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ factId }) => safeExecute(async () => {
		const id = factId as string;

		const entry = await db.persistentContextEntry.findUnique({ where: { id } });
		if (entry) {
			await db.persistentContextEntry.delete({ where: { id } });
			return ok({ deleted: true, type: "context", content: entry.claim });
		}

		const codeFact = await db.codeFact.findUnique({ where: { id } });
		if (codeFact) {
			await db.codeFact.delete({ where: { id } });
			return ok({ deleted: true, type: "code", content: codeFact.fact, path: codeFact.path });
		}

		const measurement = await db.measurementFact.findUnique({ where: { id } });
		if (measurement) {
			await db.measurementFact.delete({ where: { id } });
			return ok({ deleted: true, type: "measurement", content: measurement.description, value: measurement.value, unit: measurement.unit });
		}

		return err("Fact not found.", "Check the factId and try again.");
	}),
});
