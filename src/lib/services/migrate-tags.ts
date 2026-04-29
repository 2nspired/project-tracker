// v4.2 tag rework migration. One-shot, idempotent backfill from the legacy
// `Card.tags String @default("[]")` JSON column into the new Tag + CardTag
// junction. Composes with `migrateProjectPrompt` so a friend upgrading from
// v4.0/4.1 → v4.2 can run both in one window.
//
// Behaviour:
//   1. For each card, parse the JSON tag list, slugify each entry, group
//      by (projectId, slug), and pick the most-frequent original casing
//      as the canonical Tag.label (lexicographic tiebreak).
//   2. Upsert one Tag per (projectId, slug); upsert one CardTag per
//      (cardId, tagId). Re-running is a no-op because of the upserts.
//   3. For Note rows with non-empty `tags`, append a `\nTags: a, b` footer
//      to the note body and clear the `tags` column. The footer presence
//      is the idempotency check.
//   4. Card.tags JSON column is NOT cleared — it stays in v4.2 as a read
//      fallback and is dropped in v5.
//
// Returns a structured audit summary that the caller can persist to disk
// (the MCP tool writes it to data/tag-migration-{timestamp}.json) and a
// list of canonicalisations the human should review.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PrismaClient } from "prisma/generated/client";
import { slugify } from "@/lib/slugify";

export type ProjectMigrationSummary = {
	projectId: string;
	projectName: string;
	tagsCreatedOrUpdated: number;
	cardTagsCreated: number;
	cardTagsAlreadyPresent: number;
	merges: Array<{
		slug: string;
		label: string;
		mergedFrom: string[];
		cardCount: number;
	}>;
};

export type NotesMigrationSummary = {
	notesScanned: number;
	notesUpdated: number;
	notesAlreadyMigrated: number;
};

export type MigrationSummary = {
	timestamp: string;
	totalDistinctInputs: number;
	totalCanonicalSlugs: number;
	totalCardTagsCreated: number;
	projects: ProjectMigrationSummary[];
	notes: NotesMigrationSummary;
};

export async function migrateTags(prisma: PrismaClient): Promise<MigrationSummary> {
	const cards = await prisma.card.findMany({
		select: { id: true, projectId: true, tags: true },
	});

	// Group by projectId — Tag uniqueness is project-scoped.
	const projectGroups = new Map<string, typeof cards>();
	for (const c of cards) {
		const list = projectGroups.get(c.projectId) ?? [];
		list.push(c);
		projectGroups.set(c.projectId, list);
	}

	const projectSummaries: ProjectMigrationSummary[] = [];
	const totalDistinctInputs = new Set<string>();
	const totalCanonicalSlugs = new Set<string>();
	let totalCardTagsCreated = 0;

	for (const [projectId, projectCards] of projectGroups) {
		const project = await prisma.project.findUnique({
			where: { id: projectId },
			select: { name: true },
		});
		const projectName = project?.name ?? "(unknown)";

		// (slug → { labelCounts, cardIds, originals })
		type Bucket = {
			labelCounts: Map<string, number>;
			cardIds: Set<string>;
			originals: Set<string>;
		};
		const buckets = new Map<string, Bucket>();

		for (const card of projectCards) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(card.tags);
			} catch {
				continue;
			}
			if (!Array.isArray(parsed)) continue;
			for (const raw of parsed) {
				if (typeof raw !== "string") continue;
				const trimmed = raw.trim();
				if (!trimmed) continue;
				const slug = slugify(trimmed);
				if (!slug) continue;
				totalDistinctInputs.add(`${projectId}:${trimmed}`);
				let bucket = buckets.get(slug);
				if (!bucket) {
					bucket = {
						labelCounts: new Map(),
						cardIds: new Set(),
						originals: new Set(),
					};
					buckets.set(slug, bucket);
				}
				bucket.labelCounts.set(trimmed, (bucket.labelCounts.get(trimmed) ?? 0) + 1);
				bucket.cardIds.add(card.id);
				bucket.originals.add(trimmed);
			}
		}

		let tagsTouched = 0;
		let cardTagsCreated = 0;
		let cardTagsAlreadyPresent = 0;
		const merges: ProjectMigrationSummary["merges"] = [];

		for (const [slug, bucket] of buckets) {
			totalCanonicalSlugs.add(`${projectId}:${slug}`);
			// Pick the most-frequent original casing as the label; lexicographic
			// tiebreak so the result is deterministic across re-runs.
			const sortedLabels = [...bucket.labelCounts.entries()].sort((a, b) => {
				if (b[1] !== a[1]) return b[1] - a[1];
				return a[0].localeCompare(b[0]);
			});
			const canonicalLabel = sortedLabels[0][0];

			const tag = await prisma.tag.upsert({
				where: { projectId_slug: { projectId, slug } },
				create: { projectId, slug, label: canonicalLabel },
				update: {}, // existing tag's label is not overwritten
			});
			tagsTouched++;

			for (const cardId of bucket.cardIds) {
				const existing = await prisma.cardTag.findUnique({
					where: { cardId_tagId: { cardId, tagId: tag.id } },
				});
				if (existing) {
					cardTagsAlreadyPresent++;
				} else {
					await prisma.cardTag.create({ data: { cardId, tagId: tag.id } });
					cardTagsCreated++;
					totalCardTagsCreated++;
				}
			}

			// Only record a merge entry when the bucket genuinely collapsed
			// multiple input variants to the same slug — single-variant buckets
			// are noise.
			if (bucket.originals.size > 1) {
				merges.push({
					slug,
					label: canonicalLabel,
					mergedFrom: [...bucket.originals].sort(),
					cardCount: bucket.cardIds.size,
				});
			}
		}

		projectSummaries.push({
			projectId,
			projectName,
			tagsCreatedOrUpdated: tagsTouched,
			cardTagsCreated,
			cardTagsAlreadyPresent,
			merges,
		});
	}

	const notes = await migrateNoteTagsToBody(prisma);

	return {
		timestamp: new Date().toISOString(),
		totalDistinctInputs: totalDistinctInputs.size,
		totalCanonicalSlugs: totalCanonicalSlugs.size,
		totalCardTagsCreated,
		projects: projectSummaries,
		notes,
	};
}

const NOTE_TAGS_FOOTER_PREFIX = "\n\nTags: ";

async function migrateNoteTagsToBody(prisma: PrismaClient): Promise<NotesMigrationSummary> {
	const notes = await prisma.note.findMany({
		where: { NOT: { tags: "[]" } },
		select: { id: true, content: true, tags: true },
	});

	let updated = 0;
	let alreadyMigrated = 0;

	for (const note of notes) {
		// Idempotency: presence of a `Tags: ` footer line means we already
		// migrated this note; clear the column without touching content.
		if (note.content.includes(NOTE_TAGS_FOOTER_PREFIX)) {
			alreadyMigrated++;
			await prisma.note.update({
				where: { id: note.id },
				data: { tags: "[]" },
			});
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(note.tags);
		} catch {
			continue;
		}
		if (!Array.isArray(parsed) || parsed.length === 0) continue;
		const tagList = parsed.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
		if (tagList.length === 0) continue;

		const newContent = `${note.content}${NOTE_TAGS_FOOTER_PREFIX}${tagList.join(", ")}`;
		await prisma.note.update({
			where: { id: note.id },
			data: { content: newContent, tags: "[]" },
		});
		updated++;
	}

	return {
		notesScanned: notes.length,
		notesUpdated: updated,
		notesAlreadyMigrated: alreadyMigrated,
	};
}

export async function writeMigrationAudit(
	auditPath: string,
	summary: MigrationSummary
): Promise<void> {
	await mkdir(dirname(auditPath), { recursive: true });
	await writeFile(auditPath, JSON.stringify(summary, null, 2), "utf8");
}
