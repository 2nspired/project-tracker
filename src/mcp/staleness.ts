import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db.js";

const execFileAsync = promisify(execFile);

const EXEC_OPTS = { timeout: 5000, maxBuffer: 1024 * 1024 };

// ─── Age thresholds (days) ─────────────────────────────────────────

const AGENT_POSSIBLY_STALE_DAYS = 14;
const AGENT_STALE_DAYS = 30;
const HUMAN_POSSIBLY_STALE_DAYS = 30;
const HUMAN_STALE_DAYS = 60;

// ─── Types ─────────────────────────────────────────────────────────

export type StalenessWarning = {
	entryId: string;
	claim: string;
	reason: string;
	type: "file-changed" | "age-decay" | "ttl-expired" | "superseded";
	severity: "stale" | "possibly-stale";
	source?: "context-entry" | "code-fact" | "measurement" | "decision";
};

// ─── Core ──────────────────────────────────────────────────────────

export async function checkStaleness(projectId: string): Promise<StalenessWarning[]> {
	// Check context entries, code facts, and measurements in parallel
	const [entryWarnings, codeFactWarnings, measurementWarnings, decisionWarnings] = await Promise.all([
		checkContextEntryStaleness(projectId),
		checkCodeFactStaleness(projectId),
		checkMeasurementStaleness(projectId),
		checkDecisionStaleness(projectId),
	]);

	return [...entryWarnings, ...codeFactWarnings, ...measurementWarnings, ...decisionWarnings];
}

async function checkContextEntryStaleness(projectId: string): Promise<StalenessWarning[]> {
	const entries = await db.persistentContextEntry.findMany({
		where: { projectId },
	});

	if (entries.length === 0) return [];

	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { repoPath: true },
	});

	const warnings: StalenessWarning[] = [];
	const now = Date.now();

	for (const entry of entries) {
		const citedFiles = JSON.parse(entry.citedFiles) as string[];

		if (citedFiles.length > 0 && entry.recordedAtSha) {
			// File-cited staleness (Bazel-style SHA comparison)
			if (!project?.repoPath) continue;

			const fileWarning = await checkFileCitedStaleness(
				entry.id,
				entry.claim,
				citedFiles,
				entry.recordedAtSha,
				project.repoPath,
			);
			if (fileWarning) {
				warnings.push({ ...fileWarning, source: "context-entry" });
			}
		} else {
			// Narrative staleness (age-based)
			const ageDays = Math.floor((now - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24));
			const isAgent = entry.author === "AGENT";

			const staleDays = isAgent ? AGENT_STALE_DAYS : HUMAN_STALE_DAYS;
			const possiblyStaleDays = isAgent ? AGENT_POSSIBLY_STALE_DAYS : HUMAN_POSSIBLY_STALE_DAYS;

			if (ageDays >= staleDays) {
				warnings.push({
					entryId: entry.id,
					claim: entry.claim,
					reason: isAgent
						? `Agent-recorded fact, ${ageDays} days old without review`
						: `Human-recorded fact, ${ageDays} days old`,
					type: "age-decay",
					severity: "stale",
					source: "context-entry",
				});
			} else if (ageDays >= possiblyStaleDays) {
				warnings.push({
					entryId: entry.id,
					claim: entry.claim,
					reason: isAgent
						? `Agent-recorded fact, ${ageDays} days old without review`
						: `Human-recorded fact, ${ageDays} days old`,
					type: "age-decay",
					severity: "possibly-stale",
					source: "context-entry",
				});
			}
		}
	}

	return warnings;
}

async function checkFileCitedStaleness(
	entryId: string,
	claim: string,
	citedFiles: string[],
	recordedAtSha: string,
	repoPath: string,
): Promise<StalenessWarning | null> {
	for (const filePath of citedFiles) {
		try {
			const { stdout } = await execFileAsync(
				"git",
				["log", "-1", "--format=%H", "--", filePath],
				{ ...EXEC_OPTS, cwd: repoPath },
			);

			const latestSha = stdout.trim();
			if (!latestSha) continue;

			if (latestSha !== recordedAtSha) {
				return {
					entryId,
					claim,
					reason: `Cited file \`${filePath}\` changed since this was recorded (recorded at ${recordedAtSha.slice(0, 7)}, now at ${latestSha.slice(0, 7)})`,
					type: "file-changed",
					severity: "stale",
				};
			}
		} catch {
			// Git operation failed — skip this file, don't fail the whole check
			continue;
		}
	}

	return null;
}

// ─── Code Fact Staleness ──────────────────────────────────────────

export async function checkCodeFactStaleness(projectId: string): Promise<StalenessWarning[]> {
	const facts = await db.codeFact.findMany({
		where: { projectId },
	});

	if (facts.length === 0) return [];

	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { repoPath: true },
	});

	if (!project?.repoPath) return [];

	const warnings: StalenessWarning[] = [];

	for (const fact of facts) {
		if (!fact.recordedAtSha) continue;

		const fileWarning = await checkFileCitedStaleness(
			fact.id,
			`[${fact.path}${fact.symbol ? `#${fact.symbol}` : ""}] ${fact.fact}`,
			[fact.path],
			fact.recordedAtSha,
			project.repoPath,
		);
		if (fileWarning) {
			warnings.push({ ...fileWarning, source: "code-fact" });

			// Also flag the fact as needs_recheck
			await db.codeFact.update({
				where: { id: fact.id },
				data: { needsRecheck: true },
			}).catch(() => {});
		}
	}

	return warnings;
}

// ─── Measurement Fact Staleness ──────────────────────────────────

export async function checkMeasurementStaleness(projectId: string): Promise<StalenessWarning[]> {
	const measurements = await db.measurementFact.findMany({
		where: { projectId },
	});

	if (measurements.length === 0) return [];

	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { repoPath: true },
	});

	const warnings: StalenessWarning[] = [];
	const now = Date.now();

	for (const m of measurements) {
		const claim = `[${m.description}] ${m.value} ${m.unit}`;
		let flagged = false;

		// 1. TTL-based staleness (highest priority)
		if (m.ttl != null) {
			const expiresAt = m.recordedAt.getTime() + m.ttl * 24 * 60 * 60 * 1000;
			if (now > expiresAt) {
				const ageDays = Math.floor((now - m.recordedAt.getTime()) / (1000 * 60 * 60 * 24));
				warnings.push({
					entryId: m.id,
					claim,
					reason: `TTL of ${m.ttl}d expired (recorded ${ageDays}d ago)`,
					type: "ttl-expired",
					severity: "stale",
					source: "measurement",
				});
				flagged = true;
			}
		}

		// 2. Env code SHA drift (if path + SHA present in env)
		if (!flagged && m.path && project?.repoPath) {
			try {
				const env = JSON.parse(m.env) as Record<string, string>;
				const sha = env.sha ?? env.codeSha;
				if (sha) {
					const fileWarning = await checkFileCitedStaleness(
						m.id,
						claim,
						[m.path],
						sha,
						project.repoPath,
					);
					if (fileWarning) {
						warnings.push({ ...fileWarning, source: "measurement" });
						flagged = true;
					}
				}
			} catch {
				// Invalid env JSON — skip SHA check
			}
		}

		// 3. Age-based fallback (only if no TTL set)
		if (!flagged && m.ttl == null) {
			const ageDays = Math.floor((now - m.recordedAt.getTime()) / (1000 * 60 * 60 * 24));
			const isAgent = m.author === "AGENT";

			const staleDays = isAgent ? AGENT_STALE_DAYS : HUMAN_STALE_DAYS;
			const possiblyStaleDays = isAgent ? AGENT_POSSIBLY_STALE_DAYS : HUMAN_POSSIBLY_STALE_DAYS;

			if (ageDays >= staleDays) {
				warnings.push({
					entryId: m.id,
					claim,
					reason: isAgent
						? `Agent-recorded measurement, ${ageDays} days old without review`
						: `Human-recorded measurement, ${ageDays} days old`,
					type: "age-decay",
					severity: "stale",
					source: "measurement",
				});
				flagged = true;
			} else if (ageDays >= possiblyStaleDays) {
				warnings.push({
					entryId: m.id,
					claim,
					reason: isAgent
						? `Agent-recorded measurement, ${ageDays} days old without review`
						: `Human-recorded measurement, ${ageDays} days old`,
					type: "age-decay",
					severity: "possibly-stale",
					source: "measurement",
				});
				flagged = true;
			}
		}

		// Flag measurement as needs_recheck if stale
		if (flagged) {
			await db.measurementFact.update({
				where: { id: m.id },
				data: { needsRecheck: true },
			}).catch(() => {});
		}
	}

	return warnings;
}

// ─── Decision Staleness ──────────────────────────────────────────

export async function checkDecisionStaleness(projectId: string): Promise<StalenessWarning[]> {
	const decisions = await db.decision.findMany({
		where: { projectId, status: "superseded" },
	});

	return decisions.map((d) => ({
		entryId: d.id,
		claim: d.title,
		reason: d.supersededBy
			? `Superseded by decision ${d.supersededBy.slice(0, 8)}… — use the newer decision instead`
			: "Marked as superseded but no replacement linked",
		type: "superseded" as const,
		severity: "stale" as const,
		source: "decision" as const,
	}));
}

// ─── Formatting ────────────────────────────────────────────────────

export function formatStalenessWarnings(warnings: StalenessWarning[]): string | null {
	if (warnings.length === 0) return null;

	const entryWarnings = warnings.filter((w) => w.source === "context-entry" || (!w.source && w.source !== "decision"));
	const codeFactWarnings = warnings.filter((w) => w.source === "code-fact");
	const measurementWarnings = warnings.filter((w) => w.source === "measurement");
	const decisionWarnings = warnings.filter((w) => w.source === "decision");

	const sections: string[] = [
		"\u26a0\ufe0f STALE CONTEXT WARNINGS",
		"The following persistent knowledge may be outdated:",
		"",
	];

	if (entryWarnings.length > 0) {
		sections.push(...entryWarnings.map((w) =>
			`- **[${w.severity}]** "${w.claim}" — ${w.reason}`
		));
	}

	if (codeFactWarnings.length > 0) {
		if (entryWarnings.length > 0) sections.push("");
		sections.push("**Code facts:**");
		sections.push(...codeFactWarnings.map((w) =>
			`- **[${w.severity}]** ${w.claim} — ${w.reason}`
		));
	}

	if (measurementWarnings.length > 0) {
		if (entryWarnings.length > 0 || codeFactWarnings.length > 0) sections.push("");
		sections.push("**Measurements:**");
		sections.push(...measurementWarnings.map((w) =>
			`- **[${w.severity}]** ${w.claim} — ${w.reason}`
		));
	}

	if (decisionWarnings.length > 0) {
		if (entryWarnings.length > 0 || codeFactWarnings.length > 0 || measurementWarnings.length > 0) sections.push("");
		sections.push("**Decisions:**");
		sections.push(...decisionWarnings.map((w) =>
			`- **[${w.severity}]** ${w.claim} — ${w.reason}`
		));
	}

	sections.push(
		"",
		"Use `listContextEntries`/`listCodeFacts`/`listMeasurements` to review, `saveContextEntry`/`saveCodeFact`/`saveMeasurement` to update, or the delete tools to remove stale entries.",
	);

	return sections.join("\n");
}
