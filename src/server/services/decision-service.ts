import type { Decision } from "prisma/generated/client";
import type { CreateDecisionInput, UpdateDecisionInput } from "@/lib/schemas/decision-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

type CardRef = { id: string; number: number; title: string };
type DecisionWithCard = Omit<Decision, "alternatives"> & { alternatives: string[]; card: CardRef | null };

function parseDecision(d: Decision & { card?: { id: string; number: number; title: string } | null }): DecisionWithCard {
	return {
		...d,
		alternatives: JSON.parse(d.alternatives) as string[],
		card: d.card ?? null,
	};
}

async function create(input: CreateDecisionInput): Promise<ServiceResult<DecisionWithCard>> {
	try {
		const decision = await db.decision.create({
			data: {
				projectId: input.projectId,
				cardId: input.cardId ?? null,
				title: input.title,
				status: input.status,
				decision: input.decision,
				alternatives: JSON.stringify(input.alternatives),
				rationale: input.rationale,
				author: input.author,
			},
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		return { success: true, data: parseDecision(decision) };
	} catch (error) {
		console.error("[DECISION_SERVICE] create error:", error);
		return { success: false, error: { code: "CREATE_FAILED", message: "Failed to create decision." } };
	}
}

async function update(id: string, input: UpdateDecisionInput): Promise<ServiceResult<DecisionWithCard>> {
	try {
		const existing = await db.decision.findUnique({ where: { id } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Decision not found." } };
		}
		const { alternatives, ...rest } = input;
		const decision = await db.decision.update({
			where: { id },
			data: {
				...rest,
				...(alternatives !== undefined && { alternatives: JSON.stringify(alternatives) }),
			},
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		return { success: true, data: parseDecision(decision) };
	} catch (error) {
		console.error("[DECISION_SERVICE] update error:", error);
		return { success: false, error: { code: "UPDATE_FAILED", message: "Failed to update decision." } };
	}
}

async function getById(id: string): Promise<ServiceResult<DecisionWithCard>> {
	try {
		const decision = await db.decision.findUnique({
			where: { id },
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		if (!decision) {
			return { success: false, error: { code: "NOT_FOUND", message: "Decision not found." } };
		}
		return { success: true, data: parseDecision(decision) };
	} catch (error) {
		console.error("[DECISION_SERVICE] getById error:", error);
		return { success: false, error: { code: "FETCH_FAILED", message: "Failed to fetch decision." } };
	}
}

async function list(
	projectId: string,
	opts?: { cardId?: string; status?: string },
): Promise<ServiceResult<DecisionWithCard[]>> {
	try {
		const where: Record<string, unknown> = { projectId };
		if (opts?.cardId) where.cardId = opts.cardId;
		if (opts?.status) where.status = opts.status;

		const decisions = await db.decision.findMany({
			where,
			orderBy: { createdAt: "desc" },
			include: { card: { select: { id: true, number: true, title: true } } },
		});
		return { success: true, data: decisions.map(parseDecision) };
	} catch (error) {
		console.error("[DECISION_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to fetch decisions." } };
	}
}

async function deleteDecision(id: string): Promise<ServiceResult<Decision>> {
	try {
		const existing = await db.decision.findUnique({ where: { id } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Decision not found." } };
		}
		const decision = await db.decision.delete({ where: { id } });
		return { success: true, data: decision };
	} catch (error) {
		console.error("[DECISION_SERVICE] delete error:", error);
		return { success: false, error: { code: "DELETE_FAILED", message: "Failed to delete decision." } };
	}
}

export const decisionService = {
	create,
	update,
	getById,
	list,
	delete: deleteDecision,
};
