/**
 * Shared claim service.
 *
 * Both the Next.js web server (`src/server/services/decision-service.ts`,
 * tRPC routers) and the MCP process (claim/decision/fact tools) need the
 * same claim CRUD with Zod-validated evidence + payload at the service
 * boundary (RFC amendment #2). Each process owns its own `PrismaClient`,
 * so this module exports a factory that accepts `db: PrismaClient` as
 * the first param — mirrors `src/lib/services/tag.ts` and the v6.2
 * decision a5a4cde6 (`src/server/` and `src/mcp/` never import from each
 * other; `src/lib/services/` owns shared logic).
 *
 * Web callers keep the existing `@/server/services/claim-service` import
 * surface via a thin shim at `src/server/services/claim-service.ts` that
 * re-exports the factory + types. MCP callers construct their own
 * instance via `createClaimService(mcpDb)` at module load.
 */

import type { Claim, PrismaClient } from "prisma/generated/client";
import type { z } from "zod";
import {
	type ClaimKind,
	type ClaimStatus,
	claimEvidenceSchema,
	claimPayloadByKind,
} from "@/lib/schemas/claim-schemas";
import type { ServiceResult } from "@/server/services/types/service-result";

export type NormalizedClaim = Omit<Claim, "evidence" | "payload"> & {
	evidence: Record<string, unknown>;
	payload: Record<string, unknown>;
};

export type CreateClaimInput = {
	projectId: string;
	kind: ClaimKind;
	statement: string;
	body?: string;
	evidence?: unknown;
	payload?: unknown;
	author?: string;
	cardId?: string | null;
	status?: ClaimStatus;
	supersedesId?: string;
	recordedAtSha?: string | null;
	verifiedAt?: Date | null;
	expiresAt?: Date | null;
};

export type UpdateClaimInput = Partial<Omit<CreateClaimInput, "projectId" | "supersedesId">>;

export type ListClaimFilter = {
	kind?: ClaimKind;
	cardId?: string;
	status?: ClaimStatus;
	author?: string;
	limit?: number;
};

function normalize(row: Claim): NormalizedClaim {
	return {
		...row,
		evidence: JSON.parse(row.evidence) as Record<string, unknown>,
		payload: JSON.parse(row.payload) as Record<string, unknown>,
	};
}

function zodMessage(error: z.ZodError): string {
	const first = error.issues[0];
	if (!first) return "validation failed";
	const path = first.path.length ? first.path.join(".") : "(root)";
	return `${path}: ${first.message}`;
}

// RFC amendment #2: Zod validation of payload + evidence at the service
// boundary. JSON columns carry no DB-level type enforcement, so this is
// the final gate before persistence.
function validateEvidenceAndPayload(
	kind: ClaimKind,
	evidenceInput: unknown,
	payloadInput: unknown
): ServiceResult<{ evidence: string; payload: string }> {
	const evidenceResult = claimEvidenceSchema.safeParse(evidenceInput ?? {});
	if (!evidenceResult.success) {
		return {
			success: false,
			error: {
				code: "VALIDATION_FAILED",
				message: `evidence.${zodMessage(evidenceResult.error)}`,
			},
		};
	}

	const payloadSchema = claimPayloadByKind[kind];
	const payloadResult = payloadSchema.safeParse(payloadInput ?? {});
	if (!payloadResult.success) {
		return {
			success: false,
			error: {
				code: "VALIDATION_FAILED",
				message: `payload.${zodMessage(payloadResult.error)}`,
			},
		};
	}

	if (kind === "code") {
		const ev = evidenceResult.data;
		if (!ev.files?.length && !ev.symbols?.length) {
			return {
				success: false,
				error: {
					code: "VALIDATION_FAILED",
					message: "code claims need at least one evidence.files[] or evidence.symbols[].",
				},
			};
		}
	}

	return {
		success: true,
		data: {
			evidence: JSON.stringify(evidenceResult.data),
			payload: JSON.stringify(payloadResult.data),
		},
	};
}

// Factory — bind to a specific PrismaClient so callers (MCP, tRPC) can
// reuse their own db instance without spawning a second one.
export function createClaimService(db: PrismaClient) {
	async function create(input: CreateClaimInput): Promise<ServiceResult<NormalizedClaim>> {
		try {
			const validated = validateEvidenceAndPayload(input.kind, input.evidence, input.payload);
			if (!validated.success) return validated;

			const data = {
				projectId: input.projectId,
				kind: input.kind,
				statement: input.statement,
				body: input.body ?? "",
				evidence: validated.data.evidence,
				payload: validated.data.payload,
				author: input.author ?? "AGENT",
				cardId: input.cardId ?? null,
				status: input.status ?? "active",
				recordedAtSha: input.recordedAtSha ?? null,
				verifiedAt: input.verifiedAt ?? new Date(),
				expiresAt: input.expiresAt ?? null,
			};

			if (input.supersedesId) {
				const supersedesId = input.supersedesId;
				const old = await db.claim.findUnique({ where: { id: supersedesId } });
				if (!old) {
					return {
						success: false,
						error: { code: "NOT_FOUND", message: "Superseded claim not found." },
					};
				}
				const created = await db.$transaction(async (tx) => {
					const newRow = await tx.claim.create({ data: { ...data, supersedesId } });
					await tx.claim.update({
						where: { id: supersedesId },
						data: { status: "superseded", supersededById: newRow.id },
					});
					return newRow;
				});
				return { success: true, data: normalize(created) };
			}

			const created = await db.claim.create({ data });
			return { success: true, data: normalize(created) };
		} catch (error) {
			console.error("[CLAIM_SERVICE] create error:", error);
			return {
				success: false,
				error: { code: "CREATE_FAILED", message: "Failed to create claim." },
			};
		}
	}

	async function update(
		id: string,
		input: UpdateClaimInput
	): Promise<ServiceResult<NormalizedClaim>> {
		try {
			const existing = await db.claim.findUnique({ where: { id } });
			if (!existing) {
				return { success: false, error: { code: "NOT_FOUND", message: "Claim not found." } };
			}

			const effectiveKind = (input.kind ?? existing.kind) as ClaimKind;

			let evidenceJson: string | undefined;
			let payloadJson: string | undefined;
			const mustRevalidate =
				input.evidence !== undefined || input.payload !== undefined || input.kind !== undefined;

			if (mustRevalidate) {
				const evidenceInput = input.evidence ?? (JSON.parse(existing.evidence) as unknown);
				const payloadInput = input.payload ?? (JSON.parse(existing.payload) as unknown);
				const validated = validateEvidenceAndPayload(effectiveKind, evidenceInput, payloadInput);
				if (!validated.success) return validated;
				evidenceJson = validated.data.evidence;
				payloadJson = validated.data.payload;
			}

			const updated = await db.claim.update({
				where: { id },
				data: {
					...(input.kind !== undefined && { kind: input.kind }),
					...(input.statement !== undefined && { statement: input.statement }),
					...(input.body !== undefined && { body: input.body }),
					...(evidenceJson !== undefined && { evidence: evidenceJson }),
					...(payloadJson !== undefined && { payload: payloadJson }),
					...(input.author !== undefined && { author: input.author }),
					...(input.cardId !== undefined && { cardId: input.cardId }),
					...(input.status !== undefined && { status: input.status }),
					...(input.recordedAtSha !== undefined && { recordedAtSha: input.recordedAtSha }),
					...(input.verifiedAt !== undefined && { verifiedAt: input.verifiedAt }),
					...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
				},
			});
			return { success: true, data: normalize(updated) };
		} catch (error) {
			console.error("[CLAIM_SERVICE] update error:", error);
			return {
				success: false,
				error: { code: "UPDATE_FAILED", message: "Failed to update claim." },
			};
		}
	}

	async function getById(id: string): Promise<ServiceResult<NormalizedClaim>> {
		try {
			const row = await db.claim.findUnique({ where: { id } });
			if (!row) {
				return { success: false, error: { code: "NOT_FOUND", message: "Claim not found." } };
			}
			return { success: true, data: normalize(row) };
		} catch (error) {
			console.error("[CLAIM_SERVICE] getById error:", error);
			return {
				success: false,
				error: { code: "FETCH_FAILED", message: "Failed to fetch claim." },
			};
		}
	}

	async function list(
		projectId: string,
		filter: ListClaimFilter = {}
	): Promise<ServiceResult<NormalizedClaim[]>> {
		try {
			const where: Record<string, unknown> = { projectId };
			if (filter.kind) where.kind = filter.kind;
			if (filter.cardId) where.cardId = filter.cardId;
			if (filter.status) where.status = filter.status;
			if (filter.author) where.author = filter.author;

			const rows = await db.claim.findMany({
				where,
				orderBy: { updatedAt: "desc" },
				take: filter.limit ?? 50,
			});
			return { success: true, data: rows.map(normalize) };
		} catch (error) {
			console.error("[CLAIM_SERVICE] list error:", error);
			return {
				success: false,
				error: { code: "LIST_FAILED", message: "Failed to fetch claims." },
			};
		}
	}

	return { create, update, getById, list };
}

export type ClaimService = ReturnType<typeof createClaimService>;
