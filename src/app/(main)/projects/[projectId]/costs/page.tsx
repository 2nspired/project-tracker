import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CostsPage } from "@/components/costs/costs-page";
import { db } from "@/server/db";
import { api } from "@/trpc/server";

// Server component shell for the per-project Costs page. Resolves the
// project up-front so we can 404 on a bad id and pass the resolved name
// down to the client component without an extra round-trip. Data fetches
// for cost rollups stay on the client so React Query can cache them and
// future mutations (pricing overrides — Step 5, follow-up card) co-locate
// with the surface that uses them.
//
// Route shape: matches the rest of the project tree (`[projectId]` rather
// than `[projectSlug]`). The card spec called out `[projectSlug]` but the
// existing project pages and the `Back to project` link both key off
// `projectId`, so the cheaper, more consistent move is to keep the same
// param name.
//
// Board-scope plumbing (#200 Phase 2a). Optional `?board=<id>` query
// param scopes the summary strip + sparkline (the two backend-aware
// queries from Phase 1a) to a single board. Validated server-side: the
// board must exist *and* belong to the URL-scoped project. Cross-project
// or unknown ids hit `notFound()` rather than rendering an empty page —
// keeps the URL from leaking info about another project's board ids.
// `from` is read but not yet acted on (Phase 2c uses it for back-link
// precedence).

type CostsRouteSearchParams = {
	board?: string;
	from?: string;
};

type ResolvedBoardScope = {
	boardId: string;
	boardName: string;
};

async function resolveBoardScope(
	projectId: string,
	boardParam: string | undefined
): Promise<ResolvedBoardScope | null> {
	if (!boardParam) return null;
	const board = await db.board.findUnique({
		where: { id: boardParam },
		select: { id: true, name: true, projectId: true },
	});
	// Cross-project or unknown ids: treat as 404 rather than silently
	// falling back to project scope — prevents probing other projects'
	// board ids via this route.
	if (!board || board.projectId !== projectId) {
		notFound();
	}
	return { boardId: board.id, boardName: board.name };
}

export async function generateMetadata({
	params,
	searchParams,
}: {
	params: Promise<{ projectId: string }>;
	searchParams: Promise<CostsRouteSearchParams>;
}): Promise<Metadata> {
	const [{ projectId }, { board: boardParam }] = await Promise.all([params, searchParams]);
	if (!boardParam) return { title: "Costs" };

	const board = await db.board.findUnique({
		where: { id: boardParam },
		select: { name: true, projectId: true },
	});
	if (!board || board.projectId !== projectId) return { title: "Costs" };
	return { title: `Costs · ${board.name}` };
}

export default async function CostsRoute({
	params,
	searchParams,
}: {
	params: Promise<{ projectId: string }>;
	searchParams: Promise<CostsRouteSearchParams>;
}) {
	const [{ projectId }, { board: boardParam }] = await Promise.all([params, searchParams]);

	let project: { id: string; name: string };
	try {
		project = await api.project.getById({ id: projectId });
	} catch {
		notFound();
	}

	const boardScope = await resolveBoardScope(project.id, boardParam);

	// A1/A2 — fetch boards server-side via the existing `board.list`
	// procedure (no new tRPC). Avoids a client waterfall (the switcher would
	// otherwise flash an empty Popover) and lets the server decide
	// hide-when-≤1. We pluck `{id, name}` from the heavier `BoardListItem`
	// here since the switcher only needs that — over-fetch from the wider
	// payload is negligible against SQLite.
	const boardsFull = await api.board.list({ projectId: project.id });
	const lightBoards = boardsFull.map((b) => ({ id: b.id, name: b.name }));

	return (
		<CostsPage
			projectId={project.id}
			projectName={project.name}
			boardId={boardScope?.boardId}
			boardName={boardScope?.boardName}
			boards={lightBoards}
		/>
	);
}
