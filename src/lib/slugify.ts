// Normalize a user-facing label into a kebab-case slug.
//
// Rules:
//   1. Trim whitespace.
//   2. NFKD-normalize and strip combining marks ("Café" → "cafe").
//   3. Lowercase.
//   4. Collapse non-alphanumeric runs into a single "-".
//   5. Strip leading/trailing "-".
//   6. Cap at 50 chars, then re-strip any trailing "-" the cut may have left.
//
// Returns "" when the input contains no slug-eligible characters; callers
// should treat "" as invalid (do not write it as a tag/milestone slug).
export function slugify(input: string): string {
	return input
		.trim()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50)
		.replace(/-+$/, "");
}

// Levenshtein distance with an early-exit threshold. Used by the
// `_didYouMean` hint on near-match tag/milestone resolution: if a typed
// label is ≤2 edits away from an existing slug, surface it as a suggestion.
//
// Runs O(min(a, b) * threshold) in the worst case via the truncated
// DP-row pattern; exits early once every row cell exceeds the threshold.
export function editDistance(a: string, b: string, threshold = 2): number {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > threshold) return threshold + 1;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	let curr = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
			if (curr[j] < rowMin) rowMin = curr[j];
		}
		if (rowMin > threshold) return threshold + 1;
		[prev, curr] = [curr, prev];
	}

	return prev[b.length];
}
