import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, resolveCardRef, ok, err, safeExecute } from "../utils.js";

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
	}),
	handler: ({ projectId, cardId, title, status, decision, alternatives, rationale }) => safeExecute(async () => {
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

		return ok({
			id: record.id,
			title: record.title,
			status: record.status,
			card: record.card ? { ref: `#${record.card.number}`, title: record.card.title } : null,
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
		status: z.enum(["proposed", "accepted", "rejected", "superseded"]).optional(),
		decision: z.string().optional().describe("Updated decision text"),
		rationale: z.string().optional().describe("Updated rationale"),
		alternatives: z.array(z.string()).optional().describe("Updated alternatives"),
	}),
	annotations: { idempotentHint: true },
	handler: ({ decisionId, status, decision, rationale, alternatives }) => safeExecute(async () => {
		const existing = await db.decision.findUnique({ where: { id: decisionId as string } });
		if (!existing) return err("Decision not found.", "Use getDecisions to find valid decision IDs.");

		const data: Record<string, unknown> = {};
		if (status !== undefined) data.status = status;
		if (decision !== undefined) data.decision = decision;
		if (rationale !== undefined) data.rationale = rationale;
		if (alternatives !== undefined) data.alternatives = JSON.stringify(alternatives);

		const updated = await db.decision.update({
			where: { id: decisionId as string },
			data,
		});

		return ok({
			id: updated.id,
			title: updated.title,
			status: updated.status,
			updated: true,
		});
	}),
});
