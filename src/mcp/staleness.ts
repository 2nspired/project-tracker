import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Claim } from "prisma/generated/client";
import { db } from "@/mcp/db";

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

type ClaimEvidence = { files?: string[]; symbols?: string[] };
type ClaimPayload = Record<string, unknown>;

// ─── Core ──────────────────────────────────────────────────────────

export async function checkStaleness(projectId: string): Promise<StalenessWarning[]> {
	const [claims, project] = await Promise.all([
		db.claim.findMany({ where: { projectId } }),
		db.project.findUnique({
			where: { id: projectId },
			select: { repoPath: true },
		}),
	]);

	const warnings: StalenessWarning[] = [];
	for (const claim of claims) {
		const warning = await evaluateClaim(claim, project?.repoPath ?? null);
		if (warning) warnings.push(warning);
	}
	return warnings;
}

async function evaluateClaim(
	claim: Claim,
	repoPath: string | null
): Promise<StalenessWarning | null> {
	switch (claim.kind) {
		case "context":
			return evaluateContext(claim, repoPath);
		case "code":
			return evaluateCode(claim, repoPath);
		case "measurement":
			return evaluateMeasurement(claim, repoPath);
		case "decision":
			return evaluateDecision(claim);
		default:
			return null;
	}
}

async function evaluateContext(
	claim: Claim,
	repoPath: string | null
): Promise<StalenessWarning | null> {
	const evidence = JSON.parse(claim.evidence) as ClaimEvidence;
	const files = evidence.files ?? [];

	if (files.length > 0 && claim.recordedAtSha && repoPath) {
		const fileWarning = await checkFileCitedStaleness(
			claim.id,
			claim.statement,
			files,
			claim.recordedAtSha,
			repoPath
		);
		if (fileWarning) return { ...fileWarning, source: "context-entry" };
	}

	const ageWarning = ageBased(claim.id, claim.statement, claim.createdAt, claim.author, "fact");
	return ageWarning ? { ...ageWarning, source: "context-entry" } : null;
}

async function evaluateCode(
	claim: Claim,
	repoPath: string | null
): Promise<StalenessWarning | null> {
	if (!claim.recordedAtSha || !repoPath) return null;
	const evidence = JSON.parse(claim.evidence) as ClaimEvidence;
	const files = evidence.files ?? [];
	if (files.length === 0) return null;

	const label = `[${files[0]}${(evidence.symbols ?? [])[0] ? `#${(evidence.symbols ?? [])[0]}` : ""}] ${claim.statement}`;
	const warning = await checkFileCitedStaleness(
		claim.id,
		label,
		files,
		claim.recordedAtSha,
		repoPath
	);
	return warning ? { ...warning, source: "code-fact" } : null;
}

async function evaluateMeasurement(
	claim: Claim,
	repoPath: string | null
): Promise<StalenessWarning | null> {
	const payload = JSON.parse(claim.payload) as ClaimPayload;
	const evidence = JSON.parse(claim.evidence) as ClaimEvidence;
	const value = payload.value as number | undefined;
	const unit = payload.unit as string | undefined;
	const label = value != null && unit ? `[${claim.statement}] ${value} ${unit}` : claim.statement;
	const now = Date.now();

	// 1. TTL-based expiry (encoded as expiresAt on Claim).
	if (claim.expiresAt && now > claim.expiresAt.getTime()) {
		const ageDays = Math.floor((now - claim.createdAt.getTime()) / (1000 * 60 * 60 * 24));
		return {
			entryId: claim.id,
			claim: label,
			reason: `TTL expired (recorded ${ageDays}d ago)`,
			type: "ttl-expired",
			severity: "stale",
			source: "measurement",
		};
	}

	// 2. Env-SHA code drift.
	const env = (payload.env ?? {}) as Record<string, string>;
	const sha = env.sha ?? env.codeSha;
	const files = evidence.files ?? [];
	if (sha && files.length > 0 && repoPath) {
		const warning = await checkFileCitedStaleness(claim.id, label, files, sha, repoPath);
		if (warning) return { ...warning, source: "measurement" };
	}

	// 3. Age fallback only when no TTL was set.
	if (!claim.expiresAt) {
		const ageWarning = ageBased(claim.id, label, claim.createdAt, claim.author, "measurement");
		if (ageWarning) return { ...ageWarning, source: "measurement" };
	}

	return null;
}

function evaluateDecision(claim: Claim): StalenessWarning | null {
	if (claim.status !== "superseded") return null;
	return {
		entryId: claim.id,
		claim: claim.statement,
		reason: claim.supersededById
			? `Superseded by decision ${claim.supersededById.slice(0, 8)}… — use the newer decision instead`
			: "Marked as superseded but no replacement linked",
		type: "superseded",
		severity: "stale",
		source: "decision",
	};
}

// ─── Helpers ──────────────────────────────────────────────────────

function ageBased(
	entryId: string,
	claim: string,
	createdAt: Date,
	author: string,
	noun: "fact" | "measurement"
): StalenessWarning | null {
	const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
	const isAgent = author === "AGENT";
	const staleDays = isAgent ? AGENT_STALE_DAYS : HUMAN_STALE_DAYS;
	const possiblyStaleDays = isAgent ? AGENT_POSSIBLY_STALE_DAYS : HUMAN_POSSIBLY_STALE_DAYS;

	const reason = isAgent
		? `Agent-recorded ${noun}, ${ageDays} days old without review`
		: `Human-recorded ${noun}, ${ageDays} days old`;

	if (ageDays >= staleDays) {
		return { entryId, claim, reason, type: "age-decay", severity: "stale" };
	}
	if (ageDays >= possiblyStaleDays) {
		return { entryId, claim, reason, type: "age-decay", severity: "possibly-stale" };
	}
	return null;
}

async function checkFileCitedStaleness(
	entryId: string,
	claim: string,
	citedFiles: string[],
	recordedAtSha: string,
	repoPath: string
): Promise<StalenessWarning | null> {
	for (const filePath of citedFiles) {
		try {
			const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%H", "--", filePath], {
				...EXEC_OPTS,
				cwd: repoPath,
			});

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
		} catch {}
	}

	return null;
}

// ─── Formatting ────────────────────────────────────────────────────

export function formatStalenessWarnings(warnings: StalenessWarning[]): string | null {
	if (warnings.length === 0) return null;

	const entryWarnings = warnings.filter((w) => w.source === "context-entry");
	const codeFactWarnings = warnings.filter((w) => w.source === "code-fact");
	const measurementWarnings = warnings.filter((w) => w.source === "measurement");
	const decisionWarnings = warnings.filter((w) => w.source === "decision");

	const sections: string[] = [
		"\u26a0\ufe0f STALE CONTEXT WARNINGS",
		"The following persistent knowledge may be outdated:",
		"",
	];

	if (entryWarnings.length > 0) {
		sections.push(...entryWarnings.map((w) => `- **[${w.severity}]** "${w.claim}" — ${w.reason}`));
	}

	if (codeFactWarnings.length > 0) {
		if (entryWarnings.length > 0) sections.push("");
		sections.push("**Code facts:**");
		sections.push(...codeFactWarnings.map((w) => `- **[${w.severity}]** ${w.claim} — ${w.reason}`));
	}

	if (measurementWarnings.length > 0) {
		if (entryWarnings.length > 0 || codeFactWarnings.length > 0) sections.push("");
		sections.push("**Measurements:**");
		sections.push(
			...measurementWarnings.map((w) => `- **[${w.severity}]** ${w.claim} — ${w.reason}`)
		);
	}

	if (decisionWarnings.length > 0) {
		if (entryWarnings.length > 0 || codeFactWarnings.length > 0 || measurementWarnings.length > 0)
			sections.push("");
		sections.push("**Decisions:**");
		sections.push(...decisionWarnings.map((w) => `- **[${w.severity}]** ${w.claim} — ${w.reason}`));
	}

	sections.push("", "Use `listClaims` to review and `saveClaim` to refresh stale entries.");

	return sections.join("\n");
}
