import { db } from "./db.js";
import { detectGitRepo, gitDiffFiles, gitLog, validateRepo } from "./git-utils.js";

export type SyncGitResult =
	| {
			ok: true;
			commitsScanned: number;
			linksCreated: number;
			refsSkipped: number;
			since: string | "all" | undefined;
			autoDetected: boolean;
			repoPath: string;
			errors: string[];
	  }
	| { ok: false; reason: "project_not_found" | "no_repo_path" | "repo_invalid"; message: string };

type SyncOptions = {
	since?: string;
};

/**
 * Shared syncGitActivity logic — scans commits for #N card refs and upserts
 * GitLinks for cards that exist in the project.
 *
 * Used by both the `syncGitActivity` extended tool and the `endSession`
 * essential tool so the latter can link new commits as part of wrap-up
 * without re-implementing the scan.
 */
export async function syncGitActivityForProject(
	projectId: string,
	options: SyncOptions = {}
): Promise<SyncGitResult> {
	const project = await db.project.findUnique({ where: { id: projectId } });
	if (!project) {
		return { ok: false, reason: "project_not_found", message: "Project not found." };
	}

	let repoPath = project.repoPath;
	let autoDetected = false;
	if (!repoPath) {
		const detected = await detectGitRepo();
		if (!detected) {
			return {
				ok: false,
				reason: "no_repo_path",
				message: "No repo path set for this project and cwd is not a git repo.",
			};
		}
		repoPath = detected;
		autoDetected = true;
	}

	const valid = await validateRepo(repoPath);
	if (!valid) {
		return {
			ok: false,
			reason: "repo_invalid",
			message: `Repo path "${repoPath}" is no longer valid.`,
		};
	}

	const isFullHistory = options.since === "all";
	const sinceValue = isFullHistory ? undefined : options.since || "2 weeks ago";
	const maxCount = isFullHistory ? 500 : 100;
	const commits = await gitLog(repoPath, maxCount, sinceValue);

	let linksCreated = 0;
	let refsSkipped = 0;
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
				where: { projectId_number: { projectId, number: cardNum } },
				select: { id: true },
			});
			if (!card) {
				refsSkipped++;
				continue;
			}

			await db.gitLink.upsert({
				where: {
					projectId_commitHash_cardId: {
						projectId,
						commitHash: commit.hash,
						cardId: card.id,
					},
				},
				create: {
					projectId,
					cardId: card.id,
					commitHash: commit.hash,
					message: commit.message,
					author: commit.author,
					commitDate: commit.date,
					filePaths: JSON.stringify(filePaths),
				},
				update: {},
			});
			linksCreated++;
		}
	}

	return {
		ok: true,
		commitsScanned: commits.length,
		linksCreated,
		refsSkipped,
		since: isFullHistory ? "all" : sinceValue,
		autoDetected,
		repoPath,
		errors,
	};
}
