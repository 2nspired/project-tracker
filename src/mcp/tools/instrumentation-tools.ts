import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

registerExtendedTool("getToolUsageStats", {
	category: "discovery",
	description:
		"MCP tool call analytics. mode=summary: top tools by call count with error rates and latency. mode=tool: single-tool deep dive with p50/p95 duration and recent errors. mode=agents: per-agent breakdown with top tools per agent.",
	parameters: z.object({
		mode: z
			.enum(["summary", "tool", "agents"])
			.default("summary")
			.describe(
				"summary=top tools overview, tool=single tool deep dive, agents=per-agent breakdown"
			),
		toolName: z
			.string()
			.optional()
			.describe("Required for mode=tool. Exact tool name (e.g. 'getBoard', 'createCard')"),
		since: z
			.string()
			.optional()
			.describe("ISO date string — only include logs after this time. Defaults to last 7 days."),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ mode, toolName, since }) =>
		safeExecute(async () => {
			const sinceDate = since
				? new Date(since as string)
				: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
			const where = { createdAt: { gte: sinceDate } };

			if (mode === "summary") {
				const logs = await db.toolCallLog.findMany({
					where,
					select: { toolName: true, toolType: true, durationMs: true, success: true },
					orderBy: { createdAt: "desc" },
					take: 10000,
				});

				const byTool = new Map<
					string,
					{ calls: number; errors: number; durations: number[]; toolType: string }
				>();
				for (const log of logs) {
					const entry = byTool.get(log.toolName) ?? {
						calls: 0,
						errors: 0,
						durations: [],
						toolType: log.toolType,
					};
					entry.calls++;
					if (!log.success) entry.errors++;
					entry.durations.push(log.durationMs);
					byTool.set(log.toolName, entry);
				}

				const tools = Array.from(byTool.entries())
					.map(([name, data]) => {
						const sorted = data.durations.slice().sort((a, b) => a - b);
						return {
							tool: name,
							type: data.toolType,
							calls: data.calls,
							errors: data.errors,
							errorRate: `${Math.round((data.errors / data.calls) * 100)}%`,
							avgMs: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
							p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0,
						};
					})
					.sort((a, b) => b.calls - a.calls)
					.slice(0, 25);

				return ok({
					mode: "summary",
					window: { since: sinceDate.toISOString() },
					totalCalls: logs.length,
					totalErrors: logs.filter((l) => !l.success).length,
					tools,
				});
			}

			if (mode === "tool") {
				if (!toolName) {
					return err(
						"toolName is required when mode=tool.",
						"Pass the exact tool name, e.g. getToolUsageStats({ mode: 'tool', toolName: 'getBoard' })"
					);
				}

				const logs = await db.toolCallLog.findMany({
					where: { ...where, toolName: toolName as string },
					orderBy: { createdAt: "desc" },
					take: 500,
				});

				if (logs.length === 0) {
					return ok({
						mode: "tool",
						toolName,
						message: "No calls recorded for this tool in the given window.",
					});
				}

				const durations = logs.map((l) => l.durationMs).sort((a, b) => a - b);
				const errors = logs.filter((l) => !l.success);

				const agentMap = new Map<
					string,
					{ calls: number; errors: number; sessions: Set<string> }
				>();
				for (const log of logs) {
					const entry = agentMap.get(log.agentName) ?? { calls: 0, errors: 0, sessions: new Set() };
					entry.calls++;
					if (!log.success) entry.errors++;
					entry.sessions.add(log.sessionId);
					agentMap.set(log.agentName, entry);
				}

				return ok({
					mode: "tool",
					toolName,
					toolType: logs[0].toolType,
					window: { since: sinceDate.toISOString() },
					calls: logs.length,
					errors: errors.length,
					errorRate: `${Math.round((errors.length / logs.length) * 100)}%`,
					duration: {
						avgMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
						p50Ms: durations[Math.floor((durations.length - 1) * 0.5)] ?? 0,
						p95Ms: durations[Math.floor((durations.length - 1) * 0.95)] ?? 0,
						maxMs: durations[durations.length - 1] ?? 0,
					},
					recentErrors: errors.slice(0, 5).map((e) => ({
						at: e.createdAt.toISOString(),
						message: e.errorMessage,
						agent: e.agentName,
					})),
					byAgent: Array.from(agentMap.entries()).map(([name, data]) => ({
						agent: name,
						calls: data.calls,
						errors: data.errors,
						sessions: data.sessions.size,
					})),
				});
			}

			if (mode === "agents") {
				const logs = await db.toolCallLog.findMany({
					where,
					select: { agentName: true, sessionId: true, toolName: true, success: true },
					orderBy: { createdAt: "desc" },
					take: 10000,
				});

				const byAgent = new Map<
					string,
					{ calls: number; errors: number; sessions: Set<string>; tools: Map<string, number> }
				>();
				for (const log of logs) {
					const entry = byAgent.get(log.agentName) ?? {
						calls: 0,
						errors: 0,
						sessions: new Set(),
						tools: new Map(),
					};
					entry.calls++;
					if (!log.success) entry.errors++;
					entry.sessions.add(log.sessionId);
					entry.tools.set(log.toolName, (entry.tools.get(log.toolName) ?? 0) + 1);
					byAgent.set(log.agentName, entry);
				}

				return ok({
					mode: "agents",
					window: { since: sinceDate.toISOString() },
					agents: Array.from(byAgent.entries())
						.map(([name, data]) => ({
							agent: name,
							calls: data.calls,
							errors: data.errors,
							errorRate: `${Math.round((data.errors / data.calls) * 100)}%`,
							sessions: data.sessions.size,
							topTools: Array.from(data.tools.entries())
								.sort(([, a], [, b]) => b - a)
								.slice(0, 5)
								.map(([tool, count]) => ({ tool, count })),
						}))
						.sort((a, b) => b.calls - a.calls),
				});
			}

			return err(`Unknown mode: ${mode as string}`);
		}),
});
