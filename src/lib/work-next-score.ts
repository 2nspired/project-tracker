/**
 * Work-Next Score: algorithmic card prioritization.
 *
 * Computes a composite score from priority, age, blockers,
 * unblock-value, due date urgency, and checklist progress.
 * Higher score = work on this first.
 */

import type { Priority } from "./schemas/card-schemas";

const PRIORITY_WEIGHT: Record<Priority, number> = {
	URGENT: 5,
	HIGH: 4,
	MEDIUM: 3,
	LOW: 2,
	NONE: 0,
};

type ScoreableCard = {
	priority: string;
	updatedAt: Date | string;
	dueDate?: Date | string | null;
	checklists: Array<{ completed: boolean }>;
	relationsTo?: Array<{ id: string }>; // blockedBy relations
	_blockedByCount?: number;
	_blocksOtherCount?: number;
};

export function computeWorkNextScore(card: ScoreableCard): number {
	const priority = card.priority as Priority;
	const ageDays = Math.floor(
		(Date.now() - new Date(card.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
	);

	// Blocked cards sink hard
	const blockedByCount = card._blockedByCount ?? card.relationsTo?.length ?? 0;
	if (blockedByCount > 0) return -100 + PRIORITY_WEIGHT[priority];

	let score = 0;

	// Priority is the primary driver
	score += PRIORITY_WEIGHT[priority] * 30;

	// Older cards bubble up (diminishing returns past 14 days)
	score += Math.min(ageDays, 14) * 2;

	// Cards that unblock others are high-value
	const blocksOtherCount = card._blocksOtherCount ?? 0;
	score += blocksOtherCount * 15;

	// Due date urgency (exponential as deadline approaches)
	if (card.dueDate) {
		const daysUntilDue = Math.floor(
			(new Date(card.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
		);
		if (daysUntilDue < 0) {
			score += 50; // overdue
		} else if (daysUntilDue <= 1) {
			score += 40;
		} else if (daysUntilDue <= 3) {
			score += 25;
		} else if (daysUntilDue <= 7) {
			score += 10;
		}
	}

	// Nearly-done cards should be finished (checklist progress)
	const total = card.checklists.length;
	if (total > 0) {
		const done = card.checklists.filter((c) => c.completed).length;
		const progress = done / total;
		score += Math.round(progress * 10);
	}

	return score;
}

/** Format score for display */
export function formatScore(score: number): string {
	if (score <= -50) return "blocked";
	return String(score);
}

/** Score color for visual feedback */
export function scoreColor(score: number): string {
	if (score <= -50) return "text-red-500";
	if (score >= 100) return "text-orange-500";
	if (score >= 60) return "text-yellow-500";
	return "text-muted-foreground";
}
