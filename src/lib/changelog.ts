/**
 * Pure CHANGELOG.md section extractor (#210 PR-B).
 *
 * Powers the `system.releaseNotes` tRPC procedure and the `<UpgradePanel>`
 * "What's new" surface on the board. CHANGELOG.md is the source of truth
 * (governed by the `unreleased-entry` CI gate), so the in-product copy
 * stays in sync with the release notes — bump `package.json`, ship,
 * upgrade panel renders the matching section.
 *
 * Pure string-in / string-out — caller owns reading the file. Keeping this
 * isolated from `fs` makes the parser trivially testable without fixtures.
 */

/**
 * Pull the body of a single Keep-a-Changelog version section out of the
 * full CHANGELOG content. Returns `null` when the version isn't present.
 *
 * The semver-only pattern means `[Unreleased]` is *not* matchable by
 * construction — callers can pass user-controllable input without an
 * extra guard.
 */
export function extractSection(content: string, version: string): string | null {
	if (!/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
		// Reject anything that isn't a strict semver. Blocks `Unreleased`,
		// `[Unreleased]`, regex metacharacters, and accidental section-name
		// lookups before they hit the regex builder.
		return null;
	}

	// `## [<version>]` heading at start of line. Anchors on `\n` rather
	// than `^/m` so a CHANGELOG that opens with a heading still matches.
	const escapedVersion = version.replace(/\./g, "\\.");
	const headingPattern = new RegExp(`(^|\\n)## \\[${escapedVersion}\\][^\\n]*\\n`);
	const match = headingPattern.exec(content);
	if (!match) return null;

	const sectionStart = match.index + match[0].length;

	// Slice to the next `## ` heading at start of line (or EOF).
	const remainder = content.slice(sectionStart);
	const nextHeading = /\n## /.exec(remainder);
	const sectionBody = nextHeading ? remainder.slice(0, nextHeading.index) : remainder;

	return sectionBody.trim();
}
