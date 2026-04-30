#!/usr/bin/env -S npx tsx
/**
 * Register a repo path with Pigeon so briefMe can auto-detect the
 * project from the current working directory.
 *
 * Usage:
 *   npx tsx scripts/register-repo.ts <repo-path> [project-name]
 *
 * Behavior:
 *   - If a project already has this repoPath, prints its info and exits.
 *   - Otherwise creates a new project (with a default board) bound to the path.
 */

import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../prisma/generated/client";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const TRACKER_ROOT = resolve(SCRIPT_DIR, "..");
const DB_URL = `file:${resolve(TRACKER_ROOT, "data", "tracker.db")}`;

const repoArg = process.argv[2];
const nameArg = process.argv[3];

if (!repoArg) {
	console.error("Usage: register-repo.ts <repo-path> [project-name]");
	process.exit(1);
}

const repoPath = realpathSync(resolve(repoArg));
const projectName = nameArg?.trim() || basename(repoPath);

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

async function main() {
	const adapter = new PrismaBetterSqlite3({ url: DB_URL });
	const db = new PrismaClient({ adapter, log: ["error"] });

	try {
		const existing = await db.project.findUnique({
			where: { repoPath },
			select: { id: true, name: true, slug: true, defaultBoardId: true, boards: { select: { id: true, name: true } } },
		});

		if (existing) {
			console.log(`✓ Already registered: "${existing.name}" (slug: ${existing.slug})`);
			const boards = existing.boards.length;
			if (boards > 0) {
				const defaultBoardId = existing.defaultBoardId;
				const defaultBoard = defaultBoardId
					? existing.boards.find((b: { id: string; name: string }) => b.id === defaultBoardId)
					: existing.boards[0];
				console.log(`  Default board: ${defaultBoard?.name ?? existing.boards[0]?.name} (${boards} total)`);
			}
			return;
		}

		let slug = slugify(projectName);
		const slugTaken = await db.project.findUnique({ where: { slug } });
		if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

		const project = await db.project.create({
			data: {
				name: projectName,
				slug,
				repoPath,
				boards: {
					create: {
						name: "Main",
						columns: {
							create: [
								{ name: "Backlog", position: 0, role: "backlog" },
								{ name: "In Progress", position: 1, role: "active" },
								{ name: "Done", position: 2, role: "done" },
								{ name: "Parking Lot", position: 3, role: "parking", isParking: true },
							],
						},
					},
				},
			},
			include: { boards: true },
		});

		const mainBoard = project.boards[0];
		if (mainBoard) {
			await db.project.update({
				where: { id: project.id },
				data: { defaultBoardId: mainBoard.id },
			});
		}

		console.log(`✓ Registered project "${project.name}" (slug: ${project.slug})`);
		console.log(`  Repo: ${repoPath}`);
		if (mainBoard) console.log(`  Default board: ${mainBoard.name}`);
	} finally {
		await db.$disconnect();
	}
}

main().catch((err) => {
	console.error("✗ Failed to register repo:", err instanceof Error ? err.message : err);
	process.exit(1);
});
