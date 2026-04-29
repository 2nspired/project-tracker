import type { Comment } from "prisma/generated/client";
import type { CreateCommentInput } from "@/lib/schemas/comment-schemas";
import { db } from "@/server/db";
import { activityService } from "@/server/services/activity-service";
import type { ServiceResult } from "@/server/services/types/service-result";

async function list(cardId: string): Promise<ServiceResult<Comment[]>> {
	try {
		const comments = await db.comment.findMany({
			where: { cardId },
			orderBy: { createdAt: "asc" },
		});
		return { success: true, data: comments };
	} catch (error) {
		console.error("[COMMENT_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to fetch comments." } };
	}
}

async function create(data: CreateCommentInput): Promise<ServiceResult<Comment>> {
	try {
		const comment = await db.comment.create({
			data: {
				cardId: data.cardId,
				content: data.content,
				authorType: data.authorType,
				authorName: data.authorName,
			},
		});

		await activityService.log({
			cardId: data.cardId,
			action: "commented",
			details: `Added a comment`,
			actorType: data.authorType,
			actorName: data.authorName,
		});

		return { success: true, data: comment };
	} catch (error) {
		console.error("[COMMENT_SERVICE] create error:", error);
		return {
			success: false,
			error: { code: "CREATE_FAILED", message: "Failed to create comment." },
		};
	}
}

export const commentService = {
	list,
	create,
};
