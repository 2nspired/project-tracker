import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, err, safeExecute } from "../utils.js";

// ─── Measurement Facts ──────────────────────────────────────────

function parseMeasurement(measurement: {
	id: string;
	projectId: string;
	value: number;
	unit: string;
	description: string;
	env: string;
	path: string | null;
	symbol: string | null;
	author: string;
	recordedAt: Date;
	ttl: number | null;
	needsRecheck: boolean;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: measurement.id,
		projectId: measurement.projectId,
		value: measurement.value,
		unit: measurement.unit,
		description: measurement.description,
		env: JSON.parse(measurement.env) as Record<string, unknown>,
		path: measurement.path,
		symbol: measurement.symbol,
		author: measurement.author,
		recordedAt: measurement.recordedAt,
		ttl: measurement.ttl,
		needsRecheck: measurement.needsRecheck,
		createdAt: measurement.createdAt,
		updatedAt: measurement.updatedAt,
	};
}

registerExtendedTool("saveMeasurement", {
	category: "context",
	description:
		"Create or update a measurement fact — an environment-dependent numeric value like latency, memory usage, build time, bundle size, or test duration. Pass measurementId to update an existing measurement.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		value: z.number().describe("Numeric measurement value"),
		unit: z.string().describe("Unit of measurement (e.g. 'ms', 'MB', 's', 'bytes', 'count')"),
		description: z.string().describe("What this measurement represents"),
		env: z.record(z.string(), z.string()).default({}).describe("Environment key-value pairs (e.g. { node: '20', os: 'linux' })"),
		path: z.string().optional().describe("File path relative to repo root"),
		symbol: z.string().optional().describe("Optional symbol name (function, class, endpoint)"),
		author: z.string().default("AGENT").describe("Who recorded this (AGENT or HUMAN)"),
		recordedAt: z.string().optional().describe("ISO 8601 timestamp when measured (defaults to now)"),
		ttl: z.number().int().optional().describe("Time-to-live in days — measurement expires after this"),
		measurementId: z.string().optional().describe("Measurement UUID — pass to update an existing measurement"),
	}),
	handler: ({ projectId, value, unit, description, env, path, symbol, author, recordedAt, ttl, measurementId }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const data = {
				projectId: projectId as string,
				value: value as number,
				unit: unit as string,
				description: description as string,
				env: JSON.stringify((env as Record<string, string>) ?? {}),
				path: (path as string) ?? null,
				symbol: (symbol as string) ?? null,
				author: (author as string) ?? "AGENT",
				recordedAt: recordedAt ? new Date(recordedAt as string) : new Date(),
				ttl: (ttl as number) ?? null,
				needsRecheck: false,
			};

			if (measurementId) {
				const existing = await db.measurementFact.findUnique({ where: { id: measurementId as string } });
				if (!existing) return err("Measurement not found.", "Check the measurementId and try again.");

				const updated = await db.measurementFact.update({
					where: { id: measurementId as string },
					data,
				});
				return ok(parseMeasurement(updated));
			}

			const created = await db.measurementFact.create({ data });
			return ok(parseMeasurement(created));
		}),
});

registerExtendedTool("listMeasurements", {
	category: "context",
	description: "List measurement facts for a project, optionally filtered by path or recheck status.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		path: z.string().optional().describe("Filter by file path (exact match)"),
		pathPrefix: z.string().optional().describe("Filter by path prefix (e.g. 'src/server/' for all server measurements)"),
		needsRecheck: z.boolean().optional().describe("Filter to only measurements flagged for recheck"),
		limit: z.number().int().min(1).max(200).default(50).describe("Max measurements to return"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, path, pathPrefix, needsRecheck, limit }) =>
		safeExecute(async () => {
			const project = await db.project.findUnique({ where: { id: projectId as string } });
			if (!project) return err("Project not found.", "Use listProjects to find a valid projectId.");

			const where: Record<string, unknown> = { projectId: projectId as string };
			if (path) where.path = path as string;
			if (pathPrefix) where.path = { startsWith: pathPrefix as string };
			if (needsRecheck === true) where.needsRecheck = true;

			const measurements = await db.measurementFact.findMany({
				where,
				orderBy: { updatedAt: "desc" },
				take: (limit as number) ?? 50,
			});

			return ok({
				measurements: measurements.map(parseMeasurement),
				total: measurements.length,
			});
		}),
});

registerExtendedTool("getMeasurement", {
	category: "context",
	description: "Get a single measurement fact by ID.",
	parameters: z.object({
		measurementId: z.string().describe("Measurement UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ measurementId }) =>
		safeExecute(async () => {
			const measurement = await db.measurementFact.findUnique({
				where: { id: measurementId as string },
			});
			if (!measurement) return err("Measurement not found.", "Check the measurementId and try again.");

			return ok(parseMeasurement(measurement));
		}),
});

registerExtendedTool("deleteMeasurement", {
	category: "context",
	description: "Delete a measurement fact.",
	parameters: z.object({
		measurementId: z.string().describe("Measurement UUID"),
	}),
	annotations: { destructiveHint: true },
	handler: ({ measurementId }) =>
		safeExecute(async () => {
			const measurement = await db.measurementFact.findUnique({
				where: { id: measurementId as string },
			});
			if (!measurement) return err("Measurement not found.", "Check the measurementId and try again.");

			await db.measurementFact.delete({ where: { id: measurementId as string } });

			return ok({ deleted: true, description: measurement.description, value: measurement.value, unit: measurement.unit });
		}),
});
