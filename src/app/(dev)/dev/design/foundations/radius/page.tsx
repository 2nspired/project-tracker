export const metadata = { title: "Radius" };

interface RadiusRow {
	cls: string;
	resolved: string;
	usage: string;
	count: string;
}

/**
 * The radius tokens, sourced from `globals.css` (`--radius: 0.5rem` driving
 * `--radius-sm/md/lg/xl`). Counts are eyeballed against the codebase via
 * grep at PR-write time — they're a freshness signal, not a contract.
 */
const ROWS: RadiusRow[] = [
	{
		cls: "rounded-sm",
		resolved: "calc(0.5rem - 4px) ≈ 4px",
		usage: "Tiny ornaments — color-swatch tile inside a chip, sparkline-tooltip rect.",
		count: "≈ 9 uses",
	},
	{
		cls: "rounded-md",
		resolved: "calc(0.5rem - 2px) ≈ 6px",
		usage: "Buttons, segmented controls, table-wrap borders, Costs-section frame.",
		count: "≈ 59 uses (highest-volume token)",
	},
	{
		cls: "rounded-lg",
		resolved: "0.5rem (8px)",
		usage:
			'Board card, section panel inside `/dev/design`, generic `<div className="rounded-lg border">` containers.',
		count: "≈ 45 uses",
	},
	{
		cls: "rounded-xl",
		resolved: "calc(0.5rem + 4px) ≈ 12px",
		usage: "shadcn `<Card>` only — the design-system tile silhouette.",
		count: "2 uses (intentionally rare)",
	},
	{
		cls: "rounded-full",
		resolved: "9999px",
		usage: "Badges, dots, avatars, user-pickable color swatches, segmented-control filter chip.",
		count: "≈ 53 uses",
	},
];

/**
 * Foundations / Radius — the four tokens + `rounded-full`.
 *
 * Pattern reference: shadcn's `--radius` model (single anchor token,
 * `sm/md/lg/xl` derived as `calc(--radius ± 2/4px)`). The doc surface is
 * lifted from Linear's foundations page — render every silhouette at the
 * same dimensions so the eye picks up the rhythm difference, then call out
 * which UI element each one binds to.
 *
 * **The honest part:** Pigeon ships three card densities simultaneously —
 *
 * - `<Card>` (shadcn / `rounded-xl`, 12px) — design-system tile, dialog frame.
 * - `<BoardCard>` (`rounded-lg`, 8px) — kanban board.
 * - Costs section (`rounded-md`, 6px) — `<SavingsSection>` /
 *   `<PigeonOverheadSection>` / `<PricingOverrideTable>` row groupings.
 *
 * Three intentional silhouettes — the tile is the largest, the kanban card
 * sits in the middle, the data section is the tightest. Don't unify them;
 * the difference is doing visual work (signaling "this is a card you act
 * on" vs "this is a data panel").
 */
export default function RadiusPage() {
	return (
		<div className="flex flex-col gap-10">
			<header className="flex flex-col gap-3 border-b pb-6">
				<span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Foundations
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Radius</h1>
				<p className="max-w-2xl text-muted-foreground">
					Four tokens (
					<code className="rounded bg-muted px-1 font-mono text-xs">--radius-sm/md/lg/xl</code>)
					plus <code className="rounded bg-muted px-1 font-mono text-xs">rounded-full</code>, all
					derived from a single{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">--radius</code> anchor (
					<code className="rounded bg-muted px-1 font-mono text-xs">0.5rem</code>) per the shadcn
					model.
				</p>
			</header>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">The scale</h2>
				<div className="flex flex-wrap items-end gap-6 rounded-lg border bg-card p-6">
					{ROWS.map((row) => (
						<div key={row.cls} className="flex flex-col items-center gap-2">
							<div className={`size-20 border bg-muted ${row.cls}`} aria-hidden />
							<code className="font-mono text-2xs text-muted-foreground">{row.cls}</code>
						</div>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Token + intent</h2>
				<div className="overflow-hidden rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead className="bg-muted/40">
							<tr className="text-left">
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Token
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Resolved
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Used for
								</th>
								<th className="px-3 py-2 font-mono text-2xs font-medium tracking-wide text-muted-foreground uppercase">
									Volume
								</th>
							</tr>
						</thead>
						<tbody>
							{ROWS.map((row) => (
								<tr key={row.cls} className="border-t border-border/60 align-top">
									<td className="px-3 py-2 font-mono text-2xs text-muted-foreground">{row.cls}</td>
									<td className="px-3 py-2 font-mono text-2xs text-muted-foreground tabular-nums">
										{row.resolved}
									</td>
									<td className="px-3 py-2 text-sm">{row.usage}</td>
									<td className="px-3 py-2 font-mono text-2xs text-muted-foreground tabular-nums">
										{row.count}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">
					The three card densities (intentional)
				</h2>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Pigeon ships three card silhouettes side-by-side — they're not a regression. The rounding
					gradient (12 → 8 → 6) signals affordance: the design tile invites a tap, the kanban card
					expects a drag, the data panel is a backdrop for numbers. Don't unify them.
				</p>
				<div className="grid gap-4 sm:grid-cols-3">
					<div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
						<code className="font-mono text-2xs text-muted-foreground">
							rounded-xl · shadcn Card
						</code>
						<div className="text-sm font-medium">Design-system tile</div>
						<div className="text-xs text-muted-foreground">
							Used by `&lt;Card&gt;` — design landing, dialogs, the design-system primitive frame.
							Largest radius reads as "interactive object."
						</div>
					</div>
					<div className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm">
						<code className="font-mono text-2xs text-muted-foreground">rounded-lg · BoardCard</code>
						<div className="text-sm font-medium">Kanban card</div>
						<div className="text-xs text-muted-foreground">
							Used by `&lt;BoardCard&gt;` and the matching `&lt;CardSkeleton&gt;`. Mid radius —
							draggable, but less assertive than the tile.
						</div>
					</div>
					<div className="flex flex-col gap-3 rounded-md border bg-muted/20 px-4 py-3">
						<code className="font-mono text-2xs text-muted-foreground">
							rounded-md · Costs section
						</code>
						<div className="text-sm font-medium">Data panel</div>
						<div className="text-xs text-muted-foreground">
							Used by `&lt;SavingsSection&gt;`, `&lt;PigeonOverheadSection&gt;`, the
							pricing-override frame. Tightest radius — non-interactive backdrop for tables.
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
