/**
 * Pure serializers for the Costs page export (#136).
 *
 * Backs `src/app/api/export/costs/route.ts`. Kept dependency-free so the
 * Route Handler can stream a `text/csv` (or `text/markdown`) Response with
 * a `Content-Disposition: attachment` header without spinning up a SQL
 * session — the use case is a consultant tracking billable hours who
 * needs a card-cost report they can hand to a client.
 *
 * Data shape comes straight from `tokenUsageService.getCardDeliveryMetrics`
 * (`CardDeliveryEntry` rows + `shippedCardCount` / `medianShippedCardCostUsd`
 * for the preamble). Per-row order matches what the Costs page surfaces:
 * card ref / title / status / sessions / cost / completedAt.
 */

import type { CardDeliveryEntry } from "@/lib/services/token-usage";

export type ExportFormat = "csv" | "md";

export type ExportSummary = {
	projectName: string;
	generatedAt: Date;
	totalCardCount: number;
	shippedCardCount: number;
	medianShippedCardCostUsd: number | null;
};

const CSV_HEADERS = [
	"card_ref",
	"card_title",
	"status",
	"session_count",
	"total_cost_usd",
	"completed_at",
] as const;

// RFC 4180 — quote a field if it contains commas, quotes, or newlines.
// Internal quotes are escaped by doubling.
function csvField(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "";
	const s = String(value);
	if (/[",\r\n]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function formatCost(value: number): string {
	// 4 decimal places — sub-cent fidelity matters for short sessions
	// (Haiku/cache-heavy runs sit well under a cent).
	return value.toFixed(4);
}

function formatDate(date: Date | null): string {
	if (!date) return "";
	return date.toISOString();
}

/**
 * CSV serializer. RFC 4180 quoting. Always emits the header row; an empty
 * `entries` array yields a header-only document (the empty-state "no
 * shipped cards yet" note is surfaced via the preamble in MD; CSV stays
 * machine-readable and skips the prose).
 */
export function toCsv(entries: CardDeliveryEntry[], summary: ExportSummary): string {
	const lines: string[] = [];

	// Preamble as CSV comments (`#`-prefixed lines). Most spreadsheet
	// importers strip these on load; consumers parsing manually can
	// `grep -v ^#` to drop them. Trade-off: keeps human context in the
	// same file as the data without needing a sidecar.
	lines.push(`# Pigeon Costs Export — ${csvComment(summary.projectName)}`);
	lines.push(`# Generated: ${summary.generatedAt.toISOString()}`);
	lines.push(`# Total cards: ${summary.totalCardCount}`);
	lines.push(`# Shipped cards: ${summary.shippedCardCount}`);
	if (summary.medianShippedCardCostUsd !== null) {
		lines.push(`# Median shipped card cost (USD): ${formatCost(summary.medianShippedCardCostUsd)}`);
	} else {
		lines.push(`# Median shipped card cost (USD): no shipped cards yet`);
	}

	lines.push(CSV_HEADERS.join(","));
	for (const entry of entries) {
		lines.push(
			[
				csvField(entry.cardRef),
				csvField(entry.cardTitle),
				csvField(entry.isShipped ? "shipped" : "in_flight"),
				csvField(entry.sessionCount),
				csvField(formatCost(entry.totalCostUsd)),
				csvField(formatDate(entry.completedAt)),
			].join(",")
		);
	}
	// Trailing newline — POSIX-friendly and matches what `printf` / most
	// CSV writers produce.
	return `${lines.join("\n")}\n`;
}

// Strip newlines from comment-line values so a malicious / weird project
// name can't break out of the `#` preamble.
function csvComment(value: string): string {
	return value.replace(/[\r\n]+/g, " ");
}

// Escape pipe + backslash inside markdown table cells. Newlines are
// replaced with a literal space — GFM tables don't support multi-line
// cells.
function mdCell(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "";
	return String(value)
		.replace(/\\/g, "\\\\")
		.replace(/\|/g, "\\|")
		.replace(/[\r\n]+/g, " ");
}

/**
 * Markdown (GFM) serializer. Preamble shows project name, generation
 * timestamp, total card count, and median shipped card cost. Body is a
 * GFM table. Empty `entries` yields a preamble + the "no shipped cards
 * yet" note, no table.
 */
export function toMarkdown(entries: CardDeliveryEntry[], summary: ExportSummary): string {
	const lines: string[] = [];
	lines.push(`# Pigeon Costs — ${summary.projectName}`);
	lines.push("");
	lines.push(`- Generated: ${summary.generatedAt.toISOString()}`);
	lines.push(`- Total cards: ${summary.totalCardCount}`);
	lines.push(`- Shipped cards: ${summary.shippedCardCount}`);
	if (summary.medianShippedCardCostUsd !== null) {
		lines.push(`- Median shipped card cost: $${formatCost(summary.medianShippedCardCostUsd)} USD`);
	} else {
		lines.push(`- Median shipped card cost: no shipped cards yet`);
	}
	lines.push("");

	if (entries.length === 0) {
		lines.push("_No card-cost rows for this scope._");
		lines.push("");
		return lines.join("\n");
	}

	lines.push("| Card | Title | Status | Sessions | Cost (USD) | Completed |");
	lines.push("| --- | --- | --- | ---: | ---: | --- |");
	for (const entry of entries) {
		lines.push(
			[
				"",
				mdCell(entry.cardRef),
				mdCell(entry.cardTitle),
				mdCell(entry.isShipped ? "shipped" : "in flight"),
				mdCell(entry.sessionCount),
				mdCell(formatCost(entry.totalCostUsd)),
				mdCell(formatDate(entry.completedAt)),
				"",
			].join(" | ")
		);
	}
	lines.push("");
	return lines.join("\n");
}

/**
 * Filename builder: `pigeon-costs-${slug}-${YYYY-MM-DD}.${ext}`. Slug is
 * derived from project name via the project's existing `slugify` (which
 * normalizes diacritics, lowercases, and kebab-cases). Falls back to
 * `project` when slugify yields an empty string (project name was all
 * whitespace / symbols).
 */
export function exportFilename(
	projectSlug: string,
	generatedAt: Date,
	format: ExportFormat
): string {
	const slug = projectSlug || "project";
	const ext = format === "csv" ? "csv" : "md";
	const yyyy = generatedAt.getUTCFullYear();
	const mm = String(generatedAt.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(generatedAt.getUTCDate()).padStart(2, "0");
	return `pigeon-costs-${slug}-${yyyy}-${mm}-${dd}.${ext}`;
}

/**
 * Content-Type header value for the format. CSV → `text/csv`, Markdown →
 * `text/markdown`. Both `charset=utf-8` so a project name with em-dashes
 * round-trips cleanly.
 */
export function contentType(format: ExportFormat): string {
	return format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8";
}
