import { db } from "@/mcp/db.js";
import type { Check, CheckResult } from "../types.js";

const PARENT = "knowledge_fts";
const SHADOWS = [
	"knowledge_fts_config",
	"knowledge_fts_data",
	"knowledge_fts_docsize",
	"knowledge_fts_idx",
];

/**
 * FTS5 virtual tables and their `_data`/`_idx`/`_docsize`/`_config` shadow
 * tables must be present together. A half-state (parent without shadows
 * or shadows without parent) is what the v5.0 phantom-drop tried to
 * create and is hard to recover from.
 */
export const fts5SanityCheck: Check = {
	name: "FTS5 sanity",
	async run(): Promise<CheckResult> {
		let rows: Array<{ name: string }>;
		try {
			rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
				"SELECT name FROM sqlite_master WHERE type IN ('table','virtual') AND name LIKE 'knowledge_fts%'"
			);
		} catch (err) {
			return {
				name: this.name,
				status: "skip",
				message: `Could not query sqlite_master: ${(err as Error).message}`,
			};
		}

		const present = new Set(rows.map((r) => r.name));
		const hasParent = present.has(PARENT);
		const missingShadows = SHADOWS.filter((s) => !present.has(s));
		const hasAnyShadow = SHADOWS.some((s) => present.has(s));

		if (hasParent && missingShadows.length === 0) {
			return {
				name: this.name,
				status: "pass",
				message: `${PARENT} virtual table and all 4 shadow tables present.`,
			};
		}

		if (!hasParent && !hasAnyShadow) {
			return {
				name: this.name,
				status: "warn",
				message: `${PARENT} not initialized yet. Will be created on first MCP server start.`,
				fix: "Restart the service: npm run service:update",
			};
		}

		if (hasParent && missingShadows.length > 0) {
			return {
				name: this.name,
				status: "fail",
				message: `${PARENT} exists but shadow tables missing: ${missingShadows.join(", ")}.`,
				fix: 'Rebuild FTS: sqlite3 data/tracker.db "DROP TABLE IF EXISTS knowledge_fts;" then restart the service.',
			};
		}

		return {
			name: this.name,
			status: "fail",
			message: `Half-state detected: ${PARENT} missing but shadow tables present (${SHADOWS.filter((s) => present.has(s)).join(", ")}).`,
			fix: "Drop orphaned shadow tables manually with sqlite3, then restart the service to re-create the virtual table cleanly.",
		};
	},
};
