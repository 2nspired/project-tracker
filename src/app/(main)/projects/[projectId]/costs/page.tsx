import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CostsPage } from "@/components/costs/costs-page";
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

export async function generateMetadata(): Promise<Metadata> {
	return { title: "Costs" };
}

export default async function CostsRoute({ params }: { params: Promise<{ projectId: string }> }) {
	const { projectId } = await params;

	try {
		const project = await api.project.getById({ id: projectId });
		return <CostsPage projectId={project.id} projectName={project.name} />;
	} catch {
		notFound();
	}
}
