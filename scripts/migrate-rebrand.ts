#!/usr/bin/env -S npx tsx
/**
 * Migration: project-tracker → Pigeon (#108).
 *
 * Run once after pulling v5.0:  `npm run migrate-rebrand`
 *
 * Idempotent — safe to re-run. Two stages:
 *   1. DB updates: tutorial project name, milestone description, card titles/bodies,
 *      best-practices note. Only writes when the legacy string is present.
 *   2. Filesystem updates: every `.mcp.json` found at a registered project's
 *      `repoPath` gets its `mcpServers."project-tracker"` key renamed to
 *      `mcpServers.pigeon`, and any reference to `mcp-start.sh` swapped to
 *      `pigeon-start.sh`. Other server keys are preserved verbatim. A backup
 *      copy is written next to each modified file as `.mcp.json.bak.<ts>`.
 *
 * Then prints a final manual-step checklist (launchd label rename and
 * `~/.claude.json` edit — both deliberately not auto-executed).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../prisma/generated/client";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const TRACKER_ROOT = resolve(SCRIPT_DIR, "..");
const DB_URL = `file:${resolve(TRACKER_ROOT, "data", "tracker.db")}`;
const TUTORIAL_SLUG = "learn-project-tracker";

type Counters = {
	tutorialProjectRenamed: boolean;
	tutorialMilestoneRenamed: boolean;
	cardsUpdated: number;
	notesUpdated: number;
	mcpJsonScanned: number;
	mcpJsonUpdated: number;
	mcpJsonAlreadyMigrated: number;
	mcpJsonMissing: number;
};

function rewriteText(input: string): string {
	return (
		input
			.replace(/Welcome to Project Tracker/g, "Welcome to Pigeon")
			.replace(/Learn Project Tracker/g, "Learn Pigeon")
			.replace(/Project Tracker Best Practices/g, "Pigeon Best Practices")
			.replace(/the basics of Project Tracker/g, "the basics of Pigeon")
			.replace(
				/Cards are the building blocks of Project Tracker/g,
				"Cards are the building blocks of Pigeon — the homing-pigeon metaphor: each card is a piece of context that travels with you between AI sessions"
			)
			.replace(/Project Tracker has more to discover/g, "Pigeon has more to discover")
			// Drive-by content fix: tutorial seed handoff still listed Up Next from
			// pre-v4.0.0. Safe to bundle here — only fires on the legacy string.
			.replace(
				/Board has 5 columns: Backlog, Up Next, In Progress, Done, Parking Lot/g,
				"Board has 4 columns: Backlog, In Progress, Done, Parking Lot"
			)
	);
}

async function migrateTutorialDb(db: PrismaClient, c: Counters) {
	const project = await db.project.findUnique({ where: { slug: TUTORIAL_SLUG } });
	if (!project) {
		console.log("  ✓ No tutorial project on this install — DB stage is a no-op.");
		return;
	}

	if (project.name === "Learn Project Tracker") {
		await db.project.update({
			where: { id: project.id },
			data: { name: "Learn Pigeon" },
		});
		c.tutorialProjectRenamed = true;
	}

	const milestones = await db.milestone.findMany({ where: { projectId: project.id } });
	for (const m of milestones) {
		if (m.description?.includes("Project Tracker")) {
			await db.milestone.update({
				where: { id: m.id },
				data: { description: rewriteText(m.description) },
			});
			c.tutorialMilestoneRenamed = true;
		}
	}

	const cards = await db.card.findMany({ where: { projectId: project.id } });
	for (const card of cards) {
		const newTitle = rewriteText(card.title);
		const newDescription = card.description ? rewriteText(card.description) : card.description;
		if (newTitle !== card.title || newDescription !== card.description) {
			await db.card.update({
				where: { id: card.id },
				data: { title: newTitle, description: newDescription },
			});
			c.cardsUpdated++;
		}
	}

	const notes = await db.note.findMany({ where: { projectId: project.id } });
	for (const note of notes) {
		const newTitle = rewriteText(note.title);
		const newContent = rewriteText(note.content);
		if (newTitle !== note.title || newContent !== note.content) {
			await db.note.update({
				where: { id: note.id },
				data: { title: newTitle, content: newContent },
			});
			c.notesUpdated++;
		}
	}
}

type McpJsonRoot = {
	mcpServers?: Record<string, unknown>;
	[k: string]: unknown;
};

function rewriteMcpJson(parsed: McpJsonRoot): { changed: boolean; alreadyMigrated: boolean } {
	const servers = parsed.mcpServers;
	if (!servers || typeof servers !== "object") {
		return { changed: false, alreadyMigrated: false };
	}

	const hasLegacyKey = "project-tracker" in servers;
	const hasNewKey = "pigeon" in servers;

	if (!hasLegacyKey && hasNewKey) {
		return { changed: false, alreadyMigrated: true };
	}
	if (!hasLegacyKey) {
		return { changed: false, alreadyMigrated: false };
	}

	const legacyEntry = servers["project-tracker"];

	// Preserve insertion order: rebuild servers without the legacy key, then
	// re-insert under the new key (skip if already present so we don't clobber).
	const next: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(servers)) {
		if (k === "project-tracker") continue;
		next[k] = v;
	}
	if (!hasNewKey) {
		next.pigeon = swapStartScript(legacyEntry);
	}
	parsed.mcpServers = next;
	return { changed: true, alreadyMigrated: false };
}

function swapStartScript(entry: unknown): unknown {
	if (!entry || typeof entry !== "object") return entry;
	const obj = entry as Record<string, unknown>;
	if (typeof obj.command === "string" && obj.command.endsWith("/scripts/mcp-start.sh")) {
		return {
			...obj,
			command: obj.command.replace(/\/scripts\/mcp-start\.sh$/, "/scripts/pigeon-start.sh"),
		};
	}
	return obj;
}

async function migrateMcpJsonFiles(db: PrismaClient, c: Counters) {
	const projects = await db.project.findMany({
		where: { repoPath: { not: null } },
		select: { id: true, name: true, repoPath: true },
	});

	for (const p of projects) {
		if (!p.repoPath) continue;
		const mcpFile = resolve(p.repoPath, ".mcp.json");
		c.mcpJsonScanned++;

		if (!existsSync(mcpFile)) {
			c.mcpJsonMissing++;
			continue;
		}

		const original = readFileSync(mcpFile, "utf-8");
		let parsed: McpJsonRoot;
		try {
			parsed = JSON.parse(original);
		} catch (err) {
			console.log(`  ✗ ${p.name}: ${mcpFile} — parse error, skipping (${(err as Error).message})`);
			continue;
		}

		const { changed, alreadyMigrated } = rewriteMcpJson(parsed);
		if (alreadyMigrated) {
			c.mcpJsonAlreadyMigrated++;
			continue;
		}
		if (!changed) continue;

		const stamp = Date.now();
		const backupPath = `${mcpFile}.bak.${stamp}`;
		try {
			writeFileSync(backupPath, original, { flag: "wx" });
		} catch (err) {
			console.log(
				`  ✗ ${p.name}: refusing to clobber existing backup at ${backupPath} (${(err as Error).message}); skipping rewrite.`
			);
			continue;
		}
		writeFileSync(mcpFile, `${JSON.stringify(parsed, null, 2)}\n`);
		console.log(`  ✓ ${p.name}: rewrote ${mcpFile} (backup at ${backupPath})`);
		c.mcpJsonUpdated++;
	}
}

function printChecklist(c: Counters) {
	console.log("");
	console.log("┌─────────────────────────────────────────────────────────────────┐");
	console.log("│           Manual steps the script did NOT auto-run              │");
	console.log("└─────────────────────────────────────────────────────────────────┘");
	console.log("");
	console.log("1. launchd label rename (com.2nspired.project-tracker → com.2nspired.pigeon)");
	console.log("   `service:uninstall` no longer recognizes the old label, so it can't stop");
	console.log("   the legacy service for you. Run the explicit bootout first, then install:");
	console.log("");
	console.log(`     launchctl bootout gui/$(id -u)/com.2nspired.project-tracker || true`);
	console.log("     rm -f ~/Library/LaunchAgents/com.2nspired.project-tracker.plist");
	console.log("     npm run service:install");
	console.log("");
	console.log("   Old logs at ~/Library/Logs/project-tracker/ can be deleted by hand once");
	console.log("   you confirm Pigeon is running on http://localhost:3100.");
	console.log("");
	console.log("2. Claude Code config (~/.claude.json or ~/.claude-alt/.claude.json)");
	console.log("   The script does NOT auto-edit your Claude Code config (lives outside");
	console.log("   the repo). Open it and rename:");
	console.log("");
	console.log("     mcpServers.project-tracker  →  mcpServers.pigeon");
	console.log("     scripts/mcp-start.sh        →  scripts/pigeon-start.sh");
	console.log("");
	console.log("   The legacy key still works during v5.x with a deprecation warning,");
	console.log("   so this can be done at your pace before v6.0.");
	console.log("");
	console.log("3. Restart any active MCP-connected agents.");
	console.log("   They cache the server manifest and will keep showing the old brand");
	console.log("   until they reconnect to the renamed server.");
	console.log("");
	if (c.mcpJsonScanned === 0) {
		console.log("Note: no projects with a registered repoPath were found, so no .mcp.json");
		console.log("files were scanned. If you connect projects later, scripts/connect.sh writes");
		console.log("the new key shape automatically.");
		console.log("");
	}
}

async function main() {
	const adapter = new PrismaBetterSqlite3({ url: DB_URL });
	const db = new PrismaClient({ adapter, log: ["error"] });

	const c: Counters = {
		tutorialProjectRenamed: false,
		tutorialMilestoneRenamed: false,
		cardsUpdated: 0,
		notesUpdated: 0,
		mcpJsonScanned: 0,
		mcpJsonUpdated: 0,
		mcpJsonAlreadyMigrated: 0,
		mcpJsonMissing: 0,
	};

	console.log("");
	console.log("Pigeon rebrand migration (#108)");
	console.log("───────────────────────────────");
	console.log("");

	try {
		console.log("Step 1 — DB rewrites (tutorial project content)");
		await migrateTutorialDb(db, c);
		console.log(
			`  Renamed: project=${c.tutorialProjectRenamed ? "yes" : "skip"}, milestone=${c.tutorialMilestoneRenamed ? "yes" : "skip"}, cards updated=${c.cardsUpdated}, notes updated=${c.notesUpdated}.`
		);
		console.log("");

		console.log("Step 2 — .mcp.json rewrites (connected project repos)");
		await migrateMcpJsonFiles(db, c);
		console.log(
			`  Scanned ${c.mcpJsonScanned} project(s): updated=${c.mcpJsonUpdated}, already migrated=${c.mcpJsonAlreadyMigrated}, no .mcp.json=${c.mcpJsonMissing}.`
		);
	} finally {
		await db.$disconnect();
	}

	printChecklist(c);
	console.log("Done. Run `npm run service:update` after step 1 above to pick up the new build.");
	console.log("");
}

main().catch((error) => {
	console.error("Migration failed:", error);
	process.exit(1);
});
