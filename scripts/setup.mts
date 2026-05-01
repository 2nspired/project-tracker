/**
 * Interactive setup wizard for Pigeon.
 * Guides the user through database creation, tutorial project seeding,
 * and connecting an external project to the MCP server.
 *
 * No extra dependencies — uses Node's built-in readline.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const DB_PATH = resolve("data", "tracker.db");
const TRACKER_ROOT = resolve(import.meta.dirname, "..");

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, fallback = ""): Promise<string> {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			resolve(answer.trim() || fallback);
		});
	});
}

async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
	const hint = defaultYes ? "Y/n" : "y/N";
	const answer = await ask(`${question} (${hint}) `);
	if (!answer) return defaultYes;
	return answer.toLowerCase().startsWith("y");
}

async function main() {
	console.log("");
	console.log("┌─────────────────────────────────────────┐");
	console.log("│            Pigeon — Setup               │");
	console.log("└─────────────────────────────────────────┘");
	console.log("");

	// ─── Step 1: Database ─────────────────────────────────────────────

	console.log("Step 1: Database");

	if (existsSync(DB_PATH)) {
		console.log("  ✓ SQLite database already exists.");
	} else {
		console.log("  Creating SQLite database...");
		execSync("npx prisma db push", { stdio: "inherit" });
		console.log("  ✓ Database created.");
	}
	console.log("");

	// ─── Step 2: Tutorial Project ─────────────────────────────────────

	console.log("Step 2: Tutorial Project");

	const { seedTutorialProject } = await import("../src/lib/onboarding/seed-runner.js");

	// Need to create a PrismaClient for the seed runner
	const { PrismaClient } = await import("prisma/generated/client");
	const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");

	const adapter = new PrismaBetterSqlite3({ url: "file:./data/tracker.db" });
	const db = new PrismaClient({ adapter });

	// Check if tutorial already exists
	const existingTutorial = await db.project.findUnique({
		where: { slug: "learn-project-tracker" },
	});

	if (existingTutorial) {
		console.log("  ✓ Tutorial project already exists.");
	} else {
		const wantTutorial = await askYesNo("  Create a tutorial project with sample cards?");
		if (wantTutorial) {
			const result = await seedTutorialProject(db);
			if (result) {
				console.log("  ✓ Tutorial project created.");
				console.log(`    Board ID: ${result.boardId}`);
			}
		} else {
			console.log("  Skipped.");
		}
	}
	console.log("");

	// ─── Step 3: Connect a Project ────────────────────────────────────

	console.log("Step 3: Connect a Project");
	console.log("  Link an external project so its AI agents can use Pigeon via MCP.");

	const projectPath = await ask("  Path to your project (or press Enter to skip): ");

	if (projectPath) {
		const targetDir = resolve(projectPath);

		if (!existsSync(targetDir)) {
			console.log(`  ✗ Directory not found: ${targetDir}`);
		} else if (targetDir === TRACKER_ROOT) {
			console.log(
				"  ✗ That's the Pigeon directory itself. Run this from a different project."
			);
		} else {
			const mcpFile = resolve(targetDir, ".mcp.json");
			const pigeonStartScript = resolve(TRACKER_ROOT, "scripts", "pigeon-start.sh");

			if (existsSync(mcpFile)) {
				const content = readFileSync(mcpFile, "utf-8");
				if (content.includes('"pigeon"') || content.includes('"project-tracker"')) {
					console.log("  ✓ Pigeon already configured in .mcp.json");
				} else {
					console.log("  .mcp.json already exists with other servers.");
					console.log("  Add this to the mcpServers object in .mcp.json:");
					console.log("");
					console.log('    "pigeon": {');
					console.log(`      "command": "${pigeonStartScript}",`);
					console.log('      "args": []');
					console.log("    }");
				}
			} else {
				const agentName = await ask("  Agent name (default: Claude): ", "Claude");
				const config = {
					mcpServers: {
						pigeon: {
							command: pigeonStartScript,
							args: [],
							env: { AGENT_NAME: agentName },
						},
					},
				};
				writeFileSync(mcpFile, `${JSON.stringify(config, null, 2)}\n`);
				console.log(`  ✓ Created ${mcpFile}`);
				console.log(`    Agent name: ${agentName}`);
			}
		}
	} else {
		console.log("  Skipped. You can connect projects later with:");
		console.log(`    ${TRACKER_ROOT}/scripts/connect.sh /path/to/your-project`);
	}
	console.log("");

	// ─── Done ─────────────────────────────────────────────────────────

	console.log("┌──────────────────────────────────────────────────────┐");
	console.log("│  ✓ Setup complete!                                   │");
	console.log("│                                                      │");
	console.log("│  Run it now (foreground):                            │");
	console.log("│    npm run dev          → http://localhost:3000      │");
	console.log("│                                                      │");
	console.log("│  Run it always (macOS launchd background service):   │");
	console.log("│    npm run service:install                           │");
	console.log("│                         → http://localhost:3100      │");
	console.log("│    npm run service:status                            │");
	console.log("│    npm run service:logs                              │");
	console.log("└──────────────────────────────────────────────────────┘");
	console.log("");

	await db.$disconnect();
	rl.close();
}

main().catch((err) => {
	console.error(err);
	rl.close();
	process.exit(1);
});
