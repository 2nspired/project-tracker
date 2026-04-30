import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Check, CheckResult } from "../types.js";

const execFileAsync = promisify(execFile);

const PIGEON_LABEL = "com.2nspired.pigeon";
const LEGACY_LABEL = "com.2nspired.project-tracker";

async function listLoaded(): Promise<string> {
	try {
		const { stdout } = await execFileAsync("launchctl", ["list"], { timeout: 5000 });
		return stdout;
	} catch {
		return "";
	}
}

export const launchdLabelCheck: Check = {
	name: "launchd label",
	async run(): Promise<CheckResult> {
		if (process.platform !== "darwin") {
			return {
				name: this.name,
				status: "skip",
				message: "launchd is macOS-only — skipped on this platform.",
			};
		}

		const list = await listLoaded();
		if (!list) {
			return {
				name: this.name,
				status: "skip",
				message: "Could not query launchctl — skipping.",
			};
		}

		const pigeonLine = list.split("\n").find((l) => l.includes(PIGEON_LABEL));
		const legacyLine = list.split("\n").find((l) => l.includes(LEGACY_LABEL));

		if (pigeonLine && !legacyLine) {
			const pid = pigeonLine.trim().split(/\s+/)[0];
			const pidLabel = pid && pid !== "-" ? ` (PID ${pid})` : " (loaded but not running)";
			return {
				name: this.name,
				status: "pass",
				message: `${PIGEON_LABEL}${pidLabel}.`,
			};
		}

		if (pigeonLine && legacyLine) {
			return {
				name: this.name,
				status: "warn",
				message: `Both ${PIGEON_LABEL} and the legacy ${LEGACY_LABEL} are loaded — the legacy job will fight for ports.`,
				fix: `launchctl bootout gui/$(id -u)/${LEGACY_LABEL} && rm -f ~/Library/LaunchAgents/${LEGACY_LABEL}.plist`,
			};
		}

		if (legacyLine && !pigeonLine) {
			return {
				name: this.name,
				status: "fail",
				message: `Only the legacy ${LEGACY_LABEL} is loaded — the renamed service never installed.`,
				fix: `launchctl bootout gui/$(id -u)/${LEGACY_LABEL} && rm -f ~/Library/LaunchAgents/${LEGACY_LABEL}.plist && npm run service:install`,
			};
		}

		return {
			name: this.name,
			status: "warn",
			message: `${PIGEON_LABEL} is not loaded. The web UI is not running as a background service.`,
			fix: "npm run service:install",
		};
	},
};
