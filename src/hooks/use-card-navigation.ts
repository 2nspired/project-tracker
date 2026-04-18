"use client";

import { useCallback } from "react";

/**
 * Returns a `(direction)` callback that moves the active card selection
 * one step forward or backward through `orderedIds`. Intended for wiring
 * the card detail sheet's `onNavigate` prop to ←/→ keyboard shortcuts.
 *
 * The caller owns the ordered list so each view (kanban, list, roadmap)
 * can honor its own filters, hidden roles, and sort mode. Navigation does
 * not wrap at the edges, and is a no-op when no card is selected or the
 * selected card is not present in `orderedIds` (e.g. filtered out).
 */
export function useCardNavigation(
	orderedIds: string[],
	selectedId: string | null,
	onSelect: (id: string) => void,
): (direction: "prev" | "next") => void {
	return useCallback(
		(direction) => {
			if (!selectedId) return;
			const idx = orderedIds.indexOf(selectedId);
			if (idx < 0) return;
			const nextIdx = direction === "next" ? idx + 1 : idx - 1;
			if (nextIdx >= 0 && nextIdx < orderedIds.length) {
				onSelect(orderedIds[nextIdx]);
			}
		},
		[orderedIds, selectedId, onSelect],
	);
}
