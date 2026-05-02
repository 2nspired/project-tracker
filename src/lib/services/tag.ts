/**
 * Shared tag service.
 *
 * Both the Next.js web server (tRPC tag router, card-service) and the MCP
 * process (taxonomy-utils, tag-tools) need the same tag CRUD + governance
 * logic. Each process owns its own `PrismaClient`, so this module exports
 * a `createTagService(prisma)` factory rather than a singleton — mirrors
 * the `src/lib/services/staleness.ts` pattern and satisfies the v6.2
 * decision that `src/server/` and `src/mcp/` never import from each other
 * (see `scripts/boundary-lint.ts`).
 *
 * The web-side singleton bound to the FTS-extended db lives in the shim
 * at `src/server/services/tag-service.ts`. MCP callers construct their
 * own instance via `createTagService(mcpDb)`.
 */

import type { PrismaClient, Tag } from "prisma/generated/client";
import { editDistance, slugify } from "@/lib/slugify";
import type { ServiceResult } from "@/server/services/types/service-result";

export type TagState = "active" | "archived";

export type TagWithCount = Tag & { _count: { cardTags: number } };

export type TagGovernanceHints = {
	// Tag is referenced by exactly one CardTag — likely premature or one-off.
	// Mirrors the milestone "premature singleton" signal but uses usage rather
	// than age, since tags don't have the same long-lived-container shape.
	singleton?: true;
	// Other tags within Levenshtein 2 of this tag's slug — candidates for a
	// merge to collapse near-duplicate vocabulary.
	possibleMerge?: Array<{ id: string; label: string; distance: number }>;
};

export type TagWithHints = TagWithCount & {
	state: TagState;
	_governanceHints?: TagGovernanceHints;
};

export type DidYouMean = { id: string; slug: string; label: string; distance: number };

export type TagResolveResult = {
	id: string;
	slug: string;
	label: string;
	created: boolean;
	// Existing tags within Levenshtein 2 of the input slug. Empty array on
	// exact-slug hits (intent unambiguous) and on first-time creates with no
	// near neighbours. Sorted ascending by distance.
	didYouMean: DidYouMean[];
};

// ─── Pure helpers (exported via __testing__ for unit tests) ──────────

type GovernanceHintInput = {
	id: string;
	slug: string;
	label: string;
	usageCount: number;
};

/**
 * Compute governance hints for a single tag relative to its project peers.
 *
 * Pure — no DB, no I/O. Hints surface only when meaningful so consumers
 * can render conditionally without coordinating "is empty" checks.
 *
 *   singleton:    true when usageCount === 1
 *   possibleMerge: every peer (excluding self) within Levenshtein ≤ 2 of
 *                  the subject's slug, sorted ascending by distance
 *
 * O(n) per call (n = peer count); the calling list endpoint runs this n
 * times for an O(n²) total. Acceptable up to ~500 tags per project — past
 * that, switch to prefix-bucketed candidate selection.
 */
function computeGovernanceHints(
	subject: GovernanceHintInput,
	peers: GovernanceHintInput[]
): TagGovernanceHints | undefined {
	const hints: TagGovernanceHints = {};

	if (subject.usageCount === 1) {
		hints.singleton = true;
	}

	const possibleMerge: Array<{ id: string; label: string; distance: number }> = [];
	if (subject.slug) {
		for (const peer of peers) {
			if (peer.id === subject.id) continue;
			if (!peer.slug) continue;
			const distance = editDistance(subject.slug, peer.slug, 2);
			if (distance <= 2) {
				possibleMerge.push({ id: peer.id, label: peer.label, distance });
			}
		}
		possibleMerge.sort((a, b) => a.distance - b.distance);
	}
	if (possibleMerge.length > 0) {
		hints.possibleMerge = possibleMerge;
	}

	return Object.keys(hints).length > 0 ? hints : undefined;
}

/**
 * Validate guards for `mergeTags` against fetched-tag pairs.
 *
 * Pure — separates the policy from the transactional rewrite. Returned
 * error codes flow up to the caller through ServiceResult.
 */
function validateMergeGuards(
	from: { id: string; projectId: string; state: string } | null,
	into: { id: string; projectId: string; state: string } | null
): { ok: true } | { ok: false; code: string; message: string } {
	if (!from || !into) {
		return { ok: false, code: "NOT_FOUND", message: "One or both tags not found." };
	}
	if (from.id === into.id) {
		return { ok: false, code: "INVALID_INPUT", message: "Cannot merge a tag into itself." };
	}
	if (from.projectId !== into.projectId) {
		return {
			ok: false,
			code: "CROSS_PROJECT",
			message: "Cannot merge tags across projects.",
		};
	}
	if (from.state === "archived") {
		return {
			ok: false,
			code: "SOURCE_ARCHIVED",
			message:
				"Source tag is archived. Reactivate it before merging, or delete the archived row directly if it is unused.",
		};
	}
	return { ok: true };
}

// ─── Service factory ─────────────────────────────────────────────────

// Factory matches the createClaimService convention so the same logic can
// run inside the Next.js process (with the FTS-extended db singleton) and
// inside the MCP stdio process (with its own better-sqlite3 client).
export function createTagService(prisma: PrismaClient) {
	async function listByProject(
		projectId: string,
		options?: { state?: TagState }
	): Promise<ServiceResult<TagWithHints[]>> {
		try {
			const stateFilter: TagState = options?.state ?? "active";
			const tags = await prisma.tag.findMany({
				where: { projectId, state: stateFilter },
				orderBy: [{ label: "asc" }],
				include: { _count: { select: { cardTags: true } } },
			});

			const hintInputs: GovernanceHintInput[] = tags.map((t) => ({
				id: t.id,
				slug: t.slug,
				label: t.label,
				usageCount: t._count.cardTags,
			}));

			const enriched: TagWithHints[] = tags.map((t, i) => {
				const hints = computeGovernanceHints(hintInputs[i], hintInputs);
				const base: TagWithHints = { ...t, state: t.state as TagState };
				if (hints) base._governanceHints = hints;
				return base;
			});

			return { success: true, data: enriched };
		} catch (error) {
			console.error("[TAG_SERVICE] listByProject error:", error);
			return {
				success: false,
				error: { code: "LIST_FAILED", message: "Failed to fetch tags." },
			};
		}
	}

	async function getById(tagId: string): Promise<ServiceResult<Tag>> {
		try {
			const tag = await prisma.tag.findUnique({ where: { id: tagId } });
			if (!tag) {
				return { success: false, error: { code: "NOT_FOUND", message: "Tag not found." } };
			}
			return { success: true, data: tag };
		} catch (error) {
			console.error("[TAG_SERVICE] getById error:", error);
			return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch tag." } };
		}
	}

	// Idempotent — upsert on (projectId, slug). Re-creating an existing tag
	// returns the existing row unchanged so callers can fire-and-forget.
	async function create(input: { projectId: string; label: string }): Promise<ServiceResult<Tag>> {
		try {
			const slug = slugify(input.label);
			if (!slug) {
				return {
					success: false,
					error: {
						code: "INVALID_INPUT",
						message: `"${input.label}" produces an empty slug — tag label must contain alphanumeric characters.`,
					},
				};
			}
			const trimmed = input.label.trim();
			const tag = await prisma.tag.upsert({
				where: { projectId_slug: { projectId: input.projectId, slug } },
				create: { projectId: input.projectId, slug, label: trimmed },
				update: {},
			});
			return { success: true, data: tag };
		} catch (error) {
			console.error("[TAG_SERVICE] create error:", error);
			return {
				success: false,
				error: { code: "CREATE_FAILED", message: "Failed to create tag." },
			};
		}
	}

	// Updates the display label only; slug is immutable. Callers who want a
	// different slug should `create` the new one and `merge` the old into it.
	async function rename(input: { tagId: string; label: string }): Promise<ServiceResult<Tag>> {
		try {
			const trimmed = input.label.trim();
			if (!trimmed) {
				return {
					success: false,
					error: { code: "INVALID_INPUT", message: "Tag label cannot be empty." },
				};
			}
			const tag = await prisma.tag.update({
				where: { id: input.tagId },
				data: { label: trimmed },
			});
			return { success: true, data: tag };
		} catch (error) {
			console.error("[TAG_SERVICE] rename error:", error);
			return {
				success: false,
				error: { code: "RENAME_FAILED", message: "Failed to rename tag." },
			};
		}
	}

	// Rewrites every CardTag pointing at `from` to point at `into`, then
	// deletes `from`. Composite-PK collisions on (cardId, tagId) are handled
	// per-row: if the destination row exists, we just delete the source row.
	//
	// Guards (validateMergeGuards): self-merge, cross-project, archived
	// source. Each guard returns a typed error that the router maps to a
	// 4xx. Wrapped in a transaction so a guard failure mid-rewrite rolls
	// back any partial state.
	async function merge(input: {
		fromTagId: string;
		intoTagId: string;
	}): Promise<ServiceResult<{ rewroteCount: number; skippedDuplicates: number }>> {
		try {
			if (input.fromTagId === input.intoTagId) {
				return {
					success: false,
					error: { code: "INVALID_INPUT", message: "Cannot merge a tag into itself." },
				};
			}
			const result = await prisma.$transaction(async (tx) => {
				const [from, into] = await Promise.all([
					tx.tag.findUnique({ where: { id: input.fromTagId } }),
					tx.tag.findUnique({ where: { id: input.intoTagId } }),
				]);
				const guard = validateMergeGuards(from, into);
				if (!guard.ok) {
					const error = new Error(guard.message) as Error & { code?: string };
					error.code = guard.code;
					throw error;
				}

				const sourceRows = await tx.cardTag.findMany({ where: { tagId: input.fromTagId } });
				let rewroteCount = 0;
				let skippedDuplicates = 0;
				for (const row of sourceRows) {
					const dupe = await tx.cardTag.findUnique({
						where: { cardId_tagId: { cardId: row.cardId, tagId: input.intoTagId } },
					});
					if (dupe) {
						skippedDuplicates++;
					} else {
						await tx.cardTag.create({
							data: { cardId: row.cardId, tagId: input.intoTagId },
						});
						rewroteCount++;
					}
					await tx.cardTag.delete({
						where: { cardId_tagId: { cardId: row.cardId, tagId: input.fromTagId } },
					});
				}
				await tx.tag.delete({ where: { id: input.fromTagId } });
				return { rewroteCount, skippedDuplicates };
			});
			return { success: true, data: result };
		} catch (error) {
			console.error("[TAG_SERVICE] merge error:", error);
			const code = (error as { code?: string }).code ?? "MERGE_FAILED";
			return {
				success: false,
				error: {
					code,
					message: error instanceof Error ? error.message : "Failed to merge tags.",
				},
			};
		}
	}

	/**
	 * Delete a tag — only when zero CardTag rows reference it.
	 *
	 * Atomic via a single conditional DELETE that races against any
	 * concurrent INSERT into card_tag. SQLite's row-level write locks make
	 * the DELETE+NOT-EXISTS scan internally consistent: if a CardTag is
	 * inserted between our check and our delete, the NOT EXISTS clause sees
	 * it and the DELETE matches zero rows. Returns the projectId so the
	 * caller (router) can scope the SSE invalidation.
	 *
	 * Returns USAGE_NOT_ZERO when the tag has cardTag references — caller
	 * surfaces that as a 4xx with a hint pointing at `mergeTags`.
	 */
	async function deleteIfOrphan(
		tagId: string
	): Promise<ServiceResult<{ deleted: true; projectId: string }>> {
		try {
			const tag = await prisma.tag.findUnique({
				where: { id: tagId },
				select: { id: true, projectId: true },
			});
			if (!tag) {
				return { success: false, error: { code: "NOT_FOUND", message: "Tag not found." } };
			}
			// Atomic conditional delete — the NOT EXISTS subquery gates the
			// delete against any CardTag row, closing the TOCTOU window
			// between an explicit count() and a separate delete().
			const affected = await prisma.$executeRaw<number>`
				DELETE FROM "tag"
				WHERE "id" = ${tagId}
				  AND NOT EXISTS (
					SELECT 1 FROM "card_tag" WHERE "tag_id" = ${tagId}
				  )
			`;
			if (affected === 0) {
				return {
					success: false,
					error: {
						code: "USAGE_NOT_ZERO",
						message:
							"Tag has card associations and cannot be deleted. Merge it into another tag first.",
					},
				};
			}
			return { success: true, data: { deleted: true, projectId: tag.projectId } };
		} catch (error) {
			console.error("[TAG_SERVICE] deleteIfOrphan error:", error);
			return {
				success: false,
				error: { code: "DELETE_FAILED", message: "Failed to delete tag." },
			};
		}
	}

	// Lookup-or-create by slug. Exact slug hits short-circuit with no
	// didYouMean (intent unambiguous). Misses create the tag and surface
	// near-miss neighbours so the caller can flag possible drift.
	async function resolveOrCreate(
		projectId: string,
		label: string
	): Promise<ServiceResult<TagResolveResult>> {
		try {
			const slug = slugify(label);
			if (!slug) {
				return {
					success: false,
					error: {
						code: "INVALID_INPUT",
						message: `"${label}" produces an empty slug — tag label must contain alphanumeric characters.`,
					},
				};
			}

			const exact = await prisma.tag.findUnique({
				where: { projectId_slug: { projectId, slug } },
			});
			if (exact) {
				return {
					success: true,
					data: {
						id: exact.id,
						slug: exact.slug,
						label: exact.label,
						created: false,
						didYouMean: [],
					},
				};
			}

			const candidates = await prisma.tag.findMany({
				where: { projectId },
				select: { id: true, slug: true, label: true },
			});
			const didYouMean: DidYouMean[] = [];
			for (const t of candidates) {
				const distance = editDistance(slug, t.slug, 2);
				if (distance <= 2) {
					didYouMean.push({ id: t.id, slug: t.slug, label: t.label, distance });
				}
			}
			didYouMean.sort((a, b) => a.distance - b.distance);

			const created = await prisma.tag.create({
				data: { projectId, slug, label: label.trim() },
			});
			return {
				success: true,
				data: {
					id: created.id,
					slug: created.slug,
					label: created.label,
					created: true,
					didYouMean,
				},
			};
		} catch (error) {
			console.error("[TAG_SERVICE] resolveOrCreate error:", error);
			return {
				success: false,
				error: { code: "RESOLVE_FAILED", message: "Failed to resolve or create tag." },
			};
		}
	}

	return {
		listByProject,
		getById,
		create,
		rename,
		merge,
		deleteIfOrphan,
		resolveOrCreate,
	};
}

export type TagService = ReturnType<typeof createTagService>;

// Internals exposed for unit tests — not part of the public service API.
export const __testing__ = {
	computeGovernanceHints,
	validateMergeGuards,
};
