import { z } from "zod";
import { getHorizon } from "../../lib/column-roles.js";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { err, ok, safeExecute } from "../utils.js";

// ─── Status ───────────────────────────────────────────────────────

/**
 * Generate the status markdown for a project. Exported so the MCP
 * resource handler can reuse it without going through the tool layer.
 */
export async function generateStatusMarkdown(
	projectId: string
): Promise<{ markdown: string } | { error: string; hint: string }> {
	const project = await db.project.findUnique({
		where: { id: projectId },
		include: {
			milestones: {
				orderBy: { position: "asc" },
			},
			boards: {
				include: {
					columns: {
						orderBy: { position: "asc" },
						include: {
							cards: {
								orderBy: { position: "asc" },
								include: {
									checklists: {
										orderBy: { position: "asc" },
										select: { completed: true },
									},
									milestone: { select: { id: true, name: true } },
								},
							},
						},
					},
				},
			},
		},
	});

	if (!project) {
		return { error: "Project not found.", hint: "Use listProjects to find a valid projectId." };
	}

	// Flatten all cards across all boards
	const allCards = project.boards.flatMap((b) =>
		b.columns.flatMap((col) =>
			col.cards.map((card) => ({
				...card,
				tags: JSON.parse(card.tags) as string[],
				columnName: col.name,
				columnRole: col.role,
				horizon: getHorizon(col),
			}))
		)
	);

	// Find the latest updatedAt across all cards
	const lastUpdated =
		allCards.length > 0
			? new Date(Math.max(...allCards.map((c) => c.updatedAt.getTime())))
			: project.updatedAt;

	// Current phase — first milestone with cards still not in Done
	const milestonesWithProgress = project.milestones.map((ms) => {
		const msCards = allCards.filter((c) => c.milestoneId === ms.id);
		const doneCards = msCards.filter((c) => c.horizon === "done");
		return { ...ms, cards: msCards, doneCards, total: msCards.length, done: doneCards.length };
	});

	const currentMilestone = milestonesWithProgress.find((ms) => ms.total > 0 && ms.done < ms.total);

	// ─── Build markdown sections ────────────────────────────────────

	const lines: string[] = [];

	// Header
	lines.push(`# ${project.name} — Status`);
	const phase = currentMilestone ? currentMilestone.name : "N/A";
	lines.push(
		`_Last updated: ${lastUpdated.toISOString().split("T")[0]} • Current phase: ${phase}_`
	);
	lines.push("");

	// Where Things Stand
	if (project.description) {
		lines.push("## Where Things Stand");
		lines.push(project.description);
		lines.push("");
	}

	// Milestone checklist + per-milestone narrative
	if (milestonesWithProgress.length > 0) {
		lines.push("## Milestone Progress");

		for (const ms of milestonesWithProgress) {
			const check = ms.total > 0 && ms.done === ms.total ? "x" : " ";
			lines.push(`- [${check}] ${ms.name} (${ms.done}/${ms.total})`);
			for (const card of ms.cards) {
				const cardCheck = card.horizon === "done" ? "x" : " ";
				lines.push(`  - [${cardCheck}] #${card.number} ${card.title}`);
			}
		}
		lines.push("");

		// Per-milestone narrative (from Milestone.description)
		const milestonesWithDesc = milestonesWithProgress.filter((ms) => ms.description);
		if (milestonesWithDesc.length > 0) {
			for (const ms of milestonesWithDesc) {
				lines.push(`### ${ms.name}`);
				lines.push(ms.description!);
				lines.push("");
			}
		}
	}

	// What's Built — cards tagged `component` (any column, not just Done)
	const componentCards = allCards.filter((c) => c.tags.includes("component"));
	if (componentCards.length > 0) {
		lines.push("## What's Built");
		for (const card of componentCards) {
			const desc = card.description ? ` — ${card.description.split("\n")[0]}` : "";
			lines.push(`- **${card.title}**${desc}`);
		}
		lines.push("");
	}

	// Metrics — cards tagged `metric` with metadata.metrics
	const metricCards = allCards.filter((c) => c.tags.includes("metric"));
	const allMetrics: Array<{
		key: string;
		value: string | number;
		unit?: string;
		recordedAt?: string;
		env?: string;
	}> = [];
	for (const card of metricCards) {
		try {
			const meta = JSON.parse(card.metadata);
			if (Array.isArray(meta.metrics)) {
				allMetrics.push(...meta.metrics);
			}
		} catch {
			// skip malformed metadata
		}
	}
	if (allMetrics.length > 0) {
		lines.push("## Metrics");
		for (const m of allMetrics) {
			const unit = m.unit ? ` ${m.unit}` : "";
			const recorded = m.recordedAt ? ` _(recorded ${m.recordedAt})_` : "";
			const env = m.env ? ` _(env: ${m.env})_` : "";
			lines.push(`- **${m.key}**: ${m.value}${unit}${recorded}${env}`);
		}
		lines.push("");
	}

	// Parking Lot
	const parkingCards = allCards.filter((c) => c.horizon === "later");
	if (parkingCards.length > 0) {
		// Group by milestone
		const byMilestone = new Map<string, number>();
		for (const card of parkingCards) {
			const msName = card.milestone?.name ?? "Unassigned";
			byMilestone.set(msName, (byMilestone.get(msName) ?? 0) + 1);
		}
		lines.push("## Parking Lot");
		lines.push(
			`${parkingCards.length} cards across ${byMilestone.size} group${byMilestone.size === 1 ? "" : "s"}`
		);
		lines.push("");
	}

	return { markdown: lines.join("\n") };
}

registerExtendedTool("renderStatus", {
	category: "discovery",
	description:
		"Generate a STATUS.md-equivalent markdown snapshot of a project — milestones, components, metrics, parking lot. Replaces hand-maintained STATUS.md files with board-derived output.",
	parameters: z.object({
		projectId: z.string().describe("Project UUID"),
	}),
	annotations: { readOnlyHint: true },
	handler: ({ projectId }) =>
		safeExecute(async () => {
			const result = await generateStatusMarkdown(projectId as string);
			if ("error" in result) return err(result.error, result.hint);
			return ok({ markdown: result.markdown });
		}),
});
