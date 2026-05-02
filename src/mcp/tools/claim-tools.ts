import { z } from "zod";
import { CLAIM_KINDS, CLAIM_STATUSES, claimEvidenceSchema } from "@/lib/schemas/claim-schemas";
import { createClaimService } from "@/lib/services/claim";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, err, errWithToolHint, ok, resolveCardRef, safeExecute } from "../utils.js";

// ─── RFC Note+Claim — commit 3: service-backed writes ────────────
//
// saveClaim / listClaims now delegate to claim-service, which runs
// per-kind Zod validation on evidence + payload at the service
// boundary (RFC amendment #2). No reader switch yet — the old
// fact/decision/handoff tools keep their current behavior until
// commit 5. Legacy tool aliasing lands in commit 6.

const claimService = createClaimService(db);

// ─── saveClaim ────────────────────────────────────────────────────

registerExtendedTool("saveClaim", {
	category: "context",
	description: `Create or update a Claim — a typed assertion with evidence. Pass claimId to update.

This is the RFC-v2 replacement for saveFact/recordDecision. Old tools still work; use saveClaim for new writes when you want the unified shape (statement + body + evidence + payload).

Kinds:
- context: project-level knowledge claim (payload: { application?, audience?, surface? })
- code: assertion about a file or symbol (evidence.files or evidence.symbols required)
- measurement: numeric value (payload.value + payload.unit required)
- decision: architectural decision (payload: { alternatives? })`,
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		kind: z.enum(CLAIM_KINDS).describe("Claim kind"),
		statement: z.string().min(1).describe("One-sentence assertion (shown in lists)"),
		body: z.string().default("").describe("Markdown elaboration"),
		evidence: claimEvidenceSchema.default({}).describe("Citations — files, symbols, urls, cardIds"),
		payload: z
			.record(z.string(), z.unknown())
			.default({})
			.describe("Kind-specific structured data — see description"),
		author: z
			.string()
			.default(() => AGENT_NAME)
			.describe("AGENT_NAME or HUMAN"),
		cardId: z.string().optional().describe("Card UUID or #number — optional anchor"),
		status: z.enum(CLAIM_STATUSES).default("active"),
		supersedesId: z
			.string()
			.optional()
			.describe("Claim UUID this one replaces — old claim marked superseded and cross-linked"),
		recordedAtSha: z.string().optional().describe("Git SHA at record time (code/measurement)"),
		verifiedAt: z.string().optional().describe("ISO datetime — defaults to now on create"),
		expiresAt: z.string().optional().describe("ISO datetime — TTL (measurement)"),
		claimId: z.string().optional().describe("Claim UUID — pass to update"),
	}),
	handler: (params) =>
		safeExecute(async () => {
			const {
				projectId,
				kind,
				statement,
				body,
				evidence,
				payload,
				author,
				cardId: cardRef,
				status,
				supersedesId,
				recordedAtSha,
				verifiedAt,
				expiresAt,
				claimId,
			} = params as {
				projectId: string;
				kind: (typeof CLAIM_KINDS)[number];
				statement: string;
				body: string;
				evidence: Record<string, unknown>;
				payload: Record<string, unknown>;
				author: string;
				cardId?: string;
				status: (typeof CLAIM_STATUSES)[number];
				supersedesId?: string;
				recordedAtSha?: string;
				verifiedAt?: string;
				expiresAt?: string;
				claimId?: string;
			};

			const project = await db.project.findUnique({ where: { id: projectId } });
			if (!project) return errWithToolHint("Project not found.", "listProjects", {});

			let resolvedCardId: string | null = null;
			if (cardRef) {
				const resolved = await resolveCardRef(cardRef, projectId);
				if (!resolved.ok) return err(resolved.message);
				resolvedCardId = resolved.id;
			}

			const shared = {
				kind,
				statement,
				body,
				evidence,
				payload,
				author,
				cardId: resolvedCardId,
				status,
				recordedAtSha: recordedAtSha ?? null,
				verifiedAt: verifiedAt ? new Date(verifiedAt) : undefined,
				expiresAt: expiresAt ? new Date(expiresAt) : null,
			};

			if (claimId) {
				const result = await claimService.update(claimId, shared);
				if (!result.success) return err(result.error.message);
				return ok(result.data);
			}

			const result = await claimService.create({
				projectId,
				...shared,
				...(supersedesId && { supersedesId }),
			});
			if (!result.success) return err(result.error.message);
			return ok(result.data);
		}),
});

// ─── listClaims ───────────────────────────────────────────────────

registerExtendedTool("listClaims", {
	category: "context",
	description:
		"List claims for a project. Omit kind to include all kinds. Pass claimId for single-claim lookup.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		claimId: z.string().optional().describe("Fetch a single claim by UUID"),
		kind: z.enum(CLAIM_KINDS).optional().describe("Filter by kind"),
		cardId: z.string().optional().describe("Filter by card UUID or #number"),
		status: z.enum(CLAIM_STATUSES).optional().describe("Filter by status"),
		author: z.string().optional().describe("Filter by author"),
		limit: z.number().int().min(1).max(200).default(50),
	}),
	annotations: { readOnlyHint: true },
	handler: (params) =>
		safeExecute(async () => {
			const {
				projectId,
				claimId,
				kind,
				cardId: cardRef,
				status,
				author,
				limit,
			} = params as {
				projectId: string;
				claimId?: string;
				kind?: (typeof CLAIM_KINDS)[number];
				cardId?: string;
				status?: (typeof CLAIM_STATUSES)[number];
				author?: string;
				limit: number;
			};

			if (claimId) {
				const result = await claimService.getById(claimId);
				if (!result.success) return err(result.error.message);
				return ok({ claims: [result.data], total: 1 });
			}

			const project = await db.project.findUnique({ where: { id: projectId } });
			if (!project) return errWithToolHint("Project not found.", "listProjects", {});

			let resolvedCardId: string | undefined;
			if (cardRef) {
				const resolved = await resolveCardRef(cardRef, projectId);
				if (!resolved.ok) return err(resolved.message);
				resolvedCardId = resolved.id;
			}

			const result = await claimService.list(projectId, {
				...(kind && { kind }),
				...(resolvedCardId && { cardId: resolvedCardId }),
				...(status && { status }),
				...(author && { author }),
				limit,
			});
			if (!result.success) return err(result.error.message);
			return ok({ claims: result.data, total: result.data.length });
		}),
});
