/**
 * Service management for Pigeon via macOS launchd.
 *
 * Runs the production Next.js build as a persistent background service
 * so the board is always available at http://localhost:3100 without
 * manually starting a dev server.
 *
 * Usage: tsx scripts/service.ts <command>
 *
 * Commands:
 *   install   — Build the project and register the launchd service
 *   uninstall — Stop the service and remove it from launchd
 *   start     — Start the service (must be installed first)
 *   stop      — Stop the service
 *   disable   — Stop and prevent auto-start on login
 *   enable    — Re-enable auto-start on login
 *   status    — Check if the service is running
 *   logs      — Tail stdout and stderr logs
 *   update    — Rebuild the project and restart the service
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backupDatabase, formatBytes, pruneBackups } from "@/lib/db-backup.js";
import { runDoctor } from "@/lib/doctor/index.js";
import { writeUpgradeReport } from "@/lib/upgrade-report.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_LABEL = "com.2nspired.pigeon";
const PORT = 3100;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const HOME = homedir();
const PLIST_PATH = resolve(HOME, "Library/LaunchAgents", `${SERVICE_LABEL}.plist`);
const LOG_DIR = resolve(HOME, "Library/Logs/pigeon");
const NODE_PATH = process.execPath;
const NODE_BIN_DIR = dirname(NODE_PATH);
const NEXT_BIN = resolve(PROJECT_DIR, "node_modules/next/dist/bin/next");

const UID = execSync("id -u", { encoding: "utf-8" }).trim();
const GUI_TARGET = `gui/${UID}`;
const SERVICE_TARGET = `${GUI_TARGET}/${SERVICE_LABEL}`;

// ---------------------------------------------------------------------------
// Plist generation
// ---------------------------------------------------------------------------

function generatePlist(runAtLoad = true): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${SERVICE_LABEL}</string>

	<key>ProgramArguments</key>
	<array>
		<string>${NODE_PATH}</string>
		<string>${NEXT_BIN}</string>
		<string>start</string>
		<string>-H</string>
		<string>127.0.0.1</string>
		<string>-p</string>
		<string>${PORT}</string>
	</array>

	<key>WorkingDirectory</key>
	<string>${PROJECT_DIR}</string>

	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin</string>
		<key>NODE_ENV</key>
		<string>production</string>
	</dict>

	<key>RunAtLoad</key>
	<${runAtLoad}/>

	<key>KeepAlive</key>
	<${runAtLoad}/>

	<key>StandardOutPath</key>
	<string>${LOG_DIR}/stdout.log</string>

	<key>StandardErrorPath</key>
	<string>${LOG_DIR}/stderr.log</string>

	<key>ThrottleInterval</key>
	<integer>10</integer>
</dict>
</plist>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLoaded(): boolean {
	try {
		execSync(`launchctl print ${SERVICE_TARGET}`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

function isAutoStartEnabled(): boolean {
	if (!existsSync(PLIST_PATH)) return false;
	const content = readFileSync(PLIST_PATH, "utf-8");
	return content.includes("<key>RunAtLoad</key>\n\t<true/>");
}

function ensureDeps() {
	console.log("Syncing dependencies...\n");
	execSync("npm install --no-audit --no-fund", { cwd: PROJECT_DIR, stdio: "inherit" });
	console.log("");
}

// FTS5 virtual + shadow tables created at runtime by `initFts5` in
// `src/server/db.ts`. They live outside Prisma's schema view, so under
// Prisma 7 `prisma db push` flags every one of them as drift and refuses
// to push without `--accept-data-loss`. Dropping them pre-push is safe:
// the index is derived state over Note/Claim/Card/Comment/markdown, and
// `initFts5` recreates the empty virtual table on the next service start.
// `queryKnowledge` lazy-rebuilds per project on the first search after.
const FTS_TABLES = [
	"knowledge_fts",
	"knowledge_fts_data",
	"knowledge_fts_idx",
	"knowledge_fts_content",
	"knowledge_fts_docsize",
	"knowledge_fts_config",
];

function dropDerivedFtsTables() {
	const dbPath = resolve(PROJECT_DIR, "data", "tracker.db");
	if (!existsSync(dbPath)) return;
	const sql = FTS_TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ");
	try {
		execSync("npx prisma db execute --stdin", {
			cwd: PROJECT_DIR,
			input: sql,
			stdio: ["pipe", "pipe", "inherit"],
		});
	} catch {
		// Non-fatal: the worst case is `prisma db push` will then ask for
		// --accept-data-loss with a clear pointer in the error path below.
		console.warn("[service:update] FTS5 cleanup raised an error; continuing.");
	}
}

function ensureSchema() {
	console.log("Syncing database schema...\n");
	dropDerivedFtsTables();
	try {
		execSync("npx prisma db push", { cwd: PROJECT_DIR, stdio: "inherit" });
	} catch {
		console.error(
			"\nSchema sync failed. If the change is destructive (column rename, type narrow, drop), run `npx prisma db push` manually so Prisma can confirm the data-loss prompt.\n",
		);
		throw new Error("prisma db push failed");
	}
	console.log("");
}

function ensureBuild() {
	ensureDeps();
	ensureSchema();
	console.log("Building project...\n");
	execSync("npm run build", { cwd: PROJECT_DIR, stdio: "inherit" });
	console.log("");
}

function writePlist() {
	mkdirSync(LOG_DIR, { recursive: true });
	writeFileSync(PLIST_PATH, generatePlist());
}

function bootout() {
	try {
		execSync(`launchctl bootout ${SERVICE_TARGET}`, { stdio: "pipe" });
	} catch {
		// Already unloaded — that's fine
	}
	// launchd needs time to fully release the service after bootout
	for (let i = 0; i < 10; i++) {
		if (!isLoaded()) return;
		execSync("sleep 0.5");
	}
}

function bootstrap() {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			execSync(`launchctl bootstrap ${GUI_TARGET} ${PLIST_PATH}`, { stdio: "pipe" });
			return;
		} catch {
			if (attempt < 2) execSync("sleep 1");
		}
	}
	// All three attempts failed — make one final call without stdio:"pipe" so
	// launchctl's error surfaces, then let it throw rather than recursing forever.
	execSync(`launchctl bootstrap ${GUI_TARGET} ${PLIST_PATH}`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function install() {
	ensureBuild();
	writePlist();

	if (isLoaded()) {
		bootout();
	}

	bootstrap();
	console.log(`Plist written to:\n  ${PLIST_PATH}\n`);
	console.log(`Logs directory:\n  ${LOG_DIR}/\n`);
	console.log(`Service installed and running at http://localhost:${PORT}`);
}

function uninstall() {
	if (isLoaded()) {
		bootout();
		console.log("Service stopped.");
	}
	if (existsSync(PLIST_PATH)) {
		unlinkSync(PLIST_PATH);
		console.log("Plist removed.");
	}
	console.log("Service uninstalled.");
}

function start() {
	if (!existsSync(PLIST_PATH)) {
		console.error("Service not installed. Run: npm run service:install");
		process.exit(1);
	}
	if (!isLoaded()) {
		bootstrap();
	}
	try {
		execSync(`launchctl kickstart ${SERVICE_TARGET}`, { stdio: "pipe" });
	} catch {
		// kickstart fails if already running — that's fine
	}
	console.log(`Service started at http://localhost:${PORT}`);
}

function stop() {
	if (!isLoaded()) {
		console.log("Service is not running.");
		return;
	}
	try {
		execSync(`launchctl kill SIGTERM ${SERVICE_TARGET}`, { stdio: "pipe" });
	} catch {
		// Process may have already exited
	}
	console.log("Service stopped.");
	if (isAutoStartEnabled()) {
		console.log("It will restart on next login. To prevent that, run: npm run service:disable");
	}
}

function disable() {
	if (!existsSync(PLIST_PATH)) {
		console.error("Service not installed. Run: npm run service:install");
		process.exit(1);
	}

	// Stop the service if running
	if (isLoaded()) {
		bootout();
	}

	// Rewrite plist with RunAtLoad and KeepAlive disabled
	mkdirSync(LOG_DIR, { recursive: true });
	writeFileSync(PLIST_PATH, generatePlist(false));
	console.log("Service disabled. It will not auto-start on login.");
	console.log("To start it manually, run: npm run service:start");
}

function enable() {
	if (!existsSync(PLIST_PATH)) {
		console.error("Service not installed. Run: npm run service:install");
		process.exit(1);
	}

	// Rewrite plist with RunAtLoad and KeepAlive enabled
	mkdirSync(LOG_DIR, { recursive: true });
	writeFileSync(PLIST_PATH, generatePlist(true));

	// Bootstrap so it starts now
	if (isLoaded()) {
		bootout();
	}
	bootstrap();
	console.log(`Service enabled and running at http://localhost:${PORT}`);
	console.log("It will auto-start on login.");
}

function status() {
	if (!isLoaded()) {
		console.log("Service is not installed or not running.");
		return;
	}

	try {
		const output = execSync(`launchctl print ${SERVICE_TARGET}`, {
			encoding: "utf-8",
		});
		const pidMatch = output.match(/pid = (\d+)/);
		const stateMatch = output.match(/state = (.*)/);

		const autoStart = isAutoStartEnabled();
		console.log(`Service:    ${SERVICE_LABEL}`);
		console.log(`URL:        http://localhost:${PORT}`);
		console.log(`PID:        ${pidMatch ? pidMatch[1] : "not running"}`);
		console.log(`State:      ${stateMatch ? stateMatch[1].trim() : "unknown"}`);
		console.log(`Auto-start: ${autoStart ? "enabled" : "disabled"}`);
		console.log(`Plist:      ${PLIST_PATH}`);
		console.log(`Logs:       ${LOG_DIR}/`);
	} catch {
		console.log("Could not read service status.");
	}
}

function logs() {
	const stdoutLog = resolve(LOG_DIR, "stdout.log");
	const stderrLog = resolve(LOG_DIR, "stderr.log");

	if (!existsSync(stdoutLog) && !existsSync(stderrLog)) {
		console.log("No logs found. Is the service installed?");
		return;
	}

	console.log(`Tailing logs from ${LOG_DIR}/\nPress Ctrl+C to stop.\n`);
	const files = [stdoutLog, stderrLog].filter(existsSync).join(" ");
	execSync(`tail -f ${files}`, { stdio: "inherit" });
}

// After the service is back up, run the doctor pass and write
// `data/last-upgrade.json`. The next briefMe surfaces failures via the
// `_upgradeReport` field, then clears the file (one-shot). The
// `serverVersionCheck` carries a 1.5s timeout (see
// `src/lib/doctor/checks/server-version.ts`) so a still-booting service
// degrades to `status: "skip"` rather than producing a false fail.
async function postUpdateDoctor(targetVersion: string) {
	console.log("Running post-update doctor checks...\n");
	const doctor = await runDoctor();
	await writeUpgradeReport({
		completedAt: new Date().toISOString(),
		targetVersion,
		doctor,
	});
	const { fail, warn, pass, skip } = doctor.summary;
	if (fail > 0 || warn > 0) {
		console.warn(
			`⚠ Post-update doctor: ${fail} fail / ${warn} warn / ${pass} pass / ${skip} skip — next briefMe will surface details, run \`npm run doctor\` for the full report.\n`
		);
	} else {
		console.log(`✓ Post-update doctor: ${pass} pass / ${skip} skip — clean upgrade.\n`);
	}
}

// Snapshot `data/tracker.db` before `ensureBuild()` runs `prisma db push`.
// Captures the pre-upgrade state regardless of whether this run's schema
// change ends up being destructive (#214). Sidecars (`-wal` / `-shm`) are
// copied alongside when present. Fresh installs (no `tracker.db` yet)
// no-op silently — not an error.
async function backupBeforeUpdate(targetVersion: string) {
	const result = await backupDatabase(targetVersion);
	if (!result) {
		// Fresh install — no DB to back up. Stay quiet.
		return;
	}
	console.log(`Backed up DB → ${result.path} (${formatBytes(result.size)})`);
	const pruned = await pruneBackups();
	if (pruned.length > 0) {
		console.log(`Pruned ${pruned.length} older backup${pruned.length === 1 ? "" : "s"}.`);
	}
	console.log("");
}

async function update() {
	if (!isLoaded()) {
		console.error("Service is not running. Run: npm run service:install");
		process.exit(1);
	}

	const targetVersion = (
		JSON.parse(readFileSync(resolve(PROJECT_DIR, "package.json"), "utf-8")) as { version: string }
	).version;
	await backupBeforeUpdate(targetVersion);
	ensureBuild();
	writePlist(); // Refresh in case paths changed
	bootout();
	bootstrap();
	console.log(`Service rebuilt and restarted at http://localhost:${PORT}\n`);
	await postUpdateDoctor(targetVersion);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const command = process.argv[2];

const commands: Record<string, () => void | Promise<void>> = {
	install,
	uninstall,
	start,
	stop,
	status,
	logs,
	update,
	disable,
	enable,
};

// IIFE wrapper: tsx transforms this script as CJS, which doesn't support
// top-level await. The dispatch needs to await Promise-returning commands
// (`update` runs the post-`service:update` doctor pass — see #215) so the
// process doesn't exit before the file is written.
(async () => {
	if (command && command in commands) {
		await commands[command]();
	} else {
		console.log(`
Pigeon service manager

Usage: npm run service:<command>

Commands:
  service:install   Build and start as a background service
  service:uninstall Stop and remove the service
  service:start     Start the service
  service:stop      Stop the service
  service:disable   Stop and prevent auto-start on login
  service:enable    Re-enable auto-start on login
  service:status    Check if the service is running
  service:logs      Tail the service logs
  service:update    Rebuild and restart after code changes
`);
	}
})();
