import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export type GitCommit = {
	hash: string;
	message: string;
	author: string;
	date: Date;
	cardRefs: number[]; // extracted #N references
};

const EXEC_OPTS = { timeout: 5000, maxBuffer: 1024 * 1024 };

export async function validateRepo(repoPath: string): Promise<boolean> {
	try {
		await access(join(repoPath, ".git"));
		return true;
	} catch {
		return false;
	}
}

export async function gitLog(repoPath: string, limit: number, since?: string): Promise<GitCommit[]> {
	const args = ["log", `--max-count=${limit}`, "--format=%H%x00%s%x00%an%x00%aI", "--no-merges"];
	if (since) args.push(`--since=${since}`);
	const { stdout } = await execFileAsync("git", args, {
		...EXEC_OPTS,
		cwd: repoPath,
	});
	return stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [hash, message, author, dateStr] = line.split("\0");
			return { hash, message, author, date: new Date(dateStr), cardRefs: parseCardRefs(message) };
		});
}

export async function gitDiffFiles(repoPath: string, hash: string): Promise<string[]> {
	const { stdout } = await execFileAsync("git", ["diff-tree", "--no-commit-id", "-r", "--name-only", hash], {
		...EXEC_OPTS,
		cwd: repoPath,
	});
	return stdout.trim().split("\n").filter(Boolean);
}

export function parseCardRefs(message: string): number[] {
	const matches = message.match(/#(\d+)/g);
	if (!matches) return [];
	return [...new Set(matches.map((m) => parseInt(m.slice(1), 10)))];
}
