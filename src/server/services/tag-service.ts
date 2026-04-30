import type { PrismaClient, Tag } from "prisma/generated/client";
import { editDistance, slugify } from "@/lib/slugify";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

export type TagWithCount = Tag & { _count: { cardTags: number } };

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

// Factory matches the createClaimService convention so the same logic can
// run inside the Next.js process (with the FTS-extended db singleton) and
// inside the MCP stdio process (with its own better-sqlite3 client).
export function createTagService(prisma: PrismaClient) {
	async function listByProject(projectId: string): Promise<ServiceResult<TagWithCount[]>> {
		try {
			const tags = await prisma.tag.findMany({
				where: { projectId },
				orderBy: { label: "asc" },
				include: { _count: { select: { cardTags: true } } },
			});
			return { success: true, data: tags };
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
				if (!from || !into) {
					throw new Error("One or both tags not found.");
				}
				if (from.projectId !== into.projectId) {
					throw new Error("Cannot merge tags across projects.");
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
			return {
				success: false,
				error: {
					code: "MERGE_FAILED",
					message: error instanceof Error ? error.message : "Failed to merge tags.",
				},
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

	return { listByProject, getById, create, rename, merge, resolveOrCreate };
}

export type TagService = ReturnType<typeof createTagService>;

// Singleton bound to the Next.js db (FTS-extended). MCP code constructs its
// own instance via createTagService(mcpDb) at module load.
export const tagService = createTagService(db);
