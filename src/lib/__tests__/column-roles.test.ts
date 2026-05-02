import { describe, expect, it } from "vitest";

import { getHorizon, HORIZON_ORDER, type Horizon, hasRole } from "@/lib/column-roles";

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

// ─── #233 — `getHorizon` + `hasRole` coverage ───────────────────────
//
// These functions are used in ~15 places (board views, brief payload,
// stale-cards detection). Their name-fallback path is silently breakable —
// a typo in the lowercased match table would re-bucket every "Done" or
// "In Progress" column without any compile-time signal.

describe("getHorizon", () => {
	it("maps role 'active' → 'now'", () => {
		expect(getHorizon({ role: "active", name: "Whatever" })).toBe("now");
	});

	it("maps role 'review' → 'now'", () => {
		expect(getHorizon({ role: "review", name: "Whatever" })).toBe("now");
	});

	it("maps role 'done' → 'done'", () => {
		expect(getHorizon({ role: "done", name: "Whatever" })).toBe("done");
	});

	it("maps role 'backlog' → 'later'", () => {
		expect(getHorizon({ role: "backlog", name: "Whatever" })).toBe("later");
	});

	it("maps role 'parking' → 'later'", () => {
		expect(getHorizon({ role: "parking", name: "Whatever" })).toBe("later");
	});

	it("ignores unknown role and falls back to name (e.g. legacy 'todo')", () => {
		// Role 'todo' was removed in #97; an old DB row carrying it should
		// not blow up but should fall through to name-based matching.
		expect(getHorizon({ role: "todo", name: "Done" })).toBe("done");
	});

	it("falls back to name 'Done' (case-insensitive) → 'done'", () => {
		expect(getHorizon({ role: null, name: "Done" })).toBe("done");
		expect(getHorizon({ role: null, name: "DONE" })).toBe("done");
		expect(getHorizon({ role: null, name: "done" })).toBe("done");
	});

	it("falls back to name 'In Progress' (case-insensitive) → 'now'", () => {
		expect(getHorizon({ role: null, name: "In Progress" })).toBe("now");
		expect(getHorizon({ role: null, name: "in progress" })).toBe("now");
	});

	it("falls back to name 'Review' (case-insensitive) → 'now'", () => {
		expect(getHorizon({ role: null, name: "Review" })).toBe("now");
	});

	it("defaults unknown names to 'later'", () => {
		expect(getHorizon({ role: null, name: "Backlog" })).toBe("later");
		expect(getHorizon({ role: null, name: "Parking Lot" })).toBe("later");
		expect(getHorizon({ role: null, name: "Custom Column" })).toBe("later");
	});

	it("treats undefined role same as null (falls through to name)", () => {
		expect(getHorizon({ name: "Done" })).toBe("done");
		expect(getHorizon({ name: "Custom Column" })).toBe("later");
	});
});

describe("hasRole", () => {
	it("matches via explicit role first (exact equality)", () => {
		expect(hasRole({ role: "done", name: "Done" }, "done")).toBe(true);
		expect(hasRole({ role: "active", name: "In Progress" }, "active")).toBe(true);
		expect(hasRole({ role: "review", name: "Review" }, "review")).toBe(true);
		expect(hasRole({ role: "backlog", name: "Backlog" }, "backlog")).toBe(true);
		expect(hasRole({ role: "parking", name: "Parking Lot" }, "parking")).toBe(true);
	});

	it("returns false when role is set but doesn't match (no name fallthrough)", () => {
		// Critical: when role IS set, name fallback is skipped. Even if the
		// name "looks like" a Done column, hasRole(_, "done") is false if
		// role !== 'done'. Locks the early-return order.
		expect(hasRole({ role: "active", name: "Done" }, "done")).toBe(false);
	});

	it("falls back to name 'Done' for role='done' when role is null", () => {
		expect(hasRole({ role: null, name: "Done" }, "done")).toBe(true);
		expect(hasRole({ role: null, name: "DONE" }, "done")).toBe(true);
		expect(hasRole({ role: null, name: "Not Done" }, "done")).toBe(false);
	});

	it("falls back to name 'In Progress' for role='active'", () => {
		expect(hasRole({ role: null, name: "In Progress" }, "active")).toBe(true);
		expect(hasRole({ role: null, name: "in progress" }, "active")).toBe(true);
		// Note: "Active" is NOT a name-fallback match (only role match works).
		expect(hasRole({ role: null, name: "Active" }, "active")).toBe(false);
	});

	it("falls back to name 'Review' for role='review'", () => {
		expect(hasRole({ role: null, name: "Review" }, "review")).toBe(true);
		expect(hasRole({ role: null, name: "Code Review" }, "review")).toBe(false);
	});

	it("falls back to name 'Backlog' for role='backlog'", () => {
		expect(hasRole({ role: null, name: "Backlog" }, "backlog")).toBe(true);
		expect(hasRole({ role: null, name: "Backlogged" }, "backlog")).toBe(false);
	});

	it("falls back to name 'Parking Lot' or 'Parking' for role='parking'", () => {
		expect(hasRole({ role: null, name: "Parking Lot" }, "parking")).toBe(true);
		expect(hasRole({ role: null, name: "Parking" }, "parking")).toBe(true);
		expect(hasRole({ role: null, name: "parking lot" }, "parking")).toBe(true);
	});

	it("returns false for unknown roles regardless of name", () => {
		expect(hasRole({ role: null, name: "Done" }, "unknown-role")).toBe(false);
		expect(hasRole({ role: null, name: "Anything" }, "todo")).toBe(false);
	});

	it("treats undefined role same as null (name fallback)", () => {
		expect(hasRole({ name: "Done" }, "done")).toBe(true);
	});
});
