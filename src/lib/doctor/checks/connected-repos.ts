import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/mcp/db.js";
import type { Check, CheckResult } from "../types.js";

type McpJson = {
	mcpServers?: Record<string, unknown>;
};

export const connectedReposCheck: Check = {
	name: "Connected repos",
	async run(): Promise<CheckResult> {
		const projects = await db.project.findMany({
			where: { repoPath: { not: null } },
			select: { name: true, repoPath: true },
		});

		if (projects.length === 0) {
			return {
				name: this.name,
				status: "skip",
				message: "No projects have a registered repoPath — nothing to check.",
			};
		}

		const issues: string[] = [];
		let okCount = 0;
		let missingFile = 0;

		for (const p of projects) {
			if (!p.repoPath) continue;
			const mcpFile = resolve(p.repoPath, ".mcp.json");
			if (!existsSync(mcpFile)) {
				missingFile++;
				issues.push(`${p.name}: ${mcpFile} missing`);
				continue;
			}

			let parsed: McpJson;
			try {
				parsed = JSON.parse(readFileSync(mcpFile, "utf-8")) as McpJson;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				issues.push(`${p.name}: ${mcpFile} parse error (${msg})`);
				continue;
			}

			const servers = parsed.mcpServers ?? {};
			const hasNew = "pigeon" in servers;
			const hasLegacy = "project-tracker" in servers;

			if (hasNew && !hasLegacy) {
				okCount++;
			} else if (hasNew && hasLegacy) {
				issues.push(`${p.name}: both pigeon and legacy keys present`);
			} else if (hasLegacy) {
				issues.push(`${p.name}: only legacy project-tracker key`);
			} else {
				issues.push(`${p.name}: no pigeon entry`);
			}
		}

		const total = projects.length;

		if (issues.length === 0) {
			return {
				name: this.name,
				status: "pass",
				message: `${okCount}/${total} connected repos use the new key shape.`,
			};
		}

		const status = okCount === 0 ? "fail" : "warn";
		const fix =
			missingFile === issues.length
				? "Run scripts/connect.sh from each affected repo, or remove the project's repoPath if the bind is stale."
				: "npm run migrate-rebrand (idempotent — only writes when the legacy key is present).";

		return {
			name: this.name,
			status,
			message: `${okCount}/${total} repos correct; issues: ${issues.join("; ")}.`,
			fix,
		};
	},
};
