// Unit tests for the pure helpers behind the Costs scope switcher
// (#200 Phase 3). The full Popover/Command UI is wrapped in
// next/navigation hooks (`useRouter`, `usePathname`), which are awkward
// to set up in jsdom — but the load-bearing behavior is the URL
// construction (C1 — the whole point of NOT using `useSearchParams` is
// that the URL is synthesized from `pathname` + the new boardId) and the
// share-percent guard (C3 — the divide-by-zero fix). We test those
// directly.
import { describe, expect, it } from "vitest";

import { buildScopeHref } from "@/components/costs/scope-switcher";
import { formatBoardShare } from "@/components/costs/summary-strip";

describe("buildScopeHref", () => {
	const path = "/projects/abc/costs";

	it("returns the bare pathname when boardId is null", () => {
		expect(buildScopeHref(path, null)).toBe(path);
	});

	it("appends ?board=<id> when boardId is set", () => {
		expect(buildScopeHref(path, "board-xyz")).toBe(`${path}?board=board-xyz`);
	});

	it("URL-encodes board ids that contain reserved characters", () => {
		// Defensive — ids are uuids today, but the helper shouldn't break if
		// that ever changes.
		expect(buildScopeHref(path, "a b/c")).toBe(`${path}?board=a+b%2Fc`);
	});
});

describe("formatBoardShare (C3 guard)", () => {
	it("returns the em-dash placeholder when project total is zero", () => {
		expect(formatBoardShare(0, 0)).toBe("—");
	});

	it("returns the em-dash placeholder when project total is negative (defensive)", () => {
		expect(formatBoardShare(5, -1)).toBe("—");
	});

	it("formats the share to one decimal when project total is positive", () => {
		expect(formatBoardShare(25, 100)).toBe("25.0%");
		expect(formatBoardShare(33.333, 100)).toBe("33.3%");
	});

	it("handles a zero board total gracefully (0.0%, not '—')", () => {
		// Important — board mode with no attributed events but a populated
		// project should still display a real number, not the placeholder.
		// The empty-state branch in <SavingsSection> handles the user-facing
		// messaging; the strip just shows the math.
		expect(formatBoardShare(0, 100)).toBe("0.0%");
	});
});
