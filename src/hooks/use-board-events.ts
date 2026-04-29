"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/trpc/react";

const FALLBACK_INTERVAL = 5000;
const MAX_RETRIES = 3;
const RECONNECT_DELAY = 10_000;

/**
 * Connects to the SSE endpoint for real-time board updates.
 * Invalidates board-scoped queries when events arrive.
 * Returns a fallback refetchInterval (5s) when SSE is unavailable.
 * Retries with backoff after failures instead of permanently degrading.
 */
export function useBoardEvents(boardId: string): number | undefined {
	const utils = api.useUtils();
	const [connected, setConnected] = useState(false);
	const failCount = useRef(0);
	const esRef = useRef<EventSource | null>(null);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		let disposed = false;

		function connect() {
			if (disposed) return;

			const es = new EventSource(`/api/events?boardId=${boardId}`);
			esRef.current = es;

			es.onopen = () => {
				setConnected(true);
				failCount.current = 0;
			};

			es.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === "connected") return;

					// Project-scoped events (tag:changed, milestone:changed) carry
					// projectId so invalidations widen past the board. Tags/milestones
					// live on Project, not Board, so a change in one board notifies
					// the project's other open boards via the per-board fanout in
					// emitProjectEvent. Listeners on each board still get the event.
					if (data.type === "tag:changed" && typeof data.projectId === "string") {
						void utils.tag.list.invalidate({ projectId: data.projectId });
						void utils.board.getFull.invalidate({ id: boardId });
						return;
					}
					if (data.type === "milestone:changed" && typeof data.projectId === "string") {
						void utils.milestone.list.invalidate({ projectId: data.projectId });
						void utils.board.getFull.invalidate({ id: boardId });
						return;
					}

					void utils.board.getFull.invalidate({ id: boardId });
					void utils.handoff.list.invalidate({ boardId });
					void utils.activity.listByBoard.invalidate({ boardId });
				} catch {
					// Ignore parse errors
				}
			};

			es.onerror = () => {
				failCount.current++;
				if (failCount.current >= MAX_RETRIES) {
					es.close();
					esRef.current = null;
					setConnected(false);

					// Retry after delay instead of permanently falling back
					if (!disposed) {
						retryTimer.current = setTimeout(() => {
							failCount.current = 0;
							connect();
						}, RECONNECT_DELAY);
					}
				}
			};
		}

		connect();

		return () => {
			disposed = true;
			esRef.current?.close();
			esRef.current = null;
			if (retryTimer.current) clearTimeout(retryTimer.current);
		};
	}, [boardId, utils]);

	return connected ? undefined : FALLBACK_INTERVAL;
}
