// Smoke test for #96 token usage service. Run via:
//   npx tsx scripts/smoke-test-token-usage.ts
//
// Verifies: manual record path, transcript record path (with a synthetic
// JSONL), idempotency, sub-agent walk, project/session/card summaries,
// pricing resolution. NOT a unit test suite — meant as an end-to-end
// confidence check before shipping.

import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/server/db";
import { tokenUsageService } from "@/server/services/token-usage-service";
import { computeCost, DEFAULT_PRICING, resolvePricing } from "@/lib/token-pricing-defaults";

async function main() {
	console.log("─── #96 token-usage smoke test ───\n");

	const project = await db.project.findFirst({ select: { id: true, name: true } });
	if (!project) {
		console.error("No project found in DB. Aborting.");
		process.exit(1);
	}
	console.log(`Using project: ${project.name} (${project.id})\n`);

	// ─── 1. Pricing resolution ────────────────────────────────────────
	console.log("1. resolvePricing fail-soft on bad JSON:");
	const badPricing = resolvePricing("{not valid json");
	console.log(`   keys=${Object.keys(badPricing).length}, has __default__=${"__default__" in badPricing}`);

	console.log("\n2. computeCost on a known model:");
	const opusCost = computeCost(
		{
			model: "claude-opus-4-7",
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			cacheReadTokens: 0,
			cacheCreation1hTokens: 0,
			cacheCreation5mTokens: 0,
		},
		DEFAULT_PRICING as Record<string, typeof DEFAULT_PRICING.__default__>
	);
	console.log(`   1M in + 1M out @ Opus = $${opusCost} (expected $90)`);

	console.log("\n3. computeCost on unknown model falls back to zero:");
	const unknownCost = computeCost(
		{
			model: "unknown-model-99",
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			cacheReadTokens: 0,
			cacheCreation1hTokens: 0,
			cacheCreation5mTokens: 0,
		},
		DEFAULT_PRICING as Record<string, typeof DEFAULT_PRICING.__default__>
	);
	console.log(`   = $${unknownCost} (expected $0)`);

	// ─── 2. Manual record path ────────────────────────────────────────
	const manualSessionId = `smoke-manual-${Date.now()}`;
	console.log(`\n4. recordManual: sessionId=${manualSessionId}`);
	const m1 = await tokenUsageService.recordManual({
		projectId: project.id,
		sessionId: manualSessionId,
		agentName: "smoke-test",
		model: "claude-opus-4-7",
		inputTokens: 100,
		outputTokens: 50,
	});
	console.log(`   first call: ${JSON.stringify(m1)}`);
	const m2 = await tokenUsageService.recordManual({
		projectId: project.id,
		sessionId: manualSessionId,
		agentName: "smoke-test",
		model: "claude-opus-4-7",
		inputTokens: 200,
		outputTokens: 100,
	});
	console.log(`   second call: ${JSON.stringify(m2)}`);

	const sessionSummary = await tokenUsageService.getSessionSummary(manualSessionId, project.id);
	console.log(`   getSessionSummary: ${JSON.stringify(sessionSummary)}`);

	// ─── 3. Transcript record path ────────────────────────────────────
	const tmpDir = await mkdir(path.join(tmpdir(), `smoke-token-${Date.now()}`), { recursive: true });
	if (!tmpDir) throw new Error("mkdir returned undefined");
	const transcriptPath = path.join(tmpDir, "session.jsonl");
	const subDir = path.join(tmpDir, "session", "subagents");
	await mkdir(subDir, { recursive: true });

	const parentLines = [
		{
			message: {
				role: "assistant",
				model: "claude-opus-4-7",
				usage: {
					input_tokens: 1000,
					output_tokens: 500,
					cache_read_input_tokens: 200,
					cache_creation: { ephemeral_5m_input_tokens: 100 },
				},
			},
		},
		{ message: { role: "user", content: "noise" } },
		{
			message: {
				role: "assistant",
				model: "claude-opus-4-7",
				usage: { input_tokens: 2000, output_tokens: 800 },
			},
		},
		"this is a malformed line that should be skipped",
		{
			message: {
				role: "assistant",
				model: "claude-sonnet-4-6",
				usage: { input_tokens: 5000, output_tokens: 2000 },
			},
		},
	];
	await writeFile(
		transcriptPath,
		parentLines
			.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
			.join("\n")
	);

	const subLines = [
		{
			message: {
				role: "assistant",
				model: "claude-haiku-4-5",
				usage: { input_tokens: 300, output_tokens: 150 },
			},
		},
	];
	await writeFile(
		path.join(subDir, "agent-1.jsonl"),
		subLines.map((entry) => JSON.stringify(entry)).join("\n")
	);

	const transcriptSessionId = `smoke-transcript-${Date.now()}`;
	console.log(`\n5. recordFromTranscript: sessionId=${transcriptSessionId}`);
	const t1 = await tokenUsageService.recordFromTranscript({
		projectId: project.id,
		sessionId: transcriptSessionId,
		transcriptPath,
		agentName: "claude-code",
	});
	console.log(`   first call: ${JSON.stringify(t1)}`);
	const t2 = await tokenUsageService.recordFromTranscript({
		projectId: project.id,
		sessionId: transcriptSessionId,
		transcriptPath,
		agentName: "claude-code",
	});
	console.log(`   second call (idempotency): ${JSON.stringify(t2)}`);

	const transcriptSummary = await tokenUsageService.getSessionSummary(
		transcriptSessionId,
		project.id
	);
	console.log(`   getSessionSummary: ${JSON.stringify(transcriptSummary, null, 2)}`);

	// ─── 4. Missing transcript ────────────────────────────────────────
	console.log("\n6. recordFromTranscript with bogus path:");
	const t3 = await tokenUsageService.recordFromTranscript({
		projectId: project.id,
		sessionId: `smoke-missing-${Date.now()}`,
		transcriptPath: "/nonexistent/path/to/nothing.jsonl",
	});
	console.log(`   ${JSON.stringify(t3)}`);

	// ─── 5. Project summary ──────────────────────────────────────────
	console.log("\n7. getProjectSummary:");
	const proj = await tokenUsageService.getProjectSummary(project.id);
	if (proj.success) {
		console.log(`   totalCostUsd=${proj.data.totalCostUsd.toFixed(6)}`);
		console.log(`   sessionCount=${proj.data.sessionCount}`);
		console.log(`   eventCount=${proj.data.eventCount}`);
		console.log(`   trackingSince=${proj.data.trackingSince?.toISOString() ?? "null"}`);
		console.log(`   byModel:`);
		for (const m of proj.data.byModel) {
			console.log(
				`     - ${m.model}: in=${m.inputTokens} out=${m.outputTokens} cost=$${m.costUsd.toFixed(6)}`
			);
		}
	}

	// ─── 6. Pricing override ─────────────────────────────────────────
	console.log("\n8. updatePricing override:");
	const updated = await tokenUsageService.updatePricing({
		"claude-opus-4-7": { inputPerMTok: 999, outputPerMTok: 999 },
	});
	if (updated.success) {
		console.log(`   opus override: in=${updated.data["claude-opus-4-7"].inputPerMTok}`);
		console.log(`   haiku still default: in=${updated.data["claude-haiku-4-5"].inputPerMTok}`);
	}
	// Restore
	await tokenUsageService.updatePricing({});
	console.log("   pricing restored to defaults");

	// ─── 7. Cleanup ──────────────────────────────────────────────────
	console.log("\n9. Cleaning up smoke test rows...");
	await db.tokenUsageEvent.deleteMany({
		where: { sessionId: { in: [manualSessionId, transcriptSessionId] } },
	});
	await rm(tmpDir, { recursive: true, force: true });
	console.log("   done.");

	await db.$disconnect();
	console.log("\n─── smoke test complete ───");
}

main().catch(async (err) => {
	console.error(err);
	await db.$disconnect();
	process.exit(1);
});
