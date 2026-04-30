// Shared write-path helpers for tag + milestone resolution across the four
// MCP card-mutation tools (createCard, updateCard, bulkCreateCards,
// bulkUpdateCards). Centralizes the dual-track v4.2 contract:
//
//   • New strict params (tagSlugs, milestoneId) — validated against the
//     project; misses return structured _didYouMean suggestions.
//   • Legacy params (tags, milestoneName) — routed through resolveOrCreate
//     with normalization; near-misses surface _didYouMean as a hint
//     alongside the successful write.
//
// The corresponding _deprecated warning is emitted by the caller in the
// response payload (mirroring the briefMe _versionMismatch pattern).
// v5.0.0 will remove the legacy params and shrink these helpers.

import type { PrismaClient } from "prisma/generated/client";
import { editDistance, slugify } from "@/lib/slugify";
import { resolveOrCreateMilestone as resolveOrCreateMilestoneSvc } from "@/server/services/milestone-service";
import { createTagService } from "@/server/services/tag-service";

export type TagSuggestion = { id: string; slug: string; label: string; distance: number };

export type TagResolutionInput = {
	tagSlugs?: string[] | null;
	tags?: string[] | null;
};

export type TagResolutionSuccess = {
	ok: true;
	// false when neither tagSlugs nor tags was provided — caller should NOT
	// sync the junction (preserves existing CardTag rows on partial updates).
	applied: boolean;
	tagIds: string[]; // dedupe-ordered, parallel with labels
	labels: string[]; // canonical labels from the resolved Tag rows
	didYouMean: Array<{ input: string; suggestions: TagSuggestion[] }>;
	legacyUsed: boolean;
	ignoredLegacy: boolean; // true when both new and legacy were provided
};

export type TagResolutionFailure = {
	ok: false;
	errors: Array<{ slug: string; message: string; suggestions: TagSuggestion[] }>;
};

export type TagResolution = TagResolutionSuccess | TagResolutionFailure;

export async function resolveTagsForWrite(
	prisma: PrismaClient,
	projectId: string,
	input: TagResolutionInput
): Promise<TagResolution> {
	const tagSlugsProvided = input.tagSlugs !== undefined && input.tagSlugs !== null;
	const legacyProvided = !tagSlugsProvided && input.tags !== undefined && input.tags !== null;
	const ignoredLegacy = tagSlugsProvided && input.tags !== undefined && input.tags !== null;

	if (!tagSlugsProvided && !legacyProvided) {
		return {
			ok: true,
			applied: false,
			tagIds: [],
			labels: [],
			didYouMean: [],
			legacyUsed: false,
			ignoredLegacy: false,
		};
	}

	if (tagSlugsProvided) {
		const rawSlugs = input.tagSlugs ?? [];
		const slugs = Array.from(new Set(rawSlugs.map((s) => slugify(s)).filter((s) => s.length > 0)));
		if (slugs.length === 0) {
			return {
				ok: true,
				applied: true,
				tagIds: [],
				labels: [],
				didYouMean: [],
				legacyUsed: false,
				ignoredLegacy,
			};
		}
		const found = await prisma.tag.findMany({
			where: { projectId, slug: { in: slugs } },
			select: { id: true, slug: true, label: true },
		});
		const foundMap = new Map(found.map((t) => [t.slug, t]));
		const missing = slugs.filter((s) => !foundMap.has(s));
		if (missing.length > 0) {
			const candidates = await prisma.tag.findMany({
				where: { projectId },
				select: { id: true, slug: true, label: true },
			});
			const errors = missing.map((slug) => {
				const suggestions: TagSuggestion[] = [];
				for (const t of candidates) {
					const distance = editDistance(slug, t.slug, 2);
					if (distance <= 2) {
						suggestions.push({ id: t.id, slug: t.slug, label: t.label, distance });
					}
				}
				suggestions.sort((a, b) => a.distance - b.distance);
				return {
					slug,
					message: `Tag "${slug}" not found in this project.`,
					suggestions,
				};
			});
			return { ok: false, errors };
		}
		const tagIds: string[] = [];
		const labels: string[] = [];
		for (const slug of slugs) {
			// biome-ignore lint/style/noNonNullAssertion: missing is empty here.
			const hit = foundMap.get(slug)!;
			tagIds.push(hit.id);
			labels.push(hit.label);
		}
		return {
			ok: true,
			applied: true,
			tagIds,
			labels,
			didYouMean: [],
			legacyUsed: false,
			ignoredLegacy,
		};
	}

	// Legacy path — resolveOrCreate per string, dedupe by tagId.
	const tagService = createTagService(prisma);
	const legacyTags = input.tags ?? [];
	const tagIds: string[] = [];
	const labels: string[] = [];
	const didYouMean: Array<{ input: string; suggestions: TagSuggestion[] }> = [];
	const seen = new Set<string>();

	for (const inputLabel of legacyTags) {
		const result = await tagService.resolveOrCreate(projectId, inputLabel);
		if (!result.success) continue; // skip empty-slug inputs silently
		if (seen.has(result.data.id)) continue;
		seen.add(result.data.id);
		tagIds.push(result.data.id);
		labels.push(result.data.label);
		if (result.data.didYouMean.length > 0) {
			didYouMean.push({ input: inputLabel, suggestions: result.data.didYouMean });
		}
	}

	return {
		ok: true,
		applied: true,
		tagIds,
		labels,
		didYouMean,
		legacyUsed: true,
		ignoredLegacy: false,
	};
}

export type MilestoneResolutionInput = {
	milestoneId?: string | null | undefined;
	milestoneName?: string | null | undefined;
};

export type MilestoneResolutionSuccess = {
	ok: true;
	applied: boolean;
	// undefined = leave existing milestone alone; null = unassign; string = set.
	milestoneId: string | null | undefined;
	didYouMean: { id: string; name: string; distance: number }[];
	legacyUsed: boolean;
	ignoredLegacy: boolean;
};

export type MilestoneResolutionFailure = {
	ok: false;
	error: string;
};

export type MilestoneResolution = MilestoneResolutionSuccess | MilestoneResolutionFailure;

export async function resolveMilestoneForWrite(
	prisma: PrismaClient,
	projectId: string,
	input: MilestoneResolutionInput
): Promise<MilestoneResolution> {
	const idProvided = input.milestoneId !== undefined;
	const nameProvided = !idProvided && input.milestoneName !== undefined;
	const ignoredLegacy = idProvided && input.milestoneName !== undefined;

	if (!idProvided && !nameProvided) {
		return {
			ok: true,
			applied: false,
			milestoneId: undefined,
			didYouMean: [],
			legacyUsed: false,
			ignoredLegacy: false,
		};
	}

	if (idProvided) {
		if (input.milestoneId === null) {
			return {
				ok: true,
				applied: true,
				milestoneId: null,
				didYouMean: [],
				legacyUsed: false,
				ignoredLegacy,
			};
		}
		const m = await prisma.milestone.findUnique({
			where: { id: input.milestoneId as string },
			select: { id: true, projectId: true },
		});
		if (!m) {
			return { ok: false, error: `Milestone "${input.milestoneId}" not found.` };
		}
		if (m.projectId !== projectId) {
			return {
				ok: false,
				error: `Milestone "${input.milestoneId}" belongs to a different project.`,
			};
		}
		return {
			ok: true,
			applied: true,
			milestoneId: m.id,
			didYouMean: [],
			legacyUsed: false,
			ignoredLegacy,
		};
	}

	// Legacy path
	if (input.milestoneName === null) {
		return {
			ok: true,
			applied: true,
			milestoneId: null,
			didYouMean: [],
			legacyUsed: true,
			ignoredLegacy: false,
		};
	}
	const result = await resolveOrCreateMilestoneSvc(
		prisma,
		projectId,
		input.milestoneName as string
	);
	if (!result.success) {
		return { ok: false, error: result.error.message };
	}
	return {
		ok: true,
		applied: true,
		milestoneId: result.data.id,
		didYouMean: result.data.didYouMean,
		legacyUsed: true,
		ignoredLegacy: false,
	};
}

// Replace all CardTag rows for a card with the given tagIds. Transactional;
// idempotent — re-running with the same input is a no-op. The caller passes
// only the desired final state, not a diff.
export async function syncCardTags(
	prisma: PrismaClient,
	cardId: string,
	tagIds: string[]
): Promise<void> {
	await prisma.$transaction(async (tx) => {
		if (tagIds.length === 0) {
			await tx.cardTag.deleteMany({ where: { cardId } });
			return;
		}
		await tx.cardTag.deleteMany({ where: { cardId, tagId: { notIn: tagIds } } });
		for (const tagId of tagIds) {
			await tx.cardTag.upsert({
				where: { cardId_tagId: { cardId, tagId } },
				create: { cardId, tagId },
				update: {},
			});
		}
	});
}

// Build the deprecation/didYouMean meta block for a card mutation response.
// Returns undefined when there's nothing to attach so callers can spread it
// conditionally without polluting clean responses.
export function buildTaxonomyMeta(
	tagResolution: TagResolutionSuccess | null,
	milestoneResolution: MilestoneResolutionSuccess | null
): { _deprecated?: string[]; _didYouMean?: Record<string, unknown> } | undefined {
	const deprecated: string[] = [];
	const didYouMean: Record<string, unknown> = {};

	if (tagResolution?.legacyUsed) {
		deprecated.push(
			"`tags: string[]` is deprecated and will be removed in v5.0.0. Use `tagSlugs: string[]` (strict) and call `createTag` first when introducing new vocabulary."
		);
	}
	if (tagResolution?.ignoredLegacy) {
		deprecated.push(
			"Both `tagSlugs` and `tags` were provided; `tags` was ignored in favour of `tagSlugs`."
		);
	}
	if (tagResolution?.didYouMean && tagResolution.didYouMean.length > 0) {
		didYouMean.tags = tagResolution.didYouMean;
	}

	if (milestoneResolution?.legacyUsed) {
		deprecated.push(
			"`milestoneName: string` is deprecated and will be removed in v5.0.0. Use `milestoneId: string` (strict) and call `createMilestone` first when introducing new vocabulary."
		);
	}
	if (milestoneResolution?.ignoredLegacy) {
		deprecated.push(
			"Both `milestoneId` and `milestoneName` were provided; `milestoneName` was ignored in favour of `milestoneId`."
		);
	}
	if (milestoneResolution?.didYouMean && milestoneResolution.didYouMean.length > 0) {
		didYouMean.milestone = milestoneResolution.didYouMean;
	}

	if (deprecated.length === 0 && Object.keys(didYouMean).length === 0) return undefined;
	const out: { _deprecated?: string[]; _didYouMean?: Record<string, unknown> } = {};
	if (deprecated.length > 0) out._deprecated = deprecated;
	if (Object.keys(didYouMean).length > 0) out._didYouMean = didYouMean;
	return out;
}
