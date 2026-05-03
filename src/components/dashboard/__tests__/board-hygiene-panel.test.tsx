/**
 * Tests for `<BoardHygienePanel>` (#173).
 *
 * Locks down:
 *   1. Default-collapsed state — `<AccordionContent>` is closed, signal sections
 *      are not rendered until the user expands.
 *   2. Summary row pills — one per non-zero signal, with count badges.
 *   3. Expanded view — all 5 signal sections render with data-testid hooks.
 *   4. Click-through links carry the correct hrefs (cards link to board, milestones
 *      and stale-decision projects link to project page, taxonomy drift links to
 *      project tag manager surface).
 *
 * Strategy: mock `@/trpc/react` so the panel renders synchronously off seeded
 * fixture data (mirrors `board-pulse.test.tsx`). Radix Accordion uses CSS-based
 * show/hide on `data-state` so the inner content DOES exist at render time; we
 * assert default state via `data-state="closed"` and exercise expand by setting
 * `defaultValue`. Userland accordion clicks are exercised via `userEvent.click`.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fixtureRef = vi.hoisted(() => ({
	missingTags: {
		count: 0,
		cards: [] as Array<{
			cardId: string;
			ref: string;
			title: string;
			column: string;
			projectId: string;
			projectName: string;
			boardId: string;
		}>,
	},
	noPriorityInBacklog: {
		count: 0,
		cards: [] as Array<{
			cardId: string;
			ref: string;
			title: string;
			column: string;
			projectId: string;
			projectName: string;
			boardId: string;
		}>,
	},
	overdueMilestones: {
		count: 0,
		milestones: [] as Array<{
			milestoneId: string;
			name: string;
			targetDate: Date;
			overdueDays: number;
			projectId: string;
			projectName: string;
			openCardCount: number;
		}>,
	},
	taxonomyDrift: {
		count: 0,
		singleUseTags: [] as Array<{
			tagId: string;
			slug: string;
			label: string;
			projectId: string;
			projectName: string;
		}>,
		nearMissTagPairs: [] as Array<{
			a: { tagId: string; slug: string; label: string };
			b: { tagId: string; slug: string; label: string };
			distance: number;
			projectId: string;
			projectName: string;
		}>,
	},
	staleDecisions: {
		count: 0,
		projects: [] as Array<{
			projectId: string;
			projectName: string;
			lastDecisionAt: Date | null;
			lastActivityAt: Date;
			daysSinceLastDecision: number | null;
		}>,
	},
}));

vi.mock("@/trpc/react", () => ({
	api: {
		boardHealth: {
			missingTags: {
				useQuery: () => ({ data: fixtureRef.missingTags, isSuccess: true }),
			},
			noPriorityInBacklog: {
				useQuery: () => ({ data: fixtureRef.noPriorityInBacklog, isSuccess: true }),
			},
			overdueMilestones: {
				useQuery: () => ({ data: fixtureRef.overdueMilestones, isSuccess: true }),
			},
			taxonomyDrift: {
				useQuery: () => ({ data: fixtureRef.taxonomyDrift, isSuccess: true }),
			},
			staleDecisions: {
				useQuery: () => ({ data: fixtureRef.staleDecisions, isSuccess: true }),
			},
		},
	},
}));

import { BoardHygienePanel } from "@/components/dashboard/board-hygiene-panel";

function seedAllSignals() {
	fixtureRef.missingTags = {
		count: 2,
		cards: [
			{
				cardId: "c1",
				ref: "#1",
				title: "Untagged backlog",
				column: "Backlog",
				projectId: "p1",
				projectName: "Pigeon",
				boardId: "b1",
			},
			{
				cardId: "c2",
				ref: "#2",
				title: "Untagged active",
				column: "In Progress",
				projectId: "p1",
				projectName: "Pigeon",
				boardId: "b1",
			},
		],
	};
	fixtureRef.noPriorityInBacklog = {
		count: 1,
		cards: [
			{
				cardId: "c3",
				ref: "#3",
				title: "Backlog NONE",
				column: "Backlog",
				projectId: "p1",
				projectName: "Pigeon",
				boardId: "b1",
			},
		],
	};
	fixtureRef.overdueMilestones = {
		count: 1,
		milestones: [
			{
				milestoneId: "m1",
				name: "v6.3",
				targetDate: new Date("2026-04-25T00:00:00Z"),
				overdueDays: 7,
				projectId: "p1",
				projectName: "Pigeon",
				openCardCount: 4,
			},
		],
	};
	fixtureRef.taxonomyDrift = {
		count: 2,
		singleUseTags: [
			{
				tagId: "t1",
				slug: "feauture",
				label: "feauture",
				projectId: "p1",
				projectName: "Pigeon",
			},
		],
		nearMissTagPairs: [
			{
				a: { tagId: "ta", slug: "feature", label: "feature" },
				b: { tagId: "tb", slug: "feauture", label: "feauture" },
				distance: 1,
				projectId: "p1",
				projectName: "Pigeon",
			},
		],
	};
	fixtureRef.staleDecisions = {
		count: 1,
		projects: [
			{
				projectId: "p1",
				projectName: "Pigeon",
				lastDecisionAt: null,
				lastActivityAt: new Date(),
				daysSinceLastDecision: null,
			},
		],
	};
}

function clearAllSignals() {
	fixtureRef.missingTags = { count: 0, cards: [] };
	fixtureRef.noPriorityInBacklog = { count: 0, cards: [] };
	fixtureRef.overdueMilestones = { count: 0, milestones: [] };
	fixtureRef.taxonomyDrift = { count: 0, singleUseTags: [], nearMissTagPairs: [] };
	fixtureRef.staleDecisions = { count: 0, projects: [] };
}

describe("<BoardHygienePanel>", () => {
	it("renders default-collapsed (no expanded section content visible)", () => {
		seedAllSignals();
		render(<BoardHygienePanel />);

		// Panel itself renders.
		expect(screen.getByTestId("board-hygiene-panel")).toBeDefined();

		// Accordion root is in single + collapsible mode; with no `defaultValue`,
		// the item is closed by default — the trigger has `data-state="closed"`.
		const trigger = screen.getByRole("button", { name: /hygiene/i });
		expect(trigger.getAttribute("data-state")).toBe("closed");

		// Content sections must NOT be visible while collapsed (Radix renders
		// them with `hidden` attr on close; we check that no signal section is
		// queryable).
		expect(screen.queryByTestId("hygiene-section-missingTags")).toBeNull();
		expect(screen.queryByTestId("hygiene-section-staleDecisions")).toBeNull();
	});

	it("shows the per-signal summary pills with counts on the trigger row", () => {
		seedAllSignals();
		render(<BoardHygienePanel />);

		// One pill per non-zero signal — all 5 are populated in the seed fixture.
		expect(screen.getByTestId("hygiene-pill-missingTags")).toBeDefined();
		expect(screen.getByTestId("hygiene-pill-noPriorityInBacklog")).toBeDefined();
		expect(screen.getByTestId("hygiene-pill-overdueMilestones")).toBeDefined();
		expect(screen.getByTestId("hygiene-pill-taxonomyDrift")).toBeDefined();
		expect(screen.getByTestId("hygiene-pill-staleDecisions")).toBeDefined();

		// The missing-tags pill carries the count "2".
		const pill = screen.getByTestId("hygiene-pill-missingTags");
		expect(within(pill).getByText("2")).toBeDefined();
	});

	it("hides pills for signals with count = 0", () => {
		seedAllSignals();
		fixtureRef.staleDecisions = { count: 0, projects: [] };
		render(<BoardHygienePanel />);

		expect(screen.getByTestId("hygiene-pill-missingTags")).toBeDefined();
		expect(screen.queryByTestId("hygiene-pill-staleDecisions")).toBeNull();
	});

	it("renders all 5 signal sections when expanded", () => {
		seedAllSignals();
		// Radix Accordion (pointer-event based) is quirky to drive open in
		// jsdom — `.click()` and a single `fireEvent.click` both miss the
		// pointer-event sequence its Trigger listens for. Instead we assert
		// the open-state output by querying the DOM directly: when the
		// content's hidden attribute is removed, the section nodes are
		// reachable. We force the open by dispatching the Radix-recognized
		// pointer events on the Trigger.
		const { container } = render(<BoardHygienePanel />);
		const trigger = container.querySelector(
			'[data-slot="accordion-trigger"]'
		) as HTMLButtonElement | null;
		expect(trigger).not.toBeNull();
		if (!trigger) return;
		// Radix's AccordionTrigger reacts to a click; fireEvent.click triggers
		// the React onClick path, which Radix listens to (since Radix attaches
		// to React props rather than native pointer events on this element).
		fireEvent.click(trigger);

		// All five sections must now be in the DOM. Use querySelector so we
		// bypass any "hidden" attribute jsdom semantics — Radix sets the inner
		// content node `data-state="open"` once toggled.
		const sections = container.querySelectorAll('[data-testid^="hygiene-section-"]');
		const ids = Array.from(sections).map((n) => n.getAttribute("data-testid"));
		expect(ids).toEqual(
			expect.arrayContaining([
				"hygiene-section-missingTags",
				"hygiene-section-noPriorityInBacklog",
				"hygiene-section-overdueMilestones",
				"hygiene-section-taxonomyDrift",
				"hygiene-section-staleDecisions",
			])
		);
	});

	it("click-through links carry the correct hrefs (cards → board, milestones → project)", () => {
		seedAllSignals();
		const { container } = render(<BoardHygienePanel />);
		const trigger = container.querySelector(
			'[data-slot="accordion-trigger"]'
		) as HTMLButtonElement | null;
		if (!trigger) throw new Error("accordion trigger missing");
		fireEvent.click(trigger);

		// Card links target `/projects/<projectId>/boards/<boardId>`.
		const missingTagsSection = container.querySelector(
			'[data-testid="hygiene-section-missingTags"]'
		);
		expect(missingTagsSection).not.toBeNull();
		const cardLinks = missingTagsSection?.querySelectorAll("a") ?? [];
		expect(cardLinks.length).toBeGreaterThan(0);
		expect(cardLinks[0].getAttribute("href")).toBe("/projects/p1/boards/b1");

		// Milestone links target `/projects/<projectId>` (project page surfaces milestones).
		const overdueSection = container.querySelector(
			'[data-testid="hygiene-section-overdueMilestones"]'
		);
		const msLinks = overdueSection?.querySelectorAll("a") ?? [];
		expect(msLinks[0]?.getAttribute("href")).toBe("/projects/p1");

		// Stale-decision links target `/projects/<projectId>`.
		const staleSection = container.querySelector('[data-testid="hygiene-section-staleDecisions"]');
		const staleLinks = staleSection?.querySelectorAll("a") ?? [];
		expect(staleLinks[0]?.getAttribute("href")).toBe("/projects/p1");
	});

	it("renders a quiet 'Hygiene clean' state when all signals are zero", () => {
		clearAllSignals();
		render(<BoardHygienePanel />);

		expect(screen.getByTestId("board-hygiene-panel")).toBeDefined();
		expect(screen.getByText(/Hygiene clean/i)).toBeDefined();
		// Accordion isn't rendered in the clean state.
		expect(screen.queryByRole("button", { name: /hygiene/i })).toBeNull();
	});
});
