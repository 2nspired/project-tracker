// Claude Code Stop hook: token usage recorder.
//
// Invoked by the `command:` Stop hook in ~/.claude-alt/.claude.json via
// scripts/stop-hook.sh (which `cd`s to the project root first so Prisma's
// relative `file:./data/tracker.db` URL resolves correctly).
//
// Reads the Stop hook payload (JSON on stdin) — { session_id,
// transcript_path, cwd, hook_event_name, ... } — and calls the
// transcript-aggregation service. Idempotent: same sessionId always replaces.
//
// Always exits 0. Stop hooks must never block CC. All diagnostics — the raw
// payload, parse errors, project resolution, service result, and any thrown
// exception — go to data/stop-hook.log. If the table stays empty, that file
// is the single source of truth for "did the hook even fire?".
//
// History: replaces the prior `type: "mcp_tool"` Stop hook (silent no-op in
// CC 2.1.123 — fired hundreds of turns, wrote 0 rows). The MCP tool itself
// works (see scripts/smoke-test-token-usage.ts); the failure was hook→tool
// plumbing, not the tool.

import { appendFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectIdFromCwd } from "@/lib/services/resolve-project";
import { db } from "@/server/db";
import { tokenUsageService } from "@/server/services/token-usage-service";

const LOG_PATH = path.resolve("data/stop-hook.log");

async function log(line: string) {
	const stamp = new Date().toISOString();
	try {
		await appendFile(LOG_PATH, `[${stamp}] ${line}\n`);
	} catch {
		// If we can't even write the log, there's nothing useful we can do.
		// stderr would surface to the user on every turn.
	}
}

type StopPayload = {
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	hook_event_name?: string;
	stop_reason?: string;
};

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function main() {
	const raw = await readStdin();
	await log(`stdin bytes=${raw.length}`);

	let payload: StopPayload;
	try {
		payload = JSON.parse(raw) as StopPayload;
	} catch (err) {
		await log(`parse error: ${err instanceof Error ? err.message : String(err)}`);
		await log(`raw: ${raw.slice(0, 500)}`);
		return;
	}

	const { session_id, transcript_path, cwd, hook_event_name } = payload;
	await log(
		`event=${hook_event_name ?? "?"} session=${session_id ?? "?"} cwd=${cwd ?? "?"} transcript=${transcript_path ?? "?"}`
	);

	if (!session_id || !transcript_path || !cwd) {
		await log("missing required fields; bailing");
		return;
	}

	const projectId = await resolveProjectIdFromCwd(cwd, db);
	if (!projectId) {
		await log(`PROJECT_NOT_FOUND for cwd=${cwd}`);
		return;
	}
	await log(`projectId=${projectId}`);

	const result = await tokenUsageService.recordFromTranscript({
		projectId,
		sessionId: session_id,
		transcriptPath: transcript_path,
		agentName: "claude-code",
	});

	if (!result.success) {
		await log(`service error: ${result.error.code} ${result.error.message}`);
		return;
	}
	const { created, subAgentFiles, warnings } = result.data;
	await log(
		`ok created=${created} subAgents=${subAgentFiles} warnings=${JSON.stringify(warnings)}`
	);
}

main()
	.catch(async (err) => {
		await log(`UNCAUGHT: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
	})
	.finally(async () => {
		try {
			await db.$disconnect();
		} catch {
			// disconnect failures don't matter — process is about to exit
		}
		process.exit(0);
	});
