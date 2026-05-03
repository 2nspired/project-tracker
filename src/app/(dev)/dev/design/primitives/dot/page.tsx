import { Dot, type DotSize, type DotTone } from "@/components/ui/dot";

export const metadata = { title: "Dot" };

const TONES: DotTone[] = ["agent", "success", "warning", "danger", "info", "neutral"];
const SIZES: DotSize[] = ["sm", "md"];

/**
 * Showcase for `<Dot>` (#280) — the unified semantic status dot. Replaces
 * the inline `<span size-2 rounded-full bg-…>` pattern (most notably
 * `<ViolaDot>` in the Costs scope switcher) and pairs with
 * `<Sparkline tone="cost">` to keep the "violet = cost / agent" signal
 * consistent across surfaces.
 */
export default function DotShowcasePage() {
	return (
		<div className="flex flex-col gap-10">
			<div className="flex flex-col gap-3">
				<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Primitive
				</span>
				<h1 className="text-3xl font-semibold tracking-tight">Dot</h1>
				<p className="max-w-2xl text-muted-foreground">
					Tiny semantic status indicator. Pick a <code className="rounded bg-muted px-1">tone</code>
					and the dot resolves to a token-backed background utility — no raw palette steps. Mirrors
					the tone-map convention in{" "}
					<code className="rounded bg-muted px-1">priority-colors.ts</code>.
				</p>
			</div>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Tones</h2>
				<div className="flex flex-wrap gap-6 rounded-lg border bg-card p-6">
					{TONES.map((tone) => (
						<div key={tone} className="flex flex-col items-center gap-2">
							<Dot tone={tone} />
							<code className="font-mono text-2xs text-muted-foreground">{tone}</code>
						</div>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Sizes</h2>
				<div className="flex flex-wrap items-center gap-6 rounded-lg border bg-card p-6">
					{SIZES.map((size) => (
						<div key={size} className="flex items-center gap-2">
							<Dot tone="agent" size={size} />
							<code className="font-mono text-2xs text-muted-foreground">size="{size}"</code>
						</div>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<h2 className="text-lg font-medium tracking-tight">Inline usage</h2>
				<div className="flex flex-col gap-3 rounded-lg border bg-card p-6 text-sm">
					<div className="flex items-center gap-2">
						<Dot tone="agent" size="sm" aria-label="AI agent" />
						<span>AI agent attribution</span>
					</div>
					<div className="flex items-center gap-2">
						<Dot tone="success" />
						<span>Healthy / done</span>
					</div>
					<div className="flex items-center gap-2">
						<Dot tone="warning" />
						<span>Stale / regression</span>
					</div>
					<div className="flex items-center gap-2">
						<Dot tone="danger" />
						<span>Blocked / urgent</span>
					</div>
					<div className="flex items-center gap-2">
						<Dot tone="info" />
						<span>Now / informational</span>
					</div>
				</div>
			</section>
		</div>
	);
}
