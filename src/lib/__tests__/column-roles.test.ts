import { describe, expect, it } from "vitest";

import { HORIZON_ORDER, type Horizon } from "@/lib/column-roles";

describe("HORIZON_ORDER", () => {
	it("matches the exact set of valid horizons in display order", () => {
		// Adding/removing/reordering a horizon must update both the type and
		// this constant in lockstep — the satisfies clause on HORIZON_ORDER
		// guarantees TS compatibility, and this test pins the runtime value
		// so a typo (e.g. the legacy "next" horizon removed in #97) can't
		// be silently smuggled back in via an `as Horizon[]` cast at the
		// consumer site (the bug pattern that produced #218).
		expect(HORIZON_ORDER).toEqual(["now", "later", "done"]);
	});

	it("is iterable over a horizonGroups shape with empty buckets without throwing", () => {
		// Pins the empty-bucket path that the production crash hit. If a
		// future shape change introduces a horizon key that isn't present
		// in horizonGroups, this loop throws "horizonGroups[h] is not
		// iterable" — exactly #218's symptom.
		const horizonGroups: Record<Horizon, number[]> = {
			now: [],
			later: [],
			done: [],
		};
		expect(() => {
			for (const h of HORIZON_ORDER) {
				for (const _ of horizonGroups[h]) {
					// no-op — we just need the iteration not to throw
				}
			}
		}).not.toThrow();
	});
});
