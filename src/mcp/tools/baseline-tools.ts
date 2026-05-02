// Baseline measurement MCP tools (#192 F3).
//
// `recalibrateBaseline` measures the token cost of briefMe vs. a naive
// "load the full board" bootstrap and persists the result on
// Project.metadata.tokenBaseline. Drives the "Pigeon paid for itself"
// surface in the UI without hard-coding a marketing number.

import { z } from "zod";
import { createTokenUsageService } from "@/lib/services/token-usage";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

// Bind the shared factory to the MCP-process Prisma client. Constructed
// once at module load (singleton) — same shape as the web shim, but
// scoped to the MCP db so cross-process callers don't share the
// Next.js-FTS-extended instance.
const tokenUsageService = createTokenUsageService(db);

registerExtendedTool("recalibrateBaseline", {
	category: "session",
	description:
		"Measure briefMe vs. naive-bootstrap payload sizes for this project and store on Project.metadata.tokenBaseline. Used by the 'Pigeon paid for itself' surface. Pass projectId, or boardId — boardId resolves to its project. Returns { briefMeTokens, naiveBootstrapTokens, latestHandoffTokens?, savings, savingsPct, measuredAt }.",
	parameters: z.object({
		projectId: z.string().uuid().optional().describe("Project UUID (omit if boardId is set)"),
		boardId: z
			.string()
			.uuid()
			.optional()
			.describe("Board UUID — resolves to projectId; convenience for board-scoped agents"),
	}),
	handler: async (params) => {
		const p = params as { projectId?: string; boardId?: string };
		return safeExecute(async () => {
			let projectId = p.projectId;
			if (!projectId && p.boardId) {
				const board = await db.board.findUnique({
					where: { id: p.boardId },
					select: { projectId: true },
				});
				if (!board) {
					return err("Board not found.", "Pass a registered boardId, or pass projectId directly.");
				}
				projectId = board.projectId;
			}
			if (!projectId) {
				return err(
					"projectId or boardId required.",
					"Pass one of them — boardId resolves automatically."
				);
			}

			const result = await tokenUsageService.recalibrateBaseline(projectId);
			if (!result.success) {
				return err(result.error.message, `code=${result.error.code}`);
			}
			return ok(result.data);
		});
	},
});
