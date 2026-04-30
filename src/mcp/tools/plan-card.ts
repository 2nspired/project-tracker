/**
 * planCard — RFC #107 / card #107.
 *
 * Encodes the "agent plans a card" workflow as a first-class MCP tool.
 * Returns a structured brief (card context + tracker.md policy + extracted
 * investigation hints + a fixed protocol prompt) so every planned card
 * emerges with the same four locked sections (Why now / Plan / Out of
 * scope / Acceptance) without the agent re-deriving the recipe each time.
 *
 * Refuses (returns `_warnings[].code === "PLAN_EXISTS"`, no protocol) when
 * the card already has a plan in its description. Auto-stamps a `planning`
 * activity row so the human watching the board sees the agent enter the
 * planning state in real time.
 */

import { z } from "zod";
import { db } from "../db.js";
import { registerExtendedTool } from "../tool-registry.js";
import { AGENT_NAME, ok, safeExecute } from "../utils.js";
import { type CardContextPayload, loadCardContext } from "./context-tools.js";

// ─── Pure helpers (exported for unit tests) ────────────────────────

const REQUIRED_PLAN_HEADERS: ReadonlyArray<RegExp> = [
	/^##\s+Why now\s*$/im,
	/^##\s+Plan\s*$/im,
	/^##\s+Acceptance\s*$/im,
];

/**
 * Heuristic: does the card description already contain the locked-section
 * headers (Why now / Plan / Acceptance)? Out-of-scope is encouraged but
 * optional — sometimes there's nothing to defer. Case-insensitive on the
 * heading text; requires a level-2 ATX heading on its own line.
 */
export function hasLockedPlanSections(description: string | null | undefined): boolean {
	if (!description) return false;
	return REQUIRED_PLAN_HEADERS.every((re) => re.test(description));
}

export type InvestigationHints = {
	urls: string[];
	paths: string[];
	cardRefs: string[];
	symbols: string[];
};

const URL_RE = /https?:\/\/[^\s)<>"']+/gi;
const CARD_REF_RE = /(?<![\w/])#(\d+)\b/g;
// Heuristic for file paths: relative or absolute paths with a recognized
// extension. Greedy-but-not-too-greedy — won't match prose words.
const PATH_RE =
	/(?:[A-Za-z0-9_\-./]+\/)?[A-Za-z0-9_\-.]+\.(?:ts|tsx|js|jsx|md|mdx|json|prisma|css|scss|html|yaml|yml|toml|sh|sql|py|rs|go)\b/g;
// `backticked` identifiers — likely code symbols. Only when content looks
// like an identifier, function call, or dotted member access (skips prose
// fragments that just happened to be backticked).
const SYMBOL_RE = /`([A-Za-z_$][\w$.]*(?:\([^`]*\))?)`/g;

function dedupe(xs: string[]): string[] {
	return Array.from(new Set(xs));
}

/**
 * Extract starting points for investigation from a card description. Output
 * is deduplicated; empty arrays returned if nothing matches. Pure — no I/O.
 *
 * Order is preserved within each category (first-seen wins).
 */
export function extractInvestigationHints(
	description: string | null | undefined
): InvestigationHints {
	if (!description) return { urls: [], paths: [], cardRefs: [], symbols: [] };

	const urls = dedupe(
		(description.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)\]'"]+$/, ""))
	);

	const cardRefs = dedupe(Array.from(description.matchAll(CARD_REF_RE), (m) => `#${m[1]}`));

	// Strip URLs before scanning for paths/symbols so we don't pick up
	// URL fragments as file paths.
	const cleaned = description.replace(URL_RE, " ");

	const paths = dedupe(cleaned.match(PATH_RE) ?? []).filter(
		// Filter out things that are clearly version-y (e.g. `4.1.0` matched
		// the .ts/.md extension list false-positively against numeric paths).
		(p) => !/^\d+\.\d+\.\d+$/.test(p)
	);

	const symbols = dedupe(
		Array.from(cleaned.matchAll(SYMBOL_RE), (m) => m[1]).filter(
			// Drop symbols that are also paths (already captured) or pure
			// numbers / version strings.
			(s) => !paths.includes(s) && !/^\d/.test(s)
		)
	);

	return { urls, paths, cardRefs, symbols };
}

/**
 * Build the protocol string the agent follows. The goal is consistency:
 * every planned card ends up with the same four locked headings so future
 * humans and agents can find them in the same place.
 */
export function buildPlanProtocol(opts: {
	cardRef: string;
	columnName: string;
	columnPrompt: string | undefined;
	projectOrientation: string | undefined;
}): string {
	const { cardRef, columnName, columnPrompt, projectOrientation } = opts;
	const parts: string[] = [
		`# Planning ${cardRef}`,
		``,
		`Walk these steps in order. Every planned card must end up with the same four locked headings — that's the contract.`,
		``,
		`## 1. Investigate`,
		``,
		`Read the card description. Use \`investigation_hints\` as starting points — pull in any referenced files (Read), URLs (WebFetch when relevant), and related cards (\`getCardContext\`). Don't guess.`,
		``,
		`## 2. Synthesize the plan`,
		``,
		`Draft a plan with these four level-2 headings, in this exact order:`,
		``,
		`- \`## Why now\` — the trigger or motivation. What changed, what's painful, what unblocks if this ships?`,
		`- \`## Plan\` — concrete steps. Files to touch, tools to build, integration points. Numbered when order matters.`,
		`- \`## Out of scope\` — what you considered but deferred. Pre-empts scope creep in review.`,
		`- \`## Acceptance\` — how a reviewer can verify it shipped. Bullet list of testable criteria.`,
		``,
		`## 3. Propose in chat first`,
		``,
		`Show the plan in chat. Don't write to the card yet — chat is draft, card is publish.`,
		``,
		`## 4. On user confirmation`,
		``,
		`Once the user explicitly approves the plan:`,
		``,
		`1. \`updateCard({ cardId: "${cardRef}", description: "<full plan markdown>" })\` — replaces the card description with the published plan.`,
		`2. \`moveCard({ cardId: "${cardRef}", columnName: "In Progress", intent: "<short reason for starting now>" })\` — only if you're starting work this session.`,
		``,
	];

	if (columnPrompt) {
		parts.push(
			`## Column policy (${columnName})`,
			``,
			columnPrompt,
			``,
			`This is the project's tracker.md policy for the card's current column. Honor it while planning.`,
			``
		);
	}

	if (projectOrientation) {
		parts.push(`## Project orientation`, ``, projectOrientation, ``);
	}

	return parts.join("\n").trimEnd();
}

// ─── Tool registration ─────────────────────────────────────────────

type Warning = { code: string; message: string };

registerExtendedTool("planCard", {
	category: "context",
	description:
		"Plan a card: returns the card context, tracker.md policy, extracted investigation hints, and a structured protocol the agent follows to draft a four-section plan (Why now / Plan / Out of scope / Acceptance). Refuses with PLAN_EXISTS warning if the card already has a plan.",
	parameters: z.object({
		boardId: z.string().describe("Board UUID"),
		cardId: z.string().describe("Card UUID or #number"),
		intent: z
			.string()
			.max(120, "intent must be ≤ 120 chars")
			.optional()
			.describe(
				"Optional rationale stamped on the activity strip (e.g. 'planning before standup')"
			),
	}),
	handler: (params) =>
		safeExecute(async () => {
			const {
				boardId,
				cardId: cardRef,
				intent,
			} = params as {
				boardId: string;
				cardId: string;
				intent?: string;
			};

			const result = await loadCardContext(boardId, cardRef);
			if (!result.ok) return result.error;
			const { payload, cardId, cardNumber, columnName, description, policy, columnPrompt } =
				result.data;

			const warnings: Warning[] = [];
			const cardWithPlan = hasLockedPlanSections(description);

			if (cardWithPlan) {
				warnings.push({
					code: "PLAN_EXISTS",
					message:
						"Card description already contains the locked plan headers (## Why now / ## Plan / ## Acceptance). Refusing to overwrite — review the existing plan before re-planning. To force a re-plan, edit the description first to remove the headers.",
				});
			}

			if (!description || description.trim().length === 0) {
				warnings.push({
					code: "EMPTY_DESCRIPTION",
					message:
						"Card has no description — investigation_hints will be empty. Ask the user for a one-paragraph problem statement before planning.",
				});
			}

			if (!policy) {
				warnings.push({
					code: "NO_POLICY",
					message:
						"No tracker.md policy loaded for this project. Plans will lack column/project context. Add tracker.md at repo root to fix.",
				});
			}

			const investigationHints = extractInvestigationHints(description);

			const response: {
				card: CardContextPayload;
				policy: typeof policy;
				investigation_hints: ReturnType<typeof extractInvestigationHints>;
				protocol?: string;
				_warnings?: Warning[];
			} = {
				card: payload,
				policy,
				investigation_hints: investigationHints,
			};

			// Refuse-on-exists: omit the protocol entirely so the agent can't
			// silently overwrite a published plan. Surfaces the warning instead.
			if (!cardWithPlan) {
				response.protocol = buildPlanProtocol({
					cardRef: `#${cardNumber}`,
					columnName,
					columnPrompt,
					projectOrientation:
						policy?.prompt && policy.prompt.trim().length > 0 ? policy.prompt : undefined,
				});

				// Stamp activity so the human sees the planning intent live —
				// mirrors the existing intent system on moveCard / deleteCard.
				await db.activity.create({
					data: {
						cardId,
						action: "planning",
						details: `Planning #${cardNumber}`,
						intent: intent ? `planning #${cardNumber}: ${intent}` : `planning #${cardNumber}`,
						actorType: "AGENT",
						actorName: AGENT_NAME,
					},
				});
			}

			if (warnings.length > 0) response._warnings = warnings;

			return ok(response);
		}),
});
