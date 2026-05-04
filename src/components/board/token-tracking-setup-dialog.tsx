"use client";

import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { StepSection } from "@/components/ui/step-section";
import { formatRelative } from "@/lib/format-date";
import {
	buildTokenTrackingHookSnippet,
	COST_TRACKING_DOCS_URL,
	TOKEN_TRACKING_DOCS_URL,
	TOKEN_TRACKING_HOOK_SCRIPT_PLACEHOLDER,
} from "@/lib/token-tracking-docs";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

type Diagnostics = RouterOutputs["tokenUsage"]["getDiagnostics"];

type SetupState = "loading" | "not-configured" | "no-events" | "stale" | "working";

// Aesthetic vocabulary for this dialog: developer-tool ledger. Dense
// monospace, status as colored left strips and tiny mono badges, code
// snippet treated as an editor block with a "tab" header showing the
// destination path.

// All inline mentions go through `<InlineCode>` so paths, JSON keys, and
// hint anchors render at one consistent weight instead of inheriting the
// browser default `<code>` styling.
function InlineCode({ children }: { children: ReactNode }) {
	return (
		<code className="rounded bg-muted/70 px-1 py-px font-mono text-2xs text-foreground/85">
			{children}
		</code>
	);
}

// ─── Status palette ────────────────────────────────────────────────

const STATE_STYLE: Record<
	SetupState,
	{ label: string; tone: string; dot: string; border: string; pill: string }
> = {
	loading: {
		label: "Checking",
		tone: "text-muted-foreground",
		dot: "bg-muted-foreground/40",
		border: "border-l-muted-foreground/40",
		pill: "border-border bg-muted/40 text-muted-foreground",
	},
	"not-configured": {
		label: "Not configured",
		tone: "text-muted-foreground",
		dot: "bg-muted-foreground/40",
		border: "border-l-muted-foreground/40",
		pill: "border-border bg-muted/40 text-muted-foreground",
	},
	"no-events": {
		label: "Awaiting first event",
		tone: "text-warning",
		dot: "bg-warning",
		border: "border-l-warning",
		pill: "border-warning/40 bg-warning/10 text-warning",
	},
	stale: {
		label: "Stale",
		tone: "text-warning",
		dot: "bg-warning",
		border: "border-l-warning",
		pill: "border-warning/40 bg-warning/10 text-warning",
	},
	working: {
		label: "Recording",
		tone: "text-success",
		dot: "bg-success",
		border: "border-l-success",
		pill: "border-success/40 bg-success/10 text-success",
	},
};

function StatePill({ state }: { state: SetupState }) {
	const s = STATE_STYLE[state];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-2xs uppercase tracking-wide",
				s.pill
			)}
		>
			<span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
			{s.label}
		</span>
	);
}

function deriveState(d: Diagnostics | undefined): SetupState {
	if (!d) return "loading";
	const hasHook = d.configPaths.some((c) => c.hasHook);
	if (!hasHook) return "not-configured";
	if (d.eventCount === 0 || !d.lastEventAt) return "no-events";
	const ageMs = Date.now() - new Date(d.lastEventAt).getTime();
	return ageMs > 7 * 24 * 60 * 60 * 1000 ? "stale" : "working";
}

// ─── Dialog shell ──────────────────────────────────────────────────

type TokenTrackingSetupDialogProps = {
	/** Render-prop trigger so callers control the visual affordance. */
	trigger: ReactNode;
};

export function TokenTrackingSetupDialog({ trigger }: TokenTrackingSetupDialogProps) {
	const [open, setOpen] = useState(false);
	const isDesktop = useMediaQuery("(min-width: 640px)");

	if (isDesktop) {
		return (
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>{trigger}</DialogTrigger>
				<DialogContent className="gap-0 p-0 sm:max-w-2xl">
					<DialogHeaderArea>
						<SetupDialogHeaderInner enabled={open} />
					</DialogHeaderArea>
					<div className="px-6 py-5">
						<SetupDialogBody enabled={open} />
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>{trigger}</SheetTrigger>
			<SheetContent side="bottom" className="max-h-[92vh] gap-0 overflow-y-auto p-0">
				<MobileHeaderArea>
					<SetupDialogHeaderInner enabled={open} mobile />
				</MobileHeaderArea>
				<div className="px-5 py-4">
					<SetupDialogBody enabled={open} />
				</div>
			</SheetContent>
		</Sheet>
	);
}

// ─── Headers ───────────────────────────────────────────────────────

function DialogHeaderArea({ children }: { children: ReactNode }) {
	return (
		<DialogHeader className="space-y-2 border-b px-6 py-5">
			<DialogTitle className="sr-only">Set up token tracking</DialogTitle>
			<DialogDescription className="sr-only">
				Add a Stop hook so Claude Code reports per-session token usage when each session ends.
			</DialogDescription>
			{children}
		</DialogHeader>
	);
}

function MobileHeaderArea({ children }: { children: ReactNode }) {
	return (
		<SheetHeader className="space-y-2 border-b px-5 py-4">
			<SheetTitle className="sr-only">Set up token tracking</SheetTitle>
			<SheetDescription className="sr-only">
				Add a Stop hook so Claude Code reports per-session token usage when each session ends.
			</SheetDescription>
			{children}
		</SheetHeader>
	);
}

function SetupDialogHeaderInner({ enabled, mobile }: { enabled: boolean; mobile?: boolean }) {
	const { data } = api.tokenUsage.getDiagnostics.useQuery(undefined, {
		enabled,
		staleTime: 0,
	});
	const state = deriveState(data);

	return (
		<>
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<div className="font-mono text-2xs uppercase tracking-[0.18em] text-muted-foreground/70">
						Token tracking
					</div>
					<h2 className={cn("font-semibold tracking-tight", mobile ? "text-base" : "text-lg")}>
						Set up the Claude Code Stop hook
					</h2>
				</div>
				<StatePill state={state} />
			</div>
			<p className="text-xs text-muted-foreground">
				Tracking is opt-in. Pigeon never reads transcripts on its own — the hook below tells Claude
				Code to report usage when each session ends.
			</p>
		</>
	);
}

// ─── Body ──────────────────────────────────────────────────────────

function SetupDialogBody({ enabled }: { enabled: boolean }) {
	const { data, refetch, isFetching } = api.tokenUsage.getDiagnostics.useQuery(undefined, {
		enabled,
		staleTime: 0,
	});
	const state = deriveState(data);

	return (
		<div className="space-y-5">
			<HookSnippetSection diagnostics={data} />
			<ConfigPathsSection diagnostics={data} />
			<VerifySection
				diagnostics={data}
				state={state}
				onRefresh={() => refetch()}
				refreshing={isFetching}
			/>
			<ReadMoreFooter />
		</div>
	);
}

// ─── 01 — The hook (editor-tab styled snippet) ─────────────────────

function HookSnippetSection({ diagnostics }: { diagnostics: Diagnostics | undefined }) {
	const [copied, setCopied] = useState(false);

	const scriptPath = diagnostics?.recommendedHookCommand ?? TOKEN_TRACKING_HOOK_SCRIPT_PLACEHOLDER;
	const snippet = buildTokenTrackingHookSnippet(scriptPath);

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(snippet);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard can fail in non-secure contexts. Snippet stays selectable.
		}
	};

	// Prefer an already-configured path so the snippet header matches the file
	// the user is actually using; fall back to a user-level existing file
	// (recommended target), then any existing file.
	const configPaths = diagnostics?.configPaths ?? [];
	const targetPath =
		configPaths.find((c) => c.exists && c.hasHook)?.path ??
		configPaths.find((c) => c.exists && c.scope === "user")?.path ??
		configPaths.find((c) => c.exists)?.path;

	return (
		<StepSection step="01" title="The hook" flush>
			<div className="overflow-hidden rounded-md border bg-card">
				<div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
					<span className="font-mono text-2xs uppercase tracking-wide text-muted-foreground/70">
						json
					</span>
					<span className="font-mono text-2xs text-muted-foreground/40">·</span>
					<span className="truncate font-mono text-2xs text-muted-foreground/80">
						{targetPath ? abbreviateHome(targetPath) : "settings.json"}
					</span>
					<button
						type="button"
						onClick={onCopy}
						className="ml-auto inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground"
					>
						{copied ? (
							<>
								<Check className="h-3 w-3 text-success" />
								copied
							</>
						) : (
							<>
								<Copy className="h-3 w-3" />
								copy
							</>
						)}
					</button>
				</div>
				<pre className="overflow-x-auto whitespace-pre px-3 py-3 font-mono text-2xs leading-snug text-foreground/90">
					{snippet}
				</pre>
			</div>
			<p className="text-xs text-muted-foreground">
				Sub-agent transcripts at{" "}
				<InlineCode>&lt;dirname&gt;/&lt;sessionId&gt;/subagents/agent-*.jsonl</InlineCode> are
				aggregated alongside the parent automatically.
			</p>
		</StepSection>
	);
}

// ─── 02 — Where it goes (file + merge guidance) ────────────────────
//
// Three rendering states, ordered by user concern:
//
//   (A) `someConfigured && someUserConfigured` — user-level hook is in place,
//       tracking is global. Show only the configured row(s); no nag copy.
//
//   (B) `someConfigured && !someUserConfigured` — only a project-scoped hook
//       fires. Tracking works in this repo but every other repo will re-prompt
//       this dialog. Show the configured project row + a one-line nudge to
//       run `scripts/connect.sh` so the global path is also wired.
//
//   (C) `!someConfigured` — nothing is configured. Show paste targets, with
//       user-level rows first labeled as the recommended target, and project
//       rows below labeled as "this project only". Empty-tree branch (no
//       existing files at all) renders a help block.

function ConfigPathRow({
	c,
	mode,
}: {
	c: Diagnostics["configPaths"][number];
	mode: "configured" | "needs-paste";
}) {
	return (
		<li key={c.path} className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2">
			<span
				className={cn(
					"h-1.5 w-1.5 shrink-0 rounded-full",
					mode === "configured" ? "bg-success" : "bg-muted-foreground/40"
				)}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<code className="min-w-0 truncate font-mono text-2xs text-foreground/90">{c.path}</code>
				<span className="font-mono text-2xs text-muted-foreground/60">
					{c.scope === "user" ? "user-level — covers all projects" : "this project only"}
				</span>
			</div>
			<span
				className={cn(
					"shrink-0 font-mono text-2xs uppercase tracking-wide",
					mode === "configured" ? "text-success" : "text-muted-foreground"
				)}
			>
				{mode === "configured" ? "configured" : "needs paste"}
			</span>
		</li>
	);
}

function ConfigPathsSection({ diagnostics }: { diagnostics: Diagnostics | undefined }) {
	if (!diagnostics) {
		return (
			<StepSection step="02" title="Where it goes" flush>
				<p className="text-xs text-muted-foreground">Looking for your Claude Code config…</p>
			</StepSection>
		);
	}

	const existing = diagnostics.configPaths.filter((c) => c.exists);
	const configured = existing.filter((c) => c.hasHook);
	const userConfigured = configured.some((c) => c.scope === "user");

	// State (A) — user-level configured, no nag.
	if (userConfigured) {
		return (
			<StepSection step="02" title="Where it goes" flush>
				<ul className="space-y-1.5">
					{configured.map((c) => (
						<ConfigPathRow key={c.path} c={c} mode="configured" />
					))}
				</ul>
			</StepSection>
		);
	}

	// State (B) — only project-scoped hook found. Tracking works here but
	// other repos will re-prompt; surface the connect.sh fix.
	if (configured.length > 0) {
		return (
			<StepSection step="02" title="Where it goes" flush>
				<ul className="space-y-1.5">
					{configured.map((c) => (
						<ConfigPathRow key={c.path} c={c} mode="configured" />
					))}
				</ul>
				<div className="rounded-md border-l-2 border-l-warning/60 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
					Configured for this repo only — every other project you open will re-prompt this dialog.
					To globalize, run <InlineCode>scripts/connect.sh</InlineCode> from this repo root: it
					merges the Stop hook into <InlineCode>~/.claude-alt/settings.json</InlineCode>{" "}
					idempotently and covers every connected project at once.
				</div>
			</StepSection>
		);
	}

	// State (C) — nothing configured anywhere. Help users pick the right
	// paste target by sorting user-level (recommended) above project-level.
	if (existing.length === 0) {
		return (
			<StepSection step="02" title="Where it goes" flush>
				<div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
					No <InlineCode>settings.json</InlineCode> found at the standard Claude Code locations
					(user-level <InlineCode>~/.claude/settings.json</InlineCode>, project-level{" "}
					<InlineCode>.claude/settings.json</InlineCode>, or per-machine{" "}
					<InlineCode>.claude/settings.local.json</InlineCode>). Create the user-level file and
					paste the snippet into its top-level <InlineCode>hooks</InlineCode> field — that wires
					tracking for every project at once.
				</div>
			</StepSection>
		);
	}

	const sorted = [
		...existing.filter((c) => c.scope === "user"),
		...existing.filter((c) => c.scope === "project"),
	];

	return (
		<StepSection step="02" title="Where it goes" flush>
			<ul className="space-y-1.5">
				{sorted.map((c) => (
					<ConfigPathRow key={c.path} c={c} mode="needs-paste" />
				))}
			</ul>
			<div className="rounded-md border-l-2 border-l-muted-foreground/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
				Paste the snippet into the top-level <InlineCode>hooks</InlineCode> field of the user-level
				file (recommended — covers all projects). If <InlineCode>hooks</InlineCode> already exists,
				merge the <InlineCode>Stop</InlineCode> entry into it instead of replacing the whole object.
			</div>
		</StepSection>
	);
}

// ─── 03 — Verify (terminal-readout style) ──────────────────────────

function VerifySection({
	diagnostics,
	state,
	onRefresh,
	refreshing,
}: {
	diagnostics: Diagnostics | undefined;
	state: SetupState;
	onRefresh: () => void;
	refreshing: boolean;
}) {
	const style = STATE_STYLE[state];

	return (
		<StepSection
			step="03"
			title="Verify"
			flush
			right={
				<button
					type="button"
					onClick={onRefresh}
					disabled={refreshing}
					className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-mono text-2xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
				>
					<RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
					Re-check
				</button>
			}
		>
			<div className={cn("rounded-md border border-l-4 bg-card", style.border)}>
				<div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
					<span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
					<span className={cn("font-mono text-2xs uppercase tracking-[0.16em]", style.tone)}>
						{style.label}
					</span>
				</div>
				<div className="px-3 py-2.5">
					<VerifyMessage state={state} diagnostics={diagnostics} />
				</div>
				{diagnostics && (
					<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 border-t border-border/50 px-3 py-2.5 font-mono text-2xs">
						<DiagnosticRow
							label="events recorded"
							value={diagnostics.eventCount.toString()}
							tone={diagnostics.eventCount > 0 ? "emerald" : undefined}
						/>
						<DiagnosticRow
							label="last event"
							value={diagnostics.lastEventAt ? formatRelative(diagnostics.lastEventAt) : "never"}
							tone={diagnostics.lastEventAt ? undefined : "muted"}
						/>
						{diagnostics.projectsWithoutRepoPath > 0 && (
							<DiagnosticRow
								label="projects missing repoPath"
								value={diagnostics.projectsWithoutRepoPath.toString()}
								tone="amber"
							/>
						)}
					</dl>
				)}
			</div>
		</StepSection>
	);
}

function DiagnosticRow({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "emerald" | "amber" | "muted";
}) {
	const valueClass =
		tone === "emerald"
			? "text-success"
			: tone === "amber"
				? "text-warning"
				: tone === "muted"
					? "text-muted-foreground/60"
					: "text-foreground";
	return (
		<>
			<dt className="text-muted-foreground/70">
				<span className="text-muted-foreground/40">›</span> {label}
			</dt>
			<dd className={cn("tabular-nums", valueClass)}>{value}</dd>
		</>
	);
}

function VerifyMessage({
	state,
	diagnostics,
}: {
	state: SetupState;
	diagnostics: Diagnostics | undefined;
}) {
	if (state === "loading") {
		return <p className="text-xs text-muted-foreground">Checking your setup…</p>;
	}

	if (state === "not-configured") {
		return (
			<p className="text-xs text-muted-foreground">
				Add the hook above, then re-check. Pigeon won't see anything until Claude Code fires the
				Stop hook on session exit.
			</p>
		);
	}

	if (state === "working") {
		return (
			<p className="text-xs text-muted-foreground">
				Token usage is being recorded. Costs surface on cards, sessions, and the Pulse strip.
			</p>
		);
	}

	const missing = diagnostics?.projectsWithoutRepoPath ?? 0;

	if (state === "no-events") {
		return (
			<div className="space-y-1.5 text-xs text-muted-foreground">
				<p>The hook is wired up but hasn't fired yet. Likely causes:</p>
				<ul className="space-y-1">
					<li className="flex items-start gap-2">
						<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
						<span>
							You haven't ended a Claude Code session since adding the hook — run one and exit.
						</span>
					</li>
					{missing > 0 && (
						<li className="flex items-start gap-2">
							<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning/70" />
							<span>
								{missing} project{missing === 1 ? "" : "s"} missing{" "}
								<InlineCode>repoPath</InlineCode>. Sessions in unregistered repos drop silently.
							</span>
						</li>
					)}
					<li className="flex items-start gap-2">
						<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
						<span>
							The script at <InlineCode>scripts/stop-hook.sh</InlineCode> is missing or not
							executable. Run <InlineCode>chmod +x scripts/stop-hook.sh</InlineCode> from the repo
							root.
						</span>
					</li>
				</ul>
			</div>
		);
	}

	// stale
	return (
		<div className="space-y-1 text-xs text-muted-foreground">
			<p>
				No events in the last 7 days. The hook is configured but may not be firing on recent
				sessions.
			</p>
			{missing > 0 && (
				<p>
					{missing} project{missing === 1 ? "" : "s"} missing <InlineCode>repoPath</InlineCode> — a
					common silent-drop cause.
				</p>
			)}
		</div>
	);
}

// ─── Footer ────────────────────────────────────────────────────────

function ReadMoreFooter() {
	return (
		<div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-border/50 pt-3">
			<a
				href={COST_TRACKING_DOCS_URL}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground/80 transition-colors hover:text-foreground"
			>
				See how cost tracking works
				<ExternalLink className="h-3 w-3" />
			</a>
			<a
				href={TOKEN_TRACKING_DOCS_URL}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground/80 transition-colors hover:text-foreground"
			>
				docs/token-tracking.md
				<ExternalLink className="h-3 w-3" />
			</a>
		</div>
	);
}

// ─── Helpers ───────────────────────────────────────────────────────

// Replace the user's home directory with `~` for display in the snippet's
// editor-tab path label, matching how shells render paths.
function abbreviateHome(absPath: string): string {
	const match = absPath.match(/^\/Users\/[^/]+/);
	if (!match) return absPath;
	return `~${absPath.slice(match[0].length)}`;
}
