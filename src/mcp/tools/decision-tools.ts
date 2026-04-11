import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, resolveCardRef, ok, err, safeExecute, checkVersionConflict } from "../utils.js";

// ─── Decisions ─────────────────────────────────────────────────────

registerExtendedTool("recordDecision", {
	category: "decisions",
	description: "Record an architectural decision.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		cardId: z.string().optional().describe("Card UUID or #number"),
		title: z.string().describe("Decision title"),
		status: z.enum(["proposed", "accepted", "rejected", "superseded"]).default("proposed"),
		decision: z.string().describe("The decision text"),
		alternatives: z.array(z.string()).default([]).describe("Alternatives considered"),
		rationale: z.string().default("").describe("Why this decision was made"),
		supersedesId: z.string().optional().describe("ID of the decision this one supersedes — the old decision will be marked as superseded and linked"),
	}),
	handler: ({ projectId, cardId, title, status, decision, alternatives, rationale, supersedesId }) => safeExecute(async () => {
		let resolvedCardId: string | null = null;
		if (cardId) {
			const resolved = await resolveCardRef(cardId as string);
			if (!resolved.ok) return err(resolved.message);
			resolvedCardId = resolved.id;
		}

		const record = await db.decision.create({
			data: {
				projectId: projectId as string,
				cardId: resolvedCardId,
				title: title as string,
				status: (status as string) ?? "proposed",
				decision: decision as string,
				alternatives: JSON.stringify(alternatives ?? []),
				rationale: (rationale as string) ?? "",
				author: AGENT_NAME,
			},
			include: { card: { select: { id: true, number: true, title: true } } },
		});

		if (supersedesId) {
			const oldDecision = await db.decision.findUnique({ where: { id: supersedesId as string } });
			if (!oldDecision) return err("Superseded decision not found.", "Check the supersedesId.");
			await db.decision.update({ where: { id: supersedesId as string }, data: { status: "superseded", supersededBy: record.id } });
			await db.decision.update({ where: { id: record.id }, data: { supersedes: supersedesId as string } });
		}

		const final = supersedesId
			? await db.decision.findUnique({ where: { id: record.id }, include: { card: { select: { id: true, number: true, title: true } } } })
			: record;

		return ok({
			id: final!.id,
			title: final!.title,
			status: final!.status,
			version: final!.version,
			supersedes: final!.supersedes,
			supersededBy: final!.supersededBy,
			card: final!.card ? { ref: `#${final!.card.number}`, title: final!.card.title } : null,
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
	handler: ({ projectId, cardId, status }) => safeExecute(async () => {
		let resolvedCardId: string | undefined;
		if (cardId) {
			const resolved = await resolveCardRef(cardId as string);
			if (!resolved.ok) return err(resolved.message);
			resolvedCardId = resolved.id;
		}

		const where: Record<string, unknown> = { projectId: projectId as string };
		if (resolvedCardId) where.cardId = resolvedCardId;
		if (status) where.status = status as string;

		const decisions = await db.decision.findMany({
			where,
			orderBy: { createdAt: "desc" },
			include: { card: { select: { id: true, number: true, title: true } } },
		});

		return ok(decisions.map((d) => ({
			id: d.id,
			title: d.title,
			status: d.status,
			decision: d.decision,
			alternatives: JSON.parse(d.alternatives) as string[],
			rationale: d.rationale,
			author: d.author,
			version: d.version,
			supersedes: d.supersedes,
			supersededBy: d.supersededBy,
			card: d.card ? { ref: `#${d.card.number}`, title: d.card.title } : null,
			createdAt: d.createdAt,
		})));
	}),
});

registerExtendedTool("updateDecision", {
	category: "decisions",
	description: "Update a decision's status, text, or rationale.",
	parameters: z.object({
		decisionId: z.string().describe("Decision UUID"),
		version: z.number().int().optional().describe("Expected version for optimistic locking — pass to detect conflicts"),
		status: z.enum(["proposed", "accepted", "rejected", "superseded"]).optional(),
		decision: z.string().optional().describe("Updated decision text"),
		rationale: z.string().optional().describe("Updated rationale"),
		alternatives: z.array(z.string()).optional().describe("Updated alternatives"),
		supersedesId: z.string().optional().describe("ID of the decision this one supersedes — sets old decision to superseded and links them"),
	}),
	annotations: { idempotentHint: true },
	handler: ({ decisionId, version, status, decision, rationale, alternatives, supersedesId }) => safeExecute(async () => {
		const existing = await db.decision.findUnique({ where: { id: decisionId as string } });
		if (!existing) return err("Decision not found.", "Use getDecisions to find valid decision IDs.");

		const conflict = checkVersionConflict(version as number | undefined, existing.version, "decision");
		if (conflict) return conflict;

		const data: Record<string, unknown> = {};
		if (status !== undefined) data.status = status;
		if (decision !== undefined) data.decision = decision;
		if (rationale !== undefined) data.rationale = rationale;
		if (alternatives !== undefined) data.alternatives = JSON.stringify(alternatives);
		data.version = { increment: 1 };

		const updated = await db.decision.update({
			where: { id: decisionId as string },
			data,
		});

		if (supersedesId) {
			const oldDecision = await db.decision.findUnique({ where: { id: supersedesId as string } });
			if (!oldDecision) return err("Superseded decision not found.", "Check the supersedesId.");
			await db.decision.update({ where: { id: supersedesId as string }, data: { status: "superseded", supersededBy: updated.id } });
			await db.decision.update({ where: { id: updated.id }, data: { supersedes: supersedesId as string } });
		}

		const final = supersedesId
			? await db.decision.findUnique({ where: { id: updated.id } })
			: updated;

		return ok({
			id: final!.id,
			title: final!.title,
			status: final!.status,
			version: final!.version,
			supersedes: final!.supersedes,
			supersededBy: final!.supersededBy,
			updated: true,
		});
	}),
});
