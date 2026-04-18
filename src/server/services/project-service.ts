import type { Project } from "prisma/generated/client";
import type { CreateProjectInput, UpdateProjectInput } from "@/lib/schemas/project-schemas";
import { db } from "@/server/db";
import type { ServiceResult } from "@/server/services/types/service-result";

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

type ProjectListItem = Project & {
	_count: { boards: number; cards: number };
	hasAgentCards: boolean;
};

async function list(): Promise<ServiceResult<ProjectListItem[]>> {
	try {
		const projects = await db.project.findMany({
			orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
			include: {
				_count: { select: { boards: true, cards: true } },
			},
		});

		// Check which projects have agent-created cards
		const projectIds = projects.map((p) => p.id);
		const agentCards = await db.card.groupBy({
			by: ["projectId"],
			where: {
				projectId: { in: projectIds },
				createdBy: "AGENT",
			},
		});
		const agentProjectIds = new Set(agentCards.map((c) => c.projectId));

		const enriched = projects.map((p) => ({
			...p,
			hasAgentCards: agentProjectIds.has(p.id),
		}));

		return { success: true, data: enriched };
	} catch (error) {
		console.error("[PROJECT_SERVICE] list error:", error);
		return { success: false, error: { code: "LIST_FAILED", message: "Failed to fetch projects." } };
	}
}

async function getById(projectId: string): Promise<ServiceResult<Project>> {
	try {
		const project = await db.project.findUnique({ where: { id: projectId } });
		if (!project) {
			return { success: false, error: { code: "NOT_FOUND", message: "Project not found." } };
		}
		return { success: true, data: project };
	} catch (error) {
		console.error("[PROJECT_SERVICE] getById error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch project." } };
	}
}

async function getBySlug(slug: string): Promise<ServiceResult<Project>> {
	try {
		const project = await db.project.findUnique({ where: { slug } });
		if (!project) {
			return { success: false, error: { code: "NOT_FOUND", message: "Project not found." } };
		}
		return { success: true, data: project };
	} catch (error) {
		console.error("[PROJECT_SERVICE] getBySlug error:", error);
		return { success: false, error: { code: "GET_FAILED", message: "Failed to fetch project." } };
	}
}

async function create(data: CreateProjectInput): Promise<ServiceResult<Project>> {
	try {
		let slug = slugify(data.name);
		const existing = await db.project.findUnique({ where: { slug } });
		if (existing) {
			slug = `${slug}-${Date.now().toString(36)}`;
		}

		const project = await db.project.create({
			data: {
				name: data.name,
				description: data.description,
				color: data.color,
				slug,
			},
		});
		return { success: true, data: project };
	} catch (error) {
		console.error("[PROJECT_SERVICE] create error:", error);
		return {
			success: false,
			error: { code: "CREATE_FAILED", message: "Failed to create project." },
		};
	}
}

async function update(
	projectId: string,
	data: UpdateProjectInput
): Promise<ServiceResult<Project>> {
	try {
		const existing = await db.project.findUnique({ where: { id: projectId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Project not found." } };
		}

		if (data.repoPath) {
			const collision = await db.project.findUnique({ where: { repoPath: data.repoPath } });
			if (collision && collision.id !== projectId) {
				return {
					success: false,
					error: {
						code: "REPO_PATH_TAKEN",
						message: `Repo path is already bound to project "${collision.name}".`,
					},
				};
			}
		}

		const project = await db.project.update({
			where: { id: projectId },
			data,
		});
		return { success: true, data: project };
	} catch (error) {
		console.error("[PROJECT_SERVICE] update error:", error);
		return {
			success: false,
			error: { code: "UPDATE_FAILED", message: "Failed to update project." },
		};
	}
}

async function deleteProject(projectId: string): Promise<ServiceResult<Project>> {
	try {
		const existing = await db.project.findUnique({ where: { id: projectId } });
		if (!existing) {
			return { success: false, error: { code: "NOT_FOUND", message: "Project not found." } };
		}

		const project = await db.project.delete({ where: { id: projectId } });
		return { success: true, data: project };
	} catch (error) {
		console.error("[PROJECT_SERVICE] delete error:", error);
		return {
			success: false,
			error: { code: "DELETE_FAILED", message: "Failed to delete project." },
		};
	}
}

export const projectService = {
	list,
	getById,
	getBySlug,
	create,
	update,
	delete: deleteProject,
};
