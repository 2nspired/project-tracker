/**
 * Service management for project-tracker via macOS launchd.
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
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_LABEL = "com.2nspired.project-tracker";
const PORT = 3100;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const HOME = homedir();
const PLIST_PATH = resolve(HOME, "Library/LaunchAgents", `${SERVICE_LABEL}.plist`);
const LOG_DIR = resolve(HOME, "Library/Logs/project-tracker");
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

function ensureBuild() {
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
	// Final attempt — let error propagate
	bootstrap();
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

function update() {
	if (!isLoaded()) {
		console.error("Service is not running. Run: npm run service:install");
		process.exit(1);
	}

	ensureBuild();
	writePlist(); // Refresh in case paths changed
	bootout();
	bootstrap();
	console.log(`Service rebuilt and restarted at http://localhost:${PORT}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const command = process.argv[2];

const commands: Record<string, () => void> = {
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

if (command && command in commands) {
	commands[command]();
} else {
	console.log(`
project-tracker service manager

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
