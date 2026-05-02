import { ColorsGrid } from "@/components/design-system/colors-grid";

export const metadata = {
	title: "Colors",
};

/**
 * Foundations / Colors — every CSS color token in `globals.css` rendered as a
 * swatch in both light and dark, with click-to-copy on the var ref and the
 * resolved value.
 *
 * Pattern reference: GitHub Primer's `primer.style/foundations/color` page is
 * the canonical "swatch grid + value + copy" pattern. We lift the structure
 * and pair it with Linear's side-by-side light/dark column treatment so a
 * reviewer can verify both modes without toggling.
 */
export default function ColorsPage() {
	return (
		<div className="flex flex-col gap-8">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Foundations
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Colors</h1>
				<p className="max-w-2xl text-muted-foreground">
					Every Pigeon color token, sourced from{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
						src/app/globals.css
					</code>{" "}
					and resolved at runtime via{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">getComputedStyle</code>.
					Click any tile to copy its{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">var(--name)</code>{" "}
					reference; click the value row to copy the resolved color string. Light and dark are shown
					side-by-side so contrast and parity are reviewable in a glance.
				</p>
			</header>
			<ColorsGrid />
		</div>
	);
}
