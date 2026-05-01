import { z } from "zod";
import { createClaimService } from "@/server/services/claim-service";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, err, ok, resolveCardRef, safeExecute } from "../utils.js";

const claimService = createClaimService(db);

// Map the new 3-value Claim status back to the legacy 4-value Decision
// enum so existing agents keep seeing familiar strings. "active" claims
// are reported as "accepted" — in the cutover, proposed/accepted legacy
// rows both collapsed into "active", so "accepted" is the safer default.
const STATUS_CLAIM_TO_LEGACY: Record<string, string> = {
	active: "accepted",
	superseded: "superseded",
	retired: "rejected",
};

// Inverse for accepting a legacy status filter on read / write.
const STATUS_LEGACY_TO_CLAIM: Record<string, string> = {
	proposed: "active",
	accepted: "active",
	superseded: "superseded",
	rejected: "retired",
};

// ─── Decisions ─────────────────────────────────────────────────────

registerExtendedTool("recordDecision", {
	category: "decisions",
	description:
		"Record an architectural decision so the rationale survives session boundaries. Use when you've chosen an approach (framework, pattern, tradeoff) and the next agent or human needs the reasoning. Pass `supersedesId` to chain a replacement when a later decision overrides this one. For new code, prefer `saveClaim({ kind: \"decision\", ... })` — `recordDecision` is a thin alias kept for back-compat.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		cardId: z.string().optional().describe("Card UUID or #number"),
		title: z.string().describe("Decision title"),
		status: z.enum(["proposed", "accepted", "rejected", "superseded"]).default("proposed"),
		decision: z.string().describe("The decision text"),
		alternatives: z.array(z.string()).default([]).describe("Alternatives considered"),
		rationale: z.string().default("").describe("Why this decision was made"),
		supersedesId: z
			.string()
			.optional()
			.describe(
				"ID of the decision this one supersedes — the old decision will be marked as superseded and linked"
			),
	}),
	handler: ({
		projectId,
		cardId,
		title,
		status,
		decision,
		alternatives,
		rationale,
		supersedesId,
	}) =>
		safeExecute(async () => {
			let resolvedCardId: string | null = null;
			if (cardId) {
				const resolved = await resolveCardRef(cardId as string, projectId as string);
				if (!resolved.ok) return err(resolved.message);
				resolvedCardId = resolved.id;
			}

			const body = rationale
				? `${decision as string}\n\n${rationale as string}`
				: (decision as string);

			const result = await claimService.create({
				projectId: projectId as string,
				kind: "decision",
				statement: title as string,
				body,
				evidence: {},
				payload: { alternatives: (alternatives as string[] | undefined) ?? [] },
				author: AGENT_NAME,
				cardId: resolvedCardId,
				status: STATUS_LEGACY_TO_CLAIM[(status as string) ?? "proposed"] as
					| "active"
					| "superseded"
					| "retired",
				...(supersedesId ? { supersedesId: supersedesId as string } : {}),
			});
			if (!result.success) return err(result.error.message);

			const created = result.data;
			const card = created.cardId
				? await db.card.findUnique({
						where: { id: created.cardId },
						select: { number: true, title: true },
					})
				: null;

			return ok({
				id: created.id,
				title: created.statement,
				status: STATUS_CLAIM_TO_LEGACY[created.status] ?? created.status,
				supersedes: created.supersedesId,
				supersededBy: created.supersededById,
				card: card ? { ref: `#${card.number}`, title: card.title } : null,
				created: true,
			});
		}),
});

registerExtendedTool("getDecisions", {
	category: "decisions",
	description: "List decisions for a project, optionally filtered by card or status.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		cardId: z.string().optional().describe("Card UUID or #number"),
		status: z.enum(["proposed", "accepted", "rejected", "superseded"]).optional(),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, cardId, status }) =>
		safeExecute(async () => {
			let resolvedCardId: string | undefined;
			if (cardId) {
				const resolved = await resolveCardRef(cardId as string, projectId as string);
				if (!resolved.ok) return err(resolved.message);
				resolvedCardId = resolved.id;
			}

			const where: Record<string, unknown> = {
				projectId: projectId as string,
				kind: "decision",
			};
			if (resolvedCardId) where.cardId = resolvedCardId;
			if (status) where.status = STATUS_LEGACY_TO_CLAIM[status as string] ?? status;

			const claims = await db.claim.findMany({
				where,
				orderBy: { createdAt: "desc" },
				include: { card: { select: { id: true, number: true, title: true } } },
			});

			return ok(
				claims.map((c) => {
					const payload = JSON.parse(c.payload) as { alternatives?: string[] };
					// Body was stored as "decision\n\nrationale" during the
					// backfill; split on the first blank line to reconstruct
					// the legacy shape for readers.
					const [decisionText, ...rationaleLines] = c.body.split(/\n{2,}/);
					return {
						id: c.id,
						title: c.statement,
						status: STATUS_CLAIM_TO_LEGACY[c.status] ?? c.status,
						decision: decisionText ?? c.body,
						alternatives: payload.alternatives ?? [],
						rationale: rationaleLines.join("\n\n"),
						author: c.author,
						supersedes: c.supersedesId,
						supersededBy: c.supersededById,
						card: c.card ? { ref: `#${c.card.number}`, title: c.card.title } : null,
						createdAt: c.createdAt,
					};
				})
			);
		}),
});

registerExtendedTool("updateDecision", {
	category: "decisions",
	description: "Update a decision's status, text, or rationale.",
	parameters: z.object({
		decisionId: z.string().describe("Decision UUID"),
		status: z.enum(["proposed", "accepted", "rejected", "superseded"]).optional(),
		decision: z.string().optional().describe("Updated decision text"),
		rationale: z.string().optional().describe("Updated rationale"),
		alternatives: z.array(z.string()).optional().describe("Updated alternatives"),
		supersedesId: z
			.string()
			.optional()
			.describe(
				"ID of the decision this one supersedes — sets old decision to superseded and links them"
			),
	}),
	annotations: { idempotentHint: true },
	handler: ({ decisionId, status, decision, rationale, alternatives, supersedesId }) =>
		safeExecute(async () => {
			const existing = await db.claim.findUnique({ where: { id: decisionId as string } });
			if (!existing || existing.kind !== "decision")
				return err("Decision not found.", "Use getDecisions to find valid decision IDs.");

			// Supersession: create a NEW claim via claimService (which flips
			// the old one to status="superseded" atomically). Otherwise plain
			// update on the existing claim.
			if (supersedesId) {
				const old = await db.claim.findUnique({ where: { id: supersedesId as string } });
				if (!old || old.kind !== "decision")
					return err("Superseded decision not found.", "Check the supersedesId.");

				const existingPayload = JSON.parse(existing.payload) as { alternatives?: string[] };
				const existingBody = existing.body;
				const [oldDecisionText, ...oldRationale] = existingBody.split(/\n{2,}/);
				const nextDecision =
					decision !== undefined ? (decision as string) : (oldDecisionText ?? existingBody);
				const nextRationale =
					rationale !== undefined ? (rationale as string) : oldRationale.join("\n\n");
				const nextBody = nextRationale ? `${nextDecision}\n\n${nextRationale}` : nextDecision;
				const nextAlternatives =
					alternatives !== undefined
						? (alternatives as string[])
						: (existingPayload.alternatives ?? []);

				const result = await claimService.create({
					projectId: existing.projectId,
					kind: "decision",
					statement: existing.statement,
					body: nextBody,
					evidence: {},
					payload: { alternatives: nextAlternatives },
					author: existing.author,
					cardId: existing.cardId,
					status: status
						? (STATUS_LEGACY_TO_CLAIM[status as string] as "active" | "superseded" | "retired")
						: "active",
					supersedesId: supersedesId as string,
				});
				if (!result.success) return err(result.error.message);
				const created = result.data;
				return ok({
					id: created.id,
					title: created.statement,
					status: STATUS_CLAIM_TO_LEGACY[created.status] ?? created.status,
					supersedes: created.supersedesId,
					supersededBy: created.supersededById,
					updated: true,
				});
			}

			const _existingPayload = JSON.parse(existing.payload) as { alternatives?: string[] };
			const [oldDecisionText, ...oldRationale] = existing.body.split(/\n{2,}/);
			const updates: Parameters<typeof claimService.update>[1] = {};
			if (decision !== undefined || rationale !== undefined) {
				const nextDecision =
					decision !== undefined ? (decision as string) : (oldDecisionText ?? existing.body);
				const nextRationale =
					rationale !== undefined ? (rationale as string) : oldRationale.join("\n\n");
				updates.body = nextRationale ? `${nextDecision}\n\n${nextRationale}` : nextDecision;
			}
			if (alternatives !== undefined) {
				updates.payload = { alternatives: alternatives as string[] };
			} else {
				// payload revalidates if we pass it; keep existing structure
			}
			if (status !== undefined) {
				updates.status = STATUS_LEGACY_TO_CLAIM[status as string] as
					| "active"
					| "superseded"
					| "retired";
			}

			const result = await claimService.update(decisionId as string, updates);
			if (!result.success) return err(result.error.message);
			const updated = result.data;

			return ok({
				id: updated.id,
				title: updated.statement,
				status: STATUS_CLAIM_TO_LEGACY[updated.status] ?? updated.status,
				supersedes: updated.supersedesId,
				supersededBy: updated.supersededById,
				updated: true,
			});
		}),
});
