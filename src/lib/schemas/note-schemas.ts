import { z } from "zod";

import { priorityValues } from "@/lib/schemas/card-schemas";

// As of v6.0.0 (#179 Phase 2) handoffs live in their own table; the Note
// surface is the human-authored scratch layer.
export const NOTE_KINDS = ["general"] as const;

export const createNoteSchema = z.object({
	title: z.string().min(1, "Title is required.").max(200),
	content: z.string().max(50000).default(""),
	projectId: z.string().uuid().nullable().default(null),
	tags: z.array(z.string().max(50)).max(20).default([]),
	kind: z.enum(NOTE_KINDS).default("general"),
	author: z.string().max(120).default("HUMAN"),
	cardId: z.string().uuid().nullable().optional(),
	boardId: z.string().uuid().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	expiresAt: z.coerce.date().nullable().optional(),
});

export const updateNoteSchema = z.object({
	title: z.string().min(1).max(200).optional(),
	content: z.string().max(50000).optional(),
	projectId: z.string().uuid().nullable().optional(),
	tags: z.array(z.string().max(50)).max(20).optional(),
	kind: z.enum(NOTE_KINDS).optional(),
	author: z.string().max(120).optional(),
	cardId: z.string().uuid().nullable().optional(),
	boardId: z.string().uuid().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	expiresAt: z.coerce.date().nullable().optional(),
});

export const listNoteFilterSchema = z.object({
	kind: z.enum(NOTE_KINDS).optional(),
	cardId: z.string().uuid().optional(),
	boardId: z.string().uuid().optional(),
	author: z.string().optional(),
});

// Note → Card promotion (#185). Link-and-keep semantics: the new card
// stamps `metadata.sourceNoteId`, the source note retains and gains a
// `cardId` back-reference, and the note row is *not* deleted. `title`
// is editable in the modal but defaults to the note title; `priority`
// defaults to NONE.
export const promoteNoteToCardSchema = z.object({
	noteId: z.string().uuid(),
	columnId: z.string().uuid(),
	title: z.string().min(1, "Title is required.").max(200).optional(),
	priority: z.enum(priorityValues).default("NONE"),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type ListNoteFilter = z.infer<typeof listNoteFilterSchema>;
export type PromoteNoteToCardInput = z.infer<typeof promoteNoteToCardSchema>;

// ─── Per-kind metadata schemas (RFC amendment #2) ──────────────────
// The top-level create/update schemas accept generic metadata; the
// service layer narrows to the kind-specific shape before persisting.

export const generalMetadataSchema = z.object({}).strict();

export const noteMetadataByKind = {
	general: generalMetadataSchema,
} as const;

export type NoteKind = (typeof NOTE_KINDS)[number];
export type GeneralMetadata = z.infer<typeof generalMetadataSchema>;
