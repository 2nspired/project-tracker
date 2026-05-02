"use client";

/**
 * SVG progress ring — a small circular indicator showing completion as a filled arc.
 * Uses stroke-dasharray/offset for the progress arc with a CSS transition.
 */
export function ProgressRing({
	value,
	size = 28,
	strokeWidth = 3,
	className,
}: {
	/** 0–1 completion ratio */
	value: number;
	/** Diameter in px */
	size?: number;
	strokeWidth?: number;
	className?: string;
}) {
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.max(0, Math.min(1, value));
	const offset = circumference * (1 - clamped);

	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
			<title>{Math.round(clamped * 100)}% complete</title>
			{/* Background track */}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				className="text-muted/50"
			/>
			{/* Progress arc */}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeDasharray={circumference}
				strokeDashoffset={offset}
				transform={`rotate(-90 ${size / 2} ${size / 2})`}
				className={
					clamped === 1
						? "text-success transition-[stroke-dashoffset] duration-500"
						: clamped > 0
							? "text-info transition-[stroke-dashoffset] duration-500"
							: "text-muted-foreground/30 transition-[stroke-dashoffset] duration-500"
				}
			/>
			{/* Center percentage text */}
			<text
				x={size / 2}
				y={size / 2}
				textAnchor="middle"
				dominantBaseline="central"
				className="fill-foreground text-[8px] font-medium tabular-nums"
			>
				{Math.round(clamped * 100)}
			</text>
		</svg>
	);
}
