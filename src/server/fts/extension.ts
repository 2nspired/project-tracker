/**
 * Prisma client extension that keeps the FTS5 knowledge index live.
 *
 * Hooks `create / update / upsert / delete` on Note, Claim, Card, and Comment
 * models. After each write, the relevant per-source indexer is called so
 * `knowledge_fts` reflects the new state without manual rebuild.
 *
 * ─── Design notes ─────────────────────────────────────────────────
 *
 * - `rawClient` is the un-extended PrismaClient. Indexer functions use it
 *   directly so further reads/writes don't recurse through this extension.
 * - FTS sync errors are LOGGED but never propagated. The user's write must
 *   succeed regardless — FTS is a secondary index and a sync failure is a
 *   degradation, not a data-integrity problem. The cold-start auto-rebuild
 *   in `queryKnowledge` and the manual `rebuildKnowledgeIndex` tool are the
 *   recovery paths.
 * - `createMany / updateMany / deleteMany` are NOT hooked. Prisma extensions
 *   don't return affected rows for batch ops, so we can't index without an
 *   extra refetch — and the refetch is brittle (e.g. cascading deletes leave
 *   no rows to refetch). Operators run `rebuildKnowledgeIndex` after batch
 *   ops; this is documented in `./index.ts` and on card #112.
 */

import { Prisma, type PrismaClient } from "prisma/generated/client";
import { indexCard, indexClaim, indexComment, indexNote, removeFromIndex } from ".";

function logFtsError(op: string, err: unknown): void {
	console.warn(`[fts] live-sync ${op} failed (write succeeded):`, err);
}

export function ftsExtension(rawClient: PrismaClient) {
	return Prisma.defineExtension({
		name: "fts-sync",
		query: {
			note: {
				async create({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexNote(rawClient, result.id).catch((e) => logFtsError("note.create", e));
					return result;
				},
				async update({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexNote(rawClient, result.id).catch((e) => logFtsError("note.update", e));
					return result;
				},
				async upsert({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexNote(rawClient, result.id).catch((e) => logFtsError("note.upsert", e));
					return result;
				},
				async delete({ args, query }) {
					const result = (await query(args)) as { id: string };
					removeFromIndex(rawClient, "note", result.id).catch((e) => logFtsError("note.delete", e));
					removeFromIndex(rawClient, "handoff", result.id).catch((e) =>
						logFtsError("handoff.delete", e)
					);
					return result;
				},
			},
			claim: {
				async create({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexClaim(rawClient, result.id).catch((e) => logFtsError("claim.create", e));
					return result;
				},
				async update({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexClaim(rawClient, result.id).catch((e) => logFtsError("claim.update", e));
					return result;
				},
				async upsert({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexClaim(rawClient, result.id).catch((e) => logFtsError("claim.upsert", e));
					return result;
				},
				async delete({ args, query }) {
					const result = (await query(args)) as { id: string };
					// Claims are stored in FTS with source_type `claim_<kind>`. We
					// don't know the kind from the deleted row in some cases, so
					// remove all known claim-kind variants.
					for (const kind of ["context", "code", "measurement", "decision"]) {
						removeFromIndex(rawClient, `claim_${kind}`, result.id).catch((e) =>
							logFtsError(`claim_${kind}.delete`, e)
						);
					}
					return result;
				},
			},
			card: {
				async create({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexCard(rawClient, result.id).catch((e) => logFtsError("card.create", e));
					return result;
				},
				async update({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexCard(rawClient, result.id).catch((e) => logFtsError("card.update", e));
					return result;
				},
				async upsert({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexCard(rawClient, result.id).catch((e) => logFtsError("card.upsert", e));
					return result;
				},
				async delete({ args, query }) {
					const result = (await query(args)) as { id: string };
					removeFromIndex(rawClient, "card", result.id).catch((e) => logFtsError("card.delete", e));
					return result;
				},
			},
			comment: {
				async create({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexComment(rawClient, result.id).catch((e) => logFtsError("comment.create", e));
					return result;
				},
				async update({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexComment(rawClient, result.id).catch((e) => logFtsError("comment.update", e));
					return result;
				},
				async upsert({ args, query }) {
					const result = (await query(args)) as { id: string };
					indexComment(rawClient, result.id).catch((e) => logFtsError("comment.upsert", e));
					return result;
				},
				async delete({ args, query }) {
					const result = (await query(args)) as { id: string };
					removeFromIndex(rawClient, "comment", result.id).catch((e) =>
						logFtsError("comment.delete", e)
					);
					return result;
				},
			},
		},
	});
}
