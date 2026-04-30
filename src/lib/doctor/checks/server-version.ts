import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Check, CheckResult } from "../types.js";

function readPackageVersion(): string | null {
	try {
		const here = fileURLToPath(new URL(".", import.meta.url));
		// src/lib/doctor/checks → ../../../.. → repo root
		const pkgPath = resolve(here, "..", "..", "..", "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
		return pkg.version ?? null;
	} catch {
		return null;
	}
}

async function fetchRunningVersion(): Promise<string | null> {
	const url = process.env.PIGEON_BASE_URL ?? "http://localhost:3100";
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 1500);
		const res = await fetch(`${url}/api/health`, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		const body = (await res.json()) as { version?: string };
		return body.version ?? null;
	} catch {
		return null;
	}
}

export const serverVersionCheck: Check = {
	name: "Server version",
	async run(): Promise<CheckResult> {
		const pkgVersion = readPackageVersion();
		if (!pkgVersion) {
			return {
				name: this.name,
				status: "warn",
				message: "Could not read package.json version.",
			};
		}

		const running = await fetchRunningVersion();
		if (!running) {
			return {
				name: this.name,
				status: "skip",
				message: `package.json reports ${pkgVersion}; could not reach the running service to compare.`,
			};
		}

		if (running === pkgVersion) {
			return {
				name: this.name,
				status: "pass",
				message: `Service v${running} matches package.json.`,
			};
		}

		return {
			name: this.name,
			status: "fail",
			message: `Service is running v${running} but package.json is v${pkgVersion} — service was not rebuilt after the last pull.`,
			fix: "npm run service:update",
		};
	},
};
