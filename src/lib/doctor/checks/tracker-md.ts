import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/mcp/db.js";
import type { Check, CheckResult } from "../types.js";

export const trackerMdCheck: Check = {
	name: "Per-project tracker.md",
	async run(): Promise<CheckResult> {
		const projects = await db.project.findMany({
			where: { repoPath: { not: null } },
			select: { name: true, repoPath: true },
		});

		if (projects.length === 0) {
			return {
				name: this.name,
				status: "skip",
				message: "No projects with a registered repoPath — nothing to check.",
			};
		}

		const issues: string[] = [];
		let okCount = 0;

		for (const p of projects) {
			if (!p.repoPath) continue;
			const trackerPath = resolve(p.repoPath, "tracker.md");
			if (!existsSync(trackerPath)) {
				issues.push(`${p.name}: ${trackerPath} missing`);
				continue;
			}

			let content: string;
			try {
				content = readFileSync(trackerPath, "utf-8");
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				issues.push(`${p.name}: ${trackerPath} unreadable (${msg})`);
				continue;
			}

			if (content.trim().length === 0) {
				issues.push(`${p.name}: tracker.md is empty`);
				continue;
			}

			okCount++;
		}

		if (issues.length === 0) {
			return {
				name: this.name,
				status: "pass",
				message: `${okCount}/${projects.length} projects have a non-empty tracker.md.`,
			};
		}

		return {
			name: this.name,
			status: okCount === 0 ? "fail" : "warn",
			message: `${okCount}/${projects.length} projects OK; ${issues.join("; ")}.`,
			fix: "Create tracker.md at the repo root with a project orientation block (see docs/SURFACES.md for the shape).",
		};
	},
};
