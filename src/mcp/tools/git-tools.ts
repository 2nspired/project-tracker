import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { resolveCardRef, ok, err, errWithToolHint, safeExecute } from "../utils.js";
import { validateRepo, detectGitRepo, gitLog, gitDiffFiles } from "../git-utils.js";

// ─── Git ──────────────────────────────────────────────────────────

registerExtendedTool("setRepoPath", {
	category: "setup",
	description: "Set the local git repository path for a project.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		repoPath: z.string().min(1).describe("Absolute path to local git repo"),
	}),
	handler: ({ projectId, repoPath }) => safeExecute(async () => {
		const valid = await validateRepo(repoPath as string);
		if (!valid) return err(`"${repoPath}" is not a valid git repository.`, "Provide an absolute path to a directory containing a .git folder.");

		const project = await db.project.findUnique({ where: { id: projectId as string } });
		if (!project) return errWithToolHint("Project not found.", "listProjects", {});

		await db.project.update({
			where: { id: projectId as string },
			data: { repoPath: repoPath as string },
		});

		return ok({ projectId, repoPath, saved: true });
	}),
});

registerExtendedTool("syncGitActivity", {
	category: "git",
	description: "Scan git commits for #N card refs and create links.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		since: z.string().optional().describe("ISO datetime, git date string like '2 weeks ago', or 'all' for full history"),
	}),
	handler: ({ projectId, since }) => safeExecute(async () => {
		const project = await db.project.findUnique({ where: { id: projectId as string } });
		if (!project) return errWithToolHint("Project not found.", "listProjects", {});

		let repoPath = project.repoPath;
		let autoDetected = false;
		if (!repoPath) {
			const detected = await detectGitRepo();
			if (detected) {
				repoPath = detected;
				autoDetected = true;
			} else {
				return errWithToolHint("No repo path set for this project.", "setRepoPath", { projectId: `"${projectId}"`, repoPath: '"/path/to/repo"' });
			}
		}

		const valid = await validateRepo(repoPath);
		if (!valid) return errWithToolHint(`Repo path "${repoPath}" is no longer valid.`, "setRepoPath", { projectId: `"${projectId}"`, repoPath: '"/path/to/repo"' });

		const isFullHistory = (since as string) === "all";
		const sinceValue = isFullHistory ? undefined : ((since as string) || "2 weeks ago");
		const maxCount = isFullHistory ? 500 : 100;
		const commits = await gitLog(repoPath, maxCount, sinceValue);

		let linked = 0;
		let skipped = 0;
		const errors: string[] = [];

		for (const commit of commits) {
			if (commit.cardRefs.length === 0) continue;

			let filePaths: string[];
			try {
				filePaths = await gitDiffFiles(repoPath, commit.hash);
			} catch {
				errors.push(`Failed to get files for ${commit.hash.slice(0, 7)}`);
				filePaths = [];
			}

			for (const cardNum of commit.cardRefs) {
				const card = await db.card.findUnique({
					where: { projectId_number: { projectId: projectId as string, number: cardNum } },
					select: { id: true },
				});
				if (!card) {
					skipped++;
					continue;
				}

				await db.gitLink.upsert({
					where: {
						projectId_commitHash_cardId: {
							projectId: projectId as string,
							commitHash: commit.hash,
							cardId: card.id,
						},
					},
					create: {
						projectId: projectId as string,
						cardId: card.id,
						commitHash: commit.hash,
						message: commit.message,
						author: commit.author,
						commitDate: commit.date,
						filePaths: JSON.stringify(filePaths),
					},
					update: {},
				});
				linked++;
			}
		}

		return ok({
			commitsScanned: commits.length,
			linksCreated: linked,
			refsSkipped: skipped,
			since: isFullHistory ? "all" : sinceValue,
			...(autoDetected && { _note: `Auto-detected repo at "${repoPath}". Run setRepoPath to persist this.` }),
			errors: errors.length > 0 ? errors : undefined,
		});
	}),
});

registerExtendedTool("getGitLog", {
	category: "git",
	description: "Recent git commits with detected card references.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
		limit: z.number().int().min(1).max(100).default(20).describe("Max commits (1–100)"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId, limit }) => safeExecute(async () => {
		const project = await db.project.findUnique({ where: { id: projectId as string } });
		if (!project) return errWithToolHint("Project not found.", "listProjects", {});

		let repoPath = project.repoPath;
		if (!repoPath) {
			const detected = await detectGitRepo();
			if (detected) {
				repoPath = detected;
			} else {
				return errWithToolHint("No repo path set for this project.", "setRepoPath", { projectId: `"${projectId}"`, repoPath: '"/path/to/repo"' });
			}
		}

		const valid = await validateRepo(repoPath);
		if (!valid) return errWithToolHint(`Repo path "${repoPath}" is no longer valid.`, "setRepoPath", { projectId: `"${projectId}"`, repoPath: '"/path/to/repo"' });

		const commits = await gitLog(repoPath, (limit as number) ?? 20);

		return ok(commits.map((c) => ({
			hash: c.hash.slice(0, 7),
			fullHash: c.hash,
			message: c.message,
			author: c.author,
			date: c.date,
			cardRefs: c.cardRefs.map((n) => `#${n}`),
		})));
	}),
});

registerExtendedTool("getCodeMap", {
	category: "git",
	description: "Files touched by all commits linked to a card.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ cardId }) => safeExecute(async () => {
		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;

		const links = await db.gitLink.findMany({
			where: { cardId: id },
			orderBy: { commitDate: "desc" },
		});

		if (links.length === 0) {
			return ok({ cardId: id, files: [], commitCount: 0, message: "No git links found for this card." });
		}

		const fileSet = new Set<string>();
		for (const link of links) {
			const paths = JSON.parse(link.filePaths) as string[];
			for (const p of paths) fileSet.add(p);
		}

		return ok({
			cardId: id,
			files: Array.from(fileSet).sort(),
			commitCount: links.length,
		});
	}),
});

registerExtendedTool("getCardCommits", {
	category: "git",
	description: "All git commits linked to a card.",
	parameters: z.object({
		cardId: z.string().describe("Card UUID or #number"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ cardId }) => safeExecute(async () => {
		const resolved = await resolveCardRef(cardId as string);
		if (!resolved.ok) return err(resolved.message);
		const id = resolved.id;

		const links = await db.gitLink.findMany({
			where: { cardId: id },
			orderBy: { commitDate: "desc" },
		});

		return ok(links.map((l) => ({
			hash: l.commitHash.slice(0, 7),
			fullHash: l.commitHash,
			message: l.message,
			author: l.author,
			date: l.commitDate,
			filePaths: JSON.parse(l.filePaths) as string[],
		})));
	}),
});
