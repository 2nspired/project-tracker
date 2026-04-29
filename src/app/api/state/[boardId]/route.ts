import { buildApiStateForBoard } from "@/server/services/api-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ boardId: string }> }) {
	const { boardId } = await ctx.params;
	const state = await buildApiStateForBoard(boardId);
	if (!state) {
		return Response.json(
			{ error: "Board not found", boardId },
			{ status: 404, headers: { "Cache-Control": "no-store" } }
		);
	}
	return Response.json(state, {
		headers: { "Cache-Control": "no-store" },
	});
}
