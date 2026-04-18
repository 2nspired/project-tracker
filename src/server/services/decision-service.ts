import type { Claim } from "prisma/generated/client";
import type { CreateDecisionInput, UpdateDecisionInput } from "@/lib/schemas/decision-schemas";
import { db } from "@/server/db";
import { createClaimService } from "@/server/services/claim-service";
import type { ServiceResult } from "@/server/services/types/service-result";

// Post-cutover (commits 5–6 of docs/IMPL-NOTE-CLAIM-CUTOVER.md)
// decision-service is a thin adapter over claim-service that preserves
// the legacy { title, decision, rationale, alternatives, status } shape
// expected by the existing tRPC consumers (card-detail-sheet, project
// decisions page). Commit 7 flips those consumers to claim directly and
// this adapter can be retired.

const claimService = createClaimService(db);

const STATUS_CLAIM_TO_LEGACY: Record<string, string> = {
	active: "accepted",
	superseded: "superseded",
	retired: "rejected",
};

const STATUS_LEGACY_TO_CLAIM: Record<string, "active" | "superseded" | "retired"> = {
	proposed: "active",
	accepted: "active",
	superseded: "superseded",
	rejected: "retired",
};

type CardRef = { id: string; number: number; title: string };

export type DecisionShape = {
	id: string;
	projectId: string;
	cardId: string | null;
	title: string;
	status: string;
	decision: string;
	alternatives: string[];
	rationale: string;
	author: string;
	supersedes: string | null;
	supersededBy: string | null;
	createdAt: Date;
	updatedAt: Date;
	card: CardRef | null;
};

function splitBody(body: string): { decision: string; rationale: string } {
	const [decisionText, ...rationale] = body.split(/\n{2,}/);
	return {
		decision: decisionText ?? body,
		rationale: rationale.join("\n\n"),
	};
}

function claimToDecision(c: Claim, card: CardRef | null): DecisionShape {
	const payload = JSON.parse(c.payload) as { alternatives?: string[] };
	const { decision, rationale } = splitBody(c.body);
	return {
		id: c.id,
		projectId: c.projectId,
		cardId: c.cardId,
		title: c.statement,
		status: STATUS_CLAIM_TO_LEGACY[c.status] ?? c.status,
		decision,
		alternatives: payload.alternatives ?? [],
		rationale,
		author: c.author,
		supersedes: c.supersedesId,
		supersededBy: c.supersededById,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
		card,
	};
}

async function create(input: CreateDecisionInput): Promise<ServiceResult<DecisionShape>> {
	try {
		const body = input.rationale ? `${input.decision}\n\n${input.rationale}` : input.decision;
		const result = await claimService.create({
			projectId: input.projectId,
			kind: "decision",
			statement: input.title,
			body,
			evidence: {},
			payload: { alternatives: input.alternatives },
			author: input.author,
			cardId: input.cardId ?? null,
			status: STATUS_LEGACY_TO_CLAIM[input.status],
		});
		if (!result.success) return result;
		const row = await db.claim.findUnique({
			where: { id: result.data.id },
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		if (!row) {
			return {
				success: false,
				error: { code: "CREATE_FAILED", message: "Decision disappeared after create." },
			};
		}
		return { success: true, data: claimToDecision(row, row.card ?? null) };
	} catch (error) {
		console.error("[DECISION_SERVICE] create error:", error);
		return {
			success: false,
			error: { code: "CREATE_FAILED", message: "Failed to create decision." },
		};
	}
}

async function update(
	id: string,
	input: UpdateDecisionInput
): Promise<ServiceResult<DecisionShape>> {
	try {
		const existing = await db.claim.findUnique({ where: { id } });
		if (!existing || existing.kind !== "decision") {
			return { success: false, error: { code: "NOT_FOUND", message: "Decision not found." } };
		}

		const existingPayload = JSON.parse(existing.payload) as { alternatives?: string[] };
		const { decision: oldDecision, rationale: oldRationale } = splitBody(existing.body);
		const updates: Parameters<typeof claimService.update>[1] = {};
		if (input.title !== undefined) updates.statement = input.title;
		if (input.status !== undefined) updates.status = STATUS_LEGACY_TO_CLAIM[input.status];
		if (input.decision !== undefined || input.rationale !== undefined) {
			const nextDecision = input.decision ?? oldDecision;
			const nextRationale = input.rationale ?? oldRationale;
			updates.body = nextRationale ? `${nextDecision}\n\n${nextRationale}` : nextDecision;
		}
		if (input.alternatives !== undefined) {
			updates.payload = { alternatives: input.alternatives };
		} else {
			updates.payload = { alternatives: existingPayload.alternatives ?? [] };
		}

		const result = await claimService.update(id, updates);
		if (!result.success) return result;
		const row = await db.claim.findUnique({
			where: { id: result.data.id },
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		if (!row) {
			return {
				success: false,
				error: { code: "UPDATE_FAILED", message: "Decision disappeared after update." },
			};
		}
		return { success: true, data: claimToDecision(row, row.card ?? null) };
	} catch (error) {
		console.error("[DECISION_SERVICE] update error:", error);
		return {
			success: false,
			error: { code: "UPDATE_FAILED", message: "Failed to update decision." },
		};
	}
}

async function getById(id: string): Promise<ServiceResult<DecisionShape>> {
	try {
		const row = await db.claim.findUnique({
			where: { id },
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		if (!row || row.kind !== "decision") {
			return { success: false, error: { code: "NOT_FOUND", message: "Decision not found." } };
		}
		return { success: true, data: claimToDecision(row, row.card ?? null) };
	} catch (error) {
		console.error("[DECISION_SERVICE] getById error:", error);
		return {
			success: false,
			error: { code: "FETCH_FAILED", message: "Failed to fetch decision." },
		};
	}
}

async function list(
	projectId: string,
	opts?: { cardId?: string; status?: string }
): Promise<ServiceResult<DecisionShape[]>> {
	try {
		const where: Record<string, unknown> = { projectId, kind: "decision" };
		if (opts?.cardId) where.cardId = opts.cardId;
		if (opts?.status) where.status = STATUS_LEGACY_TO_CLAIM[opts.status] ?? opts.status;

		const rows = await db.claim.findMany({
			where,
			orderBy: { createdAt: "desc" },
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		return {
			success: true,
			data: rows.map((r) => claimToDecision(r, r.card ?? null)),
		};
	} catch (error) {
		console.error("[DECISION_SERVICE] list error:", error);
		return {
			success: false,
			error: { code: "LIST_FAILED", message: "Failed to fetch decisions." },
		};
	}
}

async function deleteDecision(id: string): Promise<ServiceResult<DecisionShape>> {
	try {
		const existing = await db.claim.findUnique({
			where: { id },
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		if (!existing || existing.kind !== "decision") {
			return { success: false, error: { code: "NOT_FOUND", message: "Decision not found." } };
		}
		const card = existing.card ?? null;
		const row = await db.claim.delete({ where: { id } });
		return { success: true, data: claimToDecision(row, card) };
	} catch (error) {
		console.error("[DECISION_SERVICE] delete error:", error);
		return {
			success: false,
			error: { code: "DELETE_FAILED", message: "Failed to delete decision." },
		};
	}
}

export const decisionService = {
	create,
	update,
	getById,
	list,
	delete: deleteDecision,
};
