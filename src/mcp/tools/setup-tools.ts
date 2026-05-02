import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, safeExecute } from "../utils.js";

registerExtendedTool("createProject", {
	category: "setup",
	description:
		"Create a project with default board and columns (Backlog, In Progress, Done, Parking Lot).",
	parameters: z.object({
		name: z.string(),
		description: z.string().optional(),
		boardName: z.string().default("Main Board"),
	}),
	handler: ({ name, description, boardName }) =>
		safeExecute(async () => {
			let slug = (name as string)
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "");
			const existing = await db.project.findUnique({ where: { slug } });
			if (existing) slug = `${slug}-${Date.now().toString(36)}`;

			const project = await db.project.create({
				data: {
					name: name as string,
					description: description as string | undefined,
					slug,
					boards: {
						create: {
							name: boardName as string,
							columns: {
								create: [
									{
										name: "Backlog",
										description:
											"Known work. Drag the most important to the top — top 3 surface as 'pinned' in briefMe.",
										position: 0,
										role: "backlog",
									},
									{
										name: "In Progress",
										description: "This is actively being worked on",
										position: 1,
										role: "active",
									},
									{
										name: "Done",
										description: "This has been completed",
										position: 2,
										role: "done",
									},
									{
										name: "Parking Lot",
										description: "Ideas and items to revisit later",
										position: 3,
										role: "parking",
										isParking: true,
									},
								],
							},
						},
					},
				},
				include: { boards: true },
			});

			return ok({
				projectId: project.id,
				projectName: project.name,
				slug: project.slug,
				boardId: project.boards[0].id,
				boardName: project.boards[0].name,
			});
		}),
});

registerExtendedTool("createColumn", {
	category: "setup",
	description: "Add a custom column. Standard columns are created by createProject.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		name: z.string(),
		description: z.string().optional(),
	}),
	handler: ({ boardId, name, description }) =>
		safeExecute(async () => {
			const maxPos = await db.column.aggregate({
				where: { boardId: boardId as string },
				_max: { position: true },
			});
			const column = await db.column.create({
				data: {
					boardId: boardId as string,
					name: name as string,
					description: description as string | undefined,
					position: (maxPos._max.position ?? -1) + 1,
				},
			});
			return ok({ id: column.id, name: column.name });
		}),
});
