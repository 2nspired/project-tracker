// Smoke tests for the Costs breadcrumb (#200 Phase 3). The interesting
// behavior is hide-when-≤1: when the project has zero or one boards, the
// scope segment must not render — the switcher would have nothing useful
// to do, and rendering it would regress into v1's "free-floating right"
// layout we explicitly rejected (D1).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CostsBreadcrumb } from "@/components/costs/breadcrumb";

// next/navigation hooks need to be stubbed for the embedded
// <ScopeSwitcher>; the breadcrumb itself only uses next/link.
vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
	usePathname: () => "/projects/abc/costs",
}));

describe("<CostsBreadcrumb>", () => {
	it("renders only Project Tracker / Costs when boards.length === 0", () => {
		render(<CostsBreadcrumb projectId="abc" boards={[]} currentBoardId={null} />);
		expect(screen.getByText("Project Tracker")).toBeDefined();
		expect(screen.getByText("Costs")).toBeDefined();
		// Switcher trigger labels start with "All boards" or "Board · "
		expect(screen.queryByText(/^All boards$/)).toBeNull();
		expect(screen.queryByText(/^Board · /)).toBeNull();
	});

	it("renders only Project Tracker / Costs when boards.length === 1 (D1 hide rule)", () => {
		render(
			<CostsBreadcrumb
				projectId="abc"
				boards={[{ id: "b1", name: "Adoption" }]}
				currentBoardId={null}
			/>
		);
		expect(screen.getByText("Project Tracker")).toBeDefined();
		expect(screen.getByText("Costs")).toBeDefined();
		expect(screen.queryByText(/^All boards$/)).toBeNull();
	});

	it("renders the scope switcher when boards.length > 1", () => {
		render(
			<CostsBreadcrumb
				projectId="abc"
				boards={[
					{ id: "b1", name: "Adoption" },
					{ id: "b2", name: "Token Tracking" },
				]}
				currentBoardId={null}
			/>
		);
		expect(screen.getByText("All boards")).toBeDefined();
	});

	it("shows the active board name in the switcher trigger when in board mode", () => {
		render(
			<CostsBreadcrumb
				projectId="abc"
				boards={[
					{ id: "b1", name: "Adoption" },
					{ id: "b2", name: "Token Tracking" },
				]}
				currentBoardId="b2"
			/>
		);
		expect(screen.getByText("Board · Token Tracking")).toBeDefined();
	});
});
