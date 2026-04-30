import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let cachedVersion: string | null = null;

function readVersion(): string {
	if (cachedVersion) return cachedVersion;
	try {
		const pkgPath = resolve(process.cwd(), "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
		cachedVersion = pkg.version ?? "unknown";
	} catch {
		cachedVersion = "unknown";
	}
	return cachedVersion;
}

export function GET() {
	return Response.json(
		{ ok: true, version: readVersion(), brand: "pigeon" },
		{ headers: { "Cache-Control": "no-store" } }
	);
}
