import { buildApiState } from "@/server/services/api-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const state = await buildApiState();
	return Response.json(state, {
		headers: { "Cache-Control": "no-store" },
	});
}
