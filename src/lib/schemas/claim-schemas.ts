import { z } from "zod";

export const CLAIM_KINDS = ["context", "code", "measurement", "decision"] as const;
export const CLAIM_STATUSES = ["active", "superseded", "retired"] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const claimEvidenceSchema = z
	.object({
		files: z.array(z.string().max(500)).max(50).optional(),
		symbols: z.array(z.string().max(200)).max(50).optional(),
		urls: z.array(z.string().url()).max(20).optional(),
		cardIds: z.array(z.string()).max(50).optional(),
	})
	.strict();

export const contextPayloadSchema = z
	.object({
		application: z.string().max(2000).optional(),
		audience: z.enum(["all", "agent", "human"]).optional(),
		surface: z.enum(["ambient", "indexed", "surfaced"]).optional(),
	})
	.strict();

// code claims carry evidence only; payload stays empty-object by contract.
export const codePayloadSchema = z.object({}).strict();

export const measurementPayloadSchema = z
	.object({
		value: z.number(),
		unit: z.string().min(1).max(40),
		env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
	})
	.strict();

export const decisionPayloadSchema = z
	.object({
		alternatives: z.array(z.string().max(500)).max(20).default([]),
	})
	.strict();

export const claimPayloadByKind = {
	context: contextPayloadSchema,
	code: codePayloadSchema,
	measurement: measurementPayloadSchema,
	decision: decisionPayloadSchema,
} as const;

export type ClaimEvidence = z.infer<typeof claimEvidenceSchema>;
export type ContextPayload = z.infer<typeof contextPayloadSchema>;
export type CodePayload = z.infer<typeof codePayloadSchema>;
export type MeasurementPayload = z.infer<typeof measurementPayloadSchema>;
export type DecisionPayload = z.infer<typeof decisionPayloadSchema>;
