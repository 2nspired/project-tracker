/**
 * Categorize a file path by its type for commit summary grouping.
 */

const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".test.js", ".spec.js"];
const SCHEMA_EXTS = [".prisma", ".sql", ".graphql"];
const DOC_EXTS = [".md", ".mdx", ".txt", ".rst"];
const STYLE_EXTS = [".css", ".scss", ".sass", ".less"];
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const CONFIG_EXTS = [".json", ".yaml", ".yml", ".toml", ".env"];
const CONFIG_BASENAMES = /^(tsconfig|package|next\.config|vite\.config|eslint|prettier|biome)\b/i;

export type FileCategory = "source" | "styles" | "config" | "schema" | "tests" | "docs" | "other";

export function categorizeFile(filePath: string): FileCategory {
	const lower = filePath.toLowerCase();
	const basename = lower.split("/").pop() ?? "";

	// Tests first — they'd otherwise match "source"
	for (const ext of TEST_SUFFIXES) {
		if (lower.endsWith(ext)) return "tests";
	}

	// Config files: dotfiles or known config basenames
	if (
		(basename.startsWith(".") && !basename.endsWith(".ts") && !basename.endsWith(".tsx")) ||
		CONFIG_BASENAMES.test(basename)
	) {
		return "config";
	}

	for (const ext of SCHEMA_EXTS) {
		if (lower.endsWith(ext)) return "schema";
	}
	for (const ext of DOC_EXTS) {
		if (lower.endsWith(ext)) return "docs";
	}
	for (const ext of STYLE_EXTS) {
		if (lower.endsWith(ext)) return "styles";
	}
	for (const ext of SOURCE_EXTS) {
		if (lower.endsWith(ext)) return "source";
	}
	for (const ext of CONFIG_EXTS) {
		if (lower.endsWith(ext)) return "config";
	}

	return "other";
}
