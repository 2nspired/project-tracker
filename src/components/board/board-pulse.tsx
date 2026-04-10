"use client";

import { Activity, AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";

import { api } from "@/trpc/react";

function Sparkline({ data }: { data: number[] }) {
	if (data.length === 0) return null;

	const max = Math.max(...data, 1); // at least 1 to avoid division by zero
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

	// Fill area under the line
	const firstX = padding;
	const lastX = padding + innerW;
	const fillPoints = `${firstX},${h - padding} ${points} ${lastX},${h - padding}`;

	return (
		<svg
			width={w}
			height={h}
			className="shrink-0"
			viewBox={`0 0 ${w} ${h}`}
			role="img"
			aria-label="Throughput sparkline"
		>
			<title>Throughput sparkline</title>
			<polygon points={fillPoints} className="fill-emerald-500/10" />
			<polyline
				points={points}
				fill="none"
				className="stroke-emerald-500"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			{/* Dot on the latest value */}
			{data.length > 0 && (
				<circle
					cx={padding + innerW}
					cy={padding + innerH - (data[data.length - 1] / max) * innerH}
					r="2"
					className="fill-emerald-500"
				/>
			)}
		</svg>
	);
}

function formatHours(hours: number): string {
	if (hours < 1) return `${Math.round(hours * 60)}m`;
	if (hours < 24) return `${hours}h`;
	const days = Math.round((hours / 24) * 10) / 10;
	return `${days}d`;
}

export function BoardPulse({ boardId }: { boardId: string }) {
	const { data: metrics } = api.activity.flowMetrics.useQuery(
		{ boardId },
		{ staleTime: 60_000 } // refresh at most every minute
	);

	if (!metrics) return null;

	const totalCompleted = metrics.throughput.reduce((a, b) => a + b, 0);
	const hasAnyData =
		totalCompleted > 0 ||
		metrics.forwardMoves > 0 ||
		metrics.backwardMoves > 0 ||
		metrics.bottleneck !== null;

	if (!hasAnyData) return null;

	return (
		<div className="flex items-center gap-4 border-b bg-muted/20 px-4 py-1.5 text-[11px]">
			<span className="flex items-center gap-1.5 text-muted-foreground">
				<Activity className="h-3 w-3" />
				Pulse
			</span>

			{/* Throughput sparkline */}
			<div
				className="flex items-center gap-1.5"
				title={`${totalCompleted} cards completed this week`}
			>
				<Sparkline data={metrics.throughput} />
				<span className="tabular-nums text-muted-foreground">
					<span className="font-medium text-foreground">{totalCompleted}</span> done
				</span>
			</div>

			{/* Flow balance */}
			<div className="flex items-center gap-2 text-muted-foreground">
				<span
					className="flex items-center gap-0.5 text-emerald-500"
					title={`${metrics.forwardMoves} forward moves`}
				>
					<ArrowRight className="h-3 w-3" />
					<span className="tabular-nums">{metrics.forwardMoves}</span>
				</span>
				{metrics.backwardMoves > 0 && (
					<span
						className="flex items-center gap-0.5 text-orange-500"
						title={`${metrics.backwardMoves} regressions`}
					>
						<ArrowLeft className="h-3 w-3" />
						<span className="tabular-nums">{metrics.backwardMoves}</span>
					</span>
				)}
			</div>

			{/* Bottleneck */}
			{metrics.bottleneck && (
				<div
					className="flex items-center gap-1 text-muted-foreground"
					title={`Cards spend an average of ${formatHours(metrics.bottleneck.avgHours)} in ${metrics.bottleneck.column}`}
				>
					<AlertTriangle className="h-3 w-3 text-amber-500" />
					<span>
						{metrics.bottleneck.column}{" "}
						<span className="font-medium text-amber-500 tabular-nums">
							~{formatHours(metrics.bottleneck.avgHours)}
						</span>{" "}
						avg
					</span>
				</div>
			)}
		</div>
	);
}
