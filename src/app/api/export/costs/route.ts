/**
 * Costs export Route Handler (#136).
 *
 * Returns the per-card cost lens (the same data that backs the Costs
 * page's Card Delivery section) as a downloadable CSV or Markdown file —
 * the use case is a consultant tracking billable hours who needs a
 * card-cost report without spinning up a SQL session.
 *
 * Why a Route Handler and not a tRPC procedure: tRPC always returns JSON.
 * Browsers download a file when the response carries `Content-Type:
 * text/csv` (or `text/markdown`) plus `Content-Disposition: attachment`,
 * so the download path needs raw HTTP control that tRPC doesn't expose.
 *
 * Query string contract:
 *   - `projectId`: UUID, required.
 *   - `format`: `csv` (default) | `md`.
 *   - `boardId`: UUID, optional. Scopes to a single board (same expansion
 *     rules as the Costs page UI — see `resolveBoardScopeWhere`).
 *
 * The data path reuses `tokenUsageService.getCardDeliveryMetrics`: a
 * single source of truth means CSV/MD numbers can never drift from what
 * the UI shows. UUID validation is local (regex) — no zod dependency
 * needed for two fields.
 */

import {
	contentType,
	type ExportFormat,
	exportFilename,
	toCsv,
	toMarkdown,
} from "@/lib/services/cost-export";
import { slugify } from "@/lib/slugify";
import { db } from "@/server/db";
import { tokenUsageService } from "@/server/services/token-usage-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// RFC 4122 — accept the 8-4-4-4-12 hex layout. Case-insensitive; we don't
// pin the version nibble because the rest of the codebase doesn't either
// (zod's `.uuid()` matches the same general shape).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message: string): Response {
	return new Response(message, { status: 400, headers: { "Cache-Control": "no-store" } });
}

function notFound(message: string): Response {
	return new Response(message, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function parseFormat(raw: string | null): ExportFormat | null {
	if (raw === null || raw === "csv") return "csv";
	if (raw === "md") return "md";
	return null;
}

export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const projectId = url.searchParams.get("projectId");
	const formatParam = url.searchParams.get("format");
	const boardIdRaw = url.searchParams.get("boardId");

	if (!projectId) return badRequest("Missing projectId parameter.");
	if (!UUID_RE.test(projectId)) return badRequest("Malformed projectId — expected UUID.");

	const format = parseFormat(formatParam);
	if (!format) return badRequest("Invalid format — expected 'csv' or 'md'.");

	let boardId: string | undefined;
	if (boardIdRaw) {
		if (!UUID_RE.test(boardIdRaw)) return badRequest("Malformed boardId — expected UUID.");
		boardId = boardIdRaw;
	}

	// Resolve project name for the filename + preamble. 404 when the
	// project doesn't exist — same shape as the Costs page route.
	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { name: true },
	});
	if (!project) return notFound("Project not found.");

	// `limit: 100` is the same hard ceiling the service enforces internally
	// — pass it explicitly here so the export grabs every card the lens
	// surfaces, not just the top 5 the UI shows.
	const result = await tokenUsageService.getCardDeliveryMetrics(projectId, {
		boardId,
		limit: 100,
	});
	if (!result.success) {
		return new Response(`Failed to load metrics: ${result.error.message}`, {
			status: 500,
			headers: { "Cache-Control": "no-store" },
		});
	}

	const generatedAt = new Date();
	const summary = {
		projectName: project.name,
		generatedAt,
		totalCardCount: result.data.topCards.length,
		shippedCardCount: result.data.shippedCardCount,
		medianShippedCardCostUsd: result.data.medianShippedCardCostUsd,
	};

	const body =
		format === "csv"
			? toCsv(result.data.topCards, summary)
			: toMarkdown(result.data.topCards, summary);

	const filename = exportFilename(slugify(project.name), generatedAt, format);

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": contentType(format),
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}
