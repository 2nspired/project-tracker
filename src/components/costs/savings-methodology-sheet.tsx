"use client";

import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { formatRelative } from "@/lib/format-date";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

type SavingsSummary = RouterOutputs["tokenUsage"]["getSavingsSummary"];

type Props = {
	projectId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	summary: SavingsSummary;
};

// Trust anchor for the savings headline — the spec calls methodology
// "first-class, a Sheet not a tooltip". Four numbered sections mirroring
// `<Section>` styling from the token-tracking-setup-dialog so the
// editorial procedure carries across surfaces:
//   01 — Baseline measurement (raw tokens + when measured)
//   02 — Per-session math (formula, plain prose)
//   03 — Conservative framing (assumptions, negative case copy)
//   04 — Recalibrate baseline (live mutation button)
//
// Mobile uses bottom Sheet to match `TokenTrackingSetupDialog`.
export function SavingsMethodologySheet({ projectId, open, onOpenChange, summary }: Props) {
	const isDesktop = useMediaQuery("(min-width: 640px)");

	const body = <Body projectId={projectId} summary={summary} />;

	if (isDesktop) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="gap-0 p-0 sm:max-w-2xl">
					<DialogHeader className="space-y-2 border-b px-6 py-5">
						<DialogTitle className="text-base font-semibold tracking-tight">
							Savings methodology
						</DialogTitle>
						<DialogDescription className="sr-only">
							How Pigeon calculates the "paid for itself" headline — baseline measurement,
							per-session math, conservative framing, and the Recalibrate baseline action.
						</DialogDescription>
					</DialogHeader>
					<div className="px-6 py-5">{body}</div>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom" className="max-h-[92vh] gap-0 overflow-y-auto p-0">
				<SheetHeader className="space-y-2 border-b px-5 py-4">
					<SheetTitle className="text-base font-semibold tracking-tight">
						Savings methodology
					</SheetTitle>
					<SheetDescription className="sr-only">
						How Pigeon calculates the "paid for itself" headline — baseline measurement, per-session
						math, conservative framing, and the Recalibrate baseline action.
					</SheetDescription>
				</SheetHeader>
				<div className="px-5 py-4">{body}</div>
			</SheetContent>
		</Sheet>
	);
}

// ─── Body ──────────────────────────────────────────────────────────

function Body({ projectId, summary }: { projectId: string; summary: SavingsSummary }) {
	return (
		<div className="space-y-5">
			<BaselineSection summary={summary} />
			<MathSection />
			<ConservativeSection summary={summary} />
			<RecalibrateSection projectId={projectId} hasBaseline={summary.state === "ready"} />
		</div>
	);
}

// ─── 01 — Baseline measurement ─────────────────────────────────────

function BaselineSection({ summary }: { summary: SavingsSummary }) {
	if (summary.state === "no-baseline") {
		return (
			<Section step="01" title="Baseline measurement">
				<p className="text-xs text-muted-foreground">
					No baseline measured yet. Click <span className="font-medium">Recalibrate baseline</span>{" "}
					below to take the first measurement — it compares the briefMe payload against a naive
					"load the whole board" bootstrap.
				</p>
			</Section>
		);
	}

	const { measuredAt, naiveBootstrapTokens, briefMeTokens } = summary.baseline;

	return (
		<Section step="01" title="Baseline measurement">
			<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-2xs">
				<DiagnosticRow label="measured" value={formatRelative(measuredAt)} />
				<DiagnosticRow label="naiveBootstrapTokens" value={naiveBootstrapTokens.toLocaleString()} />
				<DiagnosticRow label="briefMeTokens" value={briefMeTokens.toLocaleString()} />
			</dl>
			<p className="text-xs text-muted-foreground">
				Measured by <InlineCode>recalibrateBaseline</InlineCode>. Naive ={" "}
				<InlineCode>getBoard</InlineCode> + <InlineCode>getLatestHandoff</InlineCode> response
				sizes. briefMe = actual <InlineCode>briefMe</InlineCode> response for this project.
			</p>
		</Section>
	);
}

// ─── 02 — Per-session math ─────────────────────────────────────────

function MathSection() {
	return (
		<Section step="02" title="Per-session math">
			<p className="text-xs text-foreground/85">
				<span className="font-mono text-foreground">
					(naiveBootstrapTokens − briefMeTokens) × [model output rate] × briefMe calls
				</span>{" "}
				= gross savings.
			</p>
			<p className="text-xs text-muted-foreground">
				Subtract total Pigeon tool overhead (every tool response × the session's output rate) to get
				net savings. Anthropic bills the assistant turn that emits a tool result against{" "}
				<InlineCode>outputPerMTok</InlineCode>, so we use that same rate on both sides.
			</p>
		</Section>
	);
}

// ─── 03 — Conservative framing ─────────────────────────────────────

function ConservativeSection({ summary }: { summary: SavingsSummary }) {
	const negative = summary.state === "ready" && summary.netSavingsUsd < 0;

	return (
		<Section step="03" title="Conservative framing">
			<ul className="space-y-1.5 text-xs text-muted-foreground">
				<li className="flex items-start gap-2">
					<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
					<span>
						We assume <span className="text-foreground/85">one</span> briefMe-equivalent rebuild per
						session. Multi-resume sessions usually save more than this lower bound shows.
					</span>
				</li>
				<li className="flex items-start gap-2">
					<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
					<span>
						The dollar rate is the project's <span className="text-foreground/85">primary</span>{" "}
						model — the model used in the most recent recorded session. Sessions that ran on a
						cheaper model in the past are still priced at the current primary rate.
					</span>
				</li>
				<li className="flex items-start gap-2">
					<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
					<span>
						Actual savings depend on your workflow. We surface the net number — including when it
						goes negative — instead of marketing the gross.
					</span>
				</li>
			</ul>
			{negative && (
				<div className="rounded-md border-l-2 border-l-amber-500 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
					Your current net is negative. Increasing briefMe call frequency or reducing unnecessary
					tool calls can reverse this.
				</div>
			)}
		</Section>
	);
}

// ─── 04 — Recalibrate ──────────────────────────────────────────────

function RecalibrateSection({
	projectId,
	hasBaseline,
}: {
	projectId: string;
	hasBaseline: boolean;
}) {
	const utils = api.useUtils();
	const mutation = api.tokenUsage.recalibrateBaseline.useMutation({
		onSuccess: async () => {
			toast.success("Baseline recalibrated");
			await utils.tokenUsage.getSavingsSummary.invalidate({ projectId });
		},
		onError: (error) => {
			toast.error(`Could not recalibrate — ${error.message}`);
		},
	});

	return (
		<Section step="04" title="Recalibrate baseline">
			<p className="text-xs text-muted-foreground">
				{hasBaseline
					? "Take a fresh measurement against the current board state. Existing baseline is overwritten."
					: "Take the first measurement to start tracking savings on this project."}
			</p>
			<div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => mutation.mutate({ projectId })}
					disabled={mutation.isPending}
					className="font-mono text-2xs"
				>
					<RefreshCw className={cn("h-3 w-3", mutation.isPending && "animate-spin")} />
					{mutation.isPending ? "Measuring…" : "Recalibrate baseline"}
				</Button>
			</div>
		</Section>
	);
}

// ─── Section frame (mirrors token-tracking-setup-dialog) ───────────

function StepLabel({ n }: { n: string }) {
	return <span className="font-mono text-2xs text-muted-foreground/60 tabular-nums">{n}</span>;
}

function Section({ step, title, children }: { step: string; title: string; children: ReactNode }) {
	return (
		<section className="space-y-2.5 border-t border-border/50 pt-4 first:border-t-0 first:pt-0">
			<div className="flex items-baseline gap-2.5">
				<StepLabel n={step} />
				<h3 className="text-sm font-medium tracking-tight">{title}</h3>
			</div>
			{children}
		</section>
	);
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
	return (
		<>
			<dt className="text-muted-foreground/70">
				<span className="text-muted-foreground/40">›</span> {label}
			</dt>
			<dd className="tabular-nums text-foreground">{value}</dd>
		</>
	);
}

function InlineCode({ children }: { children: ReactNode }) {
	return (
		<code className="rounded bg-muted/70 px-1 py-px font-mono text-2xs text-foreground/85">
			{children}
		</code>
	);
}
