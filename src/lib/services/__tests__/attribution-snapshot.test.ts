// @vitest-environment node
/**
 * Tests for `buildAttributionSnapshot` (#269).
 *
 * Hand-built duck-typed prisma mock — no DB fixture needed since the
 * builder is one Prisma call + a map. The token-usage integration tests
 * (`server/services/__tests__/token-usage-attribution.test.ts`) cover the
 * end-to-end behavior against a real SQLite fixture, including the
 * `column.role = "active"` join.
 */

import { describe, expect, it, vi } from "vitest";
import { buildAttributionSnapshot } from "@/lib/services/attribution-snapshot";

function makePrisma(cardRows: { id: string }[]) {
	const findMany = vi.fn(async () => cardRows);
	return {
		mock: { findMany },
		// biome-ignore lint/suspicious/noExplicitAny: duck-typed prisma surface for tests
		prisma: { card: { findMany } } as any,
	};
}

describe("buildAttributionSnapshot", () => {
	it("populates inProgressCardIds from cards in active-role columns for the project", async () => {
		const { prisma, mock } = makePrisma([{ id: "card-a" }, { id: "card-b" }]);
		const snapshot = await buildAttributionSnapshot(prisma, "proj-1");

		expect(snapshot.inProgressCardIds).toEqual(["card-a", "card-b"]);
		expect(mock.findMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1", column: { role: "active" } },
			select: { id: true },
		});
	});

	it("returns empty inProgressCardIds when no cards are active", async () => {
		const { prisma } = makePrisma([]);
		const snapshot = await buildAttributionSnapshot(prisma, "proj-1");
		expect(snapshot.inProgressCardIds).toEqual([]);
	});

	it("stubs sessionTouchedCards + sessionCommits as empty arrays (deferred to #272)", async () => {
		// Pins the v6.3 scope decision: only signals 1, 2, 5 are wired.
		// Tail signals stay empty so `attribute()` falls through to
		// `unattributed` instead of returning a wrong card.
		const { prisma } = makePrisma([{ id: "card-a" }]);
		const snapshot = await buildAttributionSnapshot(prisma, "proj-1");
		expect(snapshot.sessionTouchedCards).toEqual([]);
		expect(snapshot.sessionCommits).toEqual([]);
	});
});
