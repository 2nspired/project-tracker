// Tiny inline-svg sparkline used in the board Pulse strip and the project
// Costs page summary. Pure presentational component — feed it a numeric
// series, it renders a polyline + filled area + trailing dot. The width /
// height defaults match the sizing the Pulse strip standardised on
// (48×18, ~thumbnail scale next to a label) so existing callers don't
// shift visually after extraction.
//
// #280 codified the colour API: callers pick a semantic `tone` and the
// component resolves stroke / fill / dot to token-backed utilities
// (`stroke-success`, `stroke-accent-violet`, …) so dark-mode flips for
// free and the "violet = cost" association across BoardPulse / Costs page
// stays consistent.
//
// `cost` maps to the `--accent-violet` token (AI-actor / cost surface
// accent), `success` is the new neutral default (formerly raw
// `stroke-emerald-500`).

export type SparklineTone = "cost" | "success" | "info" | "warning" | "danger";

const TONE_CLASSES: Record<SparklineTone, { stroke: string; fill: string; dot: string }> = {
	cost: {
		stroke: "stroke-accent-violet",
		fill: "fill-accent-violet/10",
		dot: "fill-accent-violet",
	},
	success: {
		stroke: "stroke-success",
		fill: "fill-success/10",
		dot: "fill-success",
	},
	info: {
		stroke: "stroke-info",
		fill: "fill-info/10",
		dot: "fill-info",
	},
	warning: {
		stroke: "stroke-warning",
		fill: "fill-warning/10",
		dot: "fill-warning",
	},
	danger: {
		stroke: "stroke-danger",
		fill: "fill-danger/10",
		dot: "fill-danger",
	},
};

type SparklineProps = {
	data: number[];
	label: string;
	/**
	 * Semantic tone — picks the stroke / fill / trailing-dot colour as a
	 * group. Defaults to `success` (post-#280; was a raw
	 * `stroke-emerald-500` literal pre-#280).
	 */
	tone?: SparklineTone;
	/**
	 * @deprecated Prefer `tone="…"`. Escape hatch for callers that need a
	 * one-off stroke colour outside the semantic palette. Removed once no
	 * production callers remain — currently kept so an external diff doesn't
	 * snap. Pass an arbitrary Tailwind class string (e.g. `stroke-cyan-500`).
	 */
	unsafeStrokeClass?: string;
	/**
	 * @deprecated Prefer `tone="…"`. See `unsafeStrokeClass`.
	 */
	unsafeFillClass?: string;
	/**
	 * @deprecated Prefer `tone="…"`. See `unsafeStrokeClass`.
	 */
	unsafeDotClass?: string;
};

export function Sparkline({
	data,
	label,
	tone = "success",
	unsafeStrokeClass,
	unsafeFillClass,
	unsafeDotClass,
}: SparklineProps) {
	if (data.length === 0) return null;

	const max = Math.max(...data, 1);
	const w = 48;
	const h = 18;
	const padding = 2;
	const innerW = w - padding * 2;
	const innerH = h - padding * 2;

	const points = data
		.map((val, i) => {
			const x = padding + (i / (data.length - 1)) * innerW;
			const y = padding + innerH - (val / max) * innerH;
			return `${x},${y}`;
		})
		.join(" ");

	const firstX = padding;
	const lastX = padding + innerW;
	const fillPoints = `${firstX},${h - padding} ${points} ${lastX},${h - padding}`;

	const palette = TONE_CLASSES[tone];
	const stroke = unsafeStrokeClass ?? palette.stroke;
	const fill = unsafeFillClass ?? palette.fill;
	const dot = unsafeDotClass ?? palette.dot;

	return (
		<svg
			width={w}
			height={h}
			className="shrink-0"
			viewBox={`0 0 ${w} ${h}`}
			role="img"
			aria-label={label}
		>
			<title>{label}</title>
			<polygon points={fillPoints} className={fill} />
			<polyline
				points={points}
				fill="none"
				className={stroke}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle
				cx={padding + innerW}
				cy={padding + innerH - (data[data.length - 1] / max) * innerH}
				r="2"
				className={dot}
			/>
		</svg>
	);
}
