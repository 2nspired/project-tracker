/**
 * Card Similarity Detection — lightweight local NLP.
 *
 * Uses character trigram Jaccard similarity to detect
 * duplicate or near-duplicate cards without external APIs.
 */

const STOP_WORDS = new Set([
	"a",
	"an",
	"the",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"to",
	"of",
	"in",
	"for",
	"on",
	"with",
	"at",
	"by",
	"from",
	"and",
	"or",
	"but",
	"not",
	"this",
	"that",
	"it",
	"as",
	"add",
	"update",
	"fix",
	"implement",
	"create",
	"remove",
]);

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOP_WORDS.has(w))
		.join(" ");
}

function trigrams(text: string): Set<string> {
	const set = new Set<string>();
	const normalized = normalize(text);
	if (normalized.length < 3) {
		// For very short strings, use the whole string
		set.add(normalized);
		return set;
	}
	for (let i = 0; i <= normalized.length - 3; i++) {
		set.add(normalized.slice(i, i + 3));
	}
	return set;
}

/**
 * Jaccard similarity between two strings using character trigrams.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
export function similarity(a: string, b: string): number {
	const sa = trigrams(a);
	const sb = trigrams(b);

	if (sa.size === 0 || sb.size === 0) return 0;

	let intersection = 0;
	for (const gram of sa) {
		if (sb.has(gram)) intersection++;
	}

	const union = sa.size + sb.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

export type SimilarCard = {
	id: string;
	number: number;
	title: string;
	score: number;
};

/**
 * Find cards similar to a given title from a list of existing cards.
 * Returns matches above the threshold, sorted by similarity (descending).
 */
export function findSimilarCards(
	title: string,
	cards: Array<{ id: string; number: number; title: string }>,
	threshold = 0.35,
	maxResults = 3
): SimilarCard[] {
	if (title.trim().length < 3) return [];

	return cards
		.map((card) => ({
			...card,
			score: similarity(title, card.title),
		}))
		.filter((c) => c.score >= threshold)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults);
}
