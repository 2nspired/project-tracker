// Tiny inline-svg sparkline used in the board Pulse strip and the project
// Costs page summary. Pure presentational component — feed it a numeric
// series, it renders a polyline + filled area + trailing dot. The width /
// height defaults match the sizing the Pulse strip standardised on
// (48×18, ~thumbnail scale next to a label) so existing callers don't
// shift visually after extraction.

type SparklineProps = {
	data: number[];
	strokeClassName?: string;
	fillClassName?: string;
	dotClassName?: string;
	label: string;
};

export function Sparkline({
	data,
	strokeClassName,
	fillClassName,
	dotClassName,
	label,
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

	const stroke = strokeClassName ?? "stroke-emerald-500";
	const fill = fillClassName ?? "fill-emerald-500/10";
	const dot = dotClassName ?? "fill-emerald-500";

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
