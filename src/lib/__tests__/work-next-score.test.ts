/**
 * Tests for the work-next ranking algorithm (#233).
 *
 * `computeWorkNextScore` drives `briefMe.topWork`. The whole point of these
 * tests is to lock current weighting behavior so downstream v6.2 refactors
 * can change the algorithm with confidence rather than silently shifting
 * which cards agents are recommended.
 *
 * Behavior reference: `src/lib/work-next-score.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeWorkNextScore, formatScore, scoreColor } from "@/lib/work-next-score";

// Anchor "now" so age + due-date math is deterministic.
const NOW = new Date("2026-05-01T12:00:00Z");
const DAY = 1000 * 60 * 60 * 24;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * DAY);
}

function inDays(days: number): Date {
	return new Date(NOW.getTime() + days * DAY);
}

type Card = Parameters<typeof computeWorkNextScore>[0];

function makeCard(overrides: Partial<Card> = {}): Card {
	return {
		priority: "MEDIUM",
		updatedAt: NOW,
		dueDate: null,
		checklists: [],
		...overrides,
	};
}

describe("computeWorkNextScore — blocked sink", () => {
	it("returns -100 + priority weight when _blockedByCount > 0 (URGENT)", () => {
		// PRIORITY_WEIGHT.URGENT === 5 → -100 + 5 = -95.
		const score = computeWorkNextScore(makeCard({ priority: "URGENT", _blockedByCount: 1 }));
		expect(score).toBe(-95);
	});

	it("returns -100 + priority weight when _blockedByCount > 0 (NONE)", () => {
		// PRIORITY_WEIGHT.NONE === 0 → -100 + 0 = -100.
		const score = computeWorkNextScore(makeCard({ priority: "NONE", _blockedByCount: 3 }));
		expect(score).toBe(-100);
	});

	it("falls back to relationsTo.length when _blockedByCount is undefined", () => {
		const score = computeWorkNextScore(
			makeCard({ priority: "HIGH", relationsTo: [{ id: "r1" }, { id: "r2" }] })
		);
		// HIGH = 4 → -100 + 4 = -96.
		expect(score).toBe(-96);
	});

	it("ignores other contributions entirely when blocked (due date, age, checklist)", () => {
		// All bonus paths active, but blocked still wins — assertion locks the
		// short-circuit so an accidental fallthrough that adds bonuses to a
		// blocked card would fail this test.
		const score = computeWorkNextScore(
			makeCard({
				priority: "URGENT",
				_blockedByCount: 1,
				dueDate: daysAgo(5), // overdue
				updatedAt: daysAgo(30), // would normally pin age contribution
				checklists: [{ completed: true }, { completed: true }],
			})
		);
		expect(score).toBe(-95);
	});

	it("prefers _blockedByCount over relationsTo.length when both are present", () => {
		// _blockedByCount === 0 explicitly → not blocked even with relationsTo
		// non-empty. Exercises the `??` short-circuit.
		const score = computeWorkNextScore(
			makeCard({ priority: "MEDIUM", _blockedByCount: 0, relationsTo: [{ id: "r1" }] })
		);
		// Not blocked: priority 3 * 30 = 90.
		expect(score).toBe(90);
	});
});

describe("computeWorkNextScore — priority weighting", () => {
	// Baseline: card updated "now" (age 0), no due date, no checklist, no blocks.
	// Score = priorityWeight * 30.
	it.each([
		["URGENT", 150],
		["HIGH", 120],
		["MEDIUM", 90],
		["LOW", 60],
		["NONE", 0],
	] as const)("priority %s yields baseline %d", (priority, expected) => {
		expect(computeWorkNextScore(makeCard({ priority }))).toBe(expected);
	});
});

describe("computeWorkNextScore — age decay", () => {
	it("adds 2 points per day for cards under 14 days", () => {
		// 5 days old, MEDIUM priority: 90 + 5*2 = 100.
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", updatedAt: daysAgo(5) }));
		expect(score).toBe(100);
	});

	it("clamps age contribution at 14 days", () => {
		// 14 days: 90 + 28 = 118.
		const at14 = computeWorkNextScore(makeCard({ priority: "MEDIUM", updatedAt: daysAgo(14) }));
		// 30 days: still clamped at 14 → still 118.
		const at30 = computeWorkNextScore(makeCard({ priority: "MEDIUM", updatedAt: daysAgo(30) }));
		expect(at14).toBe(118);
		expect(at30).toBe(118);
	});

	it("treats freshly-updated card as age 0", () => {
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", updatedAt: NOW }));
		expect(score).toBe(90);
	});

	it("accepts updatedAt as ISO string", () => {
		const score = computeWorkNextScore(
			makeCard({ priority: "MEDIUM", updatedAt: daysAgo(3).toISOString() })
		);
		// 90 + 3*2 = 96.
		expect(score).toBe(96);
	});
});

describe("computeWorkNextScore — due date urgency", () => {
	it("adds 50 for overdue", () => {
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", dueDate: daysAgo(2) }));
		expect(score).toBe(90 + 50);
	});

	it("adds 40 when due in ≤1 day", () => {
		// daysUntilDue floored: a date exactly NOW yields 0 → ≤1 → 40.
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", dueDate: NOW }));
		expect(score).toBe(90 + 40);
	});

	it("adds 25 when due in 2–3 days", () => {
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", dueDate: inDays(3) }));
		expect(score).toBe(90 + 25);
	});

	it("adds 10 when due in 4–7 days", () => {
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", dueDate: inDays(7) }));
		expect(score).toBe(90 + 10);
	});

	it("adds nothing when due >7 days out", () => {
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", dueDate: inDays(14) }));
		expect(score).toBe(90);
	});

	it("ignores due date when null", () => {
		expect(computeWorkNextScore(makeCard({ priority: "MEDIUM", dueDate: null }))).toBe(90);
	});

	it("accepts dueDate as ISO string", () => {
		const score = computeWorkNextScore(
			makeCard({ priority: "MEDIUM", dueDate: inDays(3).toISOString() })
		);
		expect(score).toBe(90 + 25);
	});
});

describe("computeWorkNextScore — checklist progress", () => {
	it("contributes 0 when no checklist items", () => {
		expect(computeWorkNextScore(makeCard({ priority: "MEDIUM", checklists: [] }))).toBe(90);
	});

	it("contributes 0 when 0/1 complete", () => {
		expect(
			computeWorkNextScore(makeCard({ priority: "MEDIUM", checklists: [{ completed: false }] }))
		).toBe(90);
	});

	it("contributes 5 when 1/2 complete (rounds 0.5*10 = 5)", () => {
		expect(
			computeWorkNextScore(
				makeCard({
					priority: "MEDIUM",
					checklists: [{ completed: true }, { completed: false }],
				})
			)
		).toBe(95);
	});

	it("contributes 10 when fully complete", () => {
		expect(
			computeWorkNextScore(
				makeCard({
					priority: "MEDIUM",
					checklists: [{ completed: true }, { completed: true }],
				})
			)
		).toBe(100);
	});

	it("rounds checklist progress (2/3 → 7)", () => {
		// 2/3 * 10 = 6.666 → round → 7.
		expect(
			computeWorkNextScore(
				makeCard({
					priority: "MEDIUM",
					checklists: [{ completed: true }, { completed: true }, { completed: false }],
				})
			)
		).toBe(97);
	});
});

describe("computeWorkNextScore — unblock-others bonus", () => {
	it("adds 15 per card this card unblocks", () => {
		const score = computeWorkNextScore(makeCard({ priority: "MEDIUM", _blocksOtherCount: 2 }));
		// 90 + 2*15 = 120.
		expect(score).toBe(120);
	});

	it("contributes 0 when undefined", () => {
		expect(computeWorkNextScore(makeCard({ priority: "MEDIUM" }))).toBe(90);
	});
});

describe("computeWorkNextScore — combinations", () => {
	it("stacks priority + age + due + checklist + unblock", () => {
		const score = computeWorkNextScore(
			makeCard({
				priority: "HIGH", // 4*30 = 120
				updatedAt: daysAgo(5), // +10
				dueDate: inDays(3), // +25
				checklists: [{ completed: true }, { completed: true }], // +10
				_blocksOtherCount: 1, // +15
			})
		);
		expect(score).toBe(120 + 10 + 25 + 10 + 15);
	});
});

describe("formatScore", () => {
	it("returns 'blocked' for scores ≤ -50", () => {
		expect(formatScore(-50)).toBe("blocked");
		expect(formatScore(-100)).toBe("blocked");
	});

	it("returns numeric string otherwise", () => {
		expect(formatScore(-49)).toBe("-49");
		expect(formatScore(0)).toBe("0");
		expect(formatScore(150)).toBe("150");
	});
});

describe("scoreColor", () => {
	it("returns danger semantic token for blocked scores (≤ -50)", () => {
		expect(scoreColor(-50)).toBe("text-danger");
		expect(scoreColor(-100)).toBe("text-danger");
	});

	it("returns warning semantic token for ≥100", () => {
		expect(scoreColor(100)).toBe("text-warning");
		expect(scoreColor(250)).toBe("text-warning");
	});

	it("returns yellow for 60–99", () => {
		expect(scoreColor(60)).toBe("text-yellow-500");
		expect(scoreColor(99)).toBe("text-yellow-500");
	});

	it("returns muted otherwise", () => {
		expect(scoreColor(0)).toBe("text-muted-foreground");
		expect(scoreColor(59)).toBe("text-muted-foreground");
		expect(scoreColor(-49)).toBe("text-muted-foreground");
	});
});
