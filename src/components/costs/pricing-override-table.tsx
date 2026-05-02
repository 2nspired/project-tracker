"use client";

import { Plus, RotateCcw, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import {
	coerceRateValue,
	validateNewModelName,
} from "@/components/costs/pricing-override-validation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	DEFAULT_PRICING,
	type ModelPricing,
	PRICING_LAST_VERIFIED,
} from "@/lib/token-pricing-defaults";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

type ProjectSummary = RouterOutputs["tokenUsage"]["getProjectSummary"];

type Props = {
	projectId: string;
	/** Optional — used to surface unknown-model warnings. */
	projectSummary?: ProjectSummary;
};

// Built-in keys exposed to the UI, sorted for stable rendering. The
// `__default__` row in `DEFAULT_PRICING` is the zero-fallback for unknown
// models — it's intentionally hidden from the table since it's not a real
// model identifier and editing it would override the "honest zero" fallback.
const BUILTIN_KEYS = Object.keys(DEFAULT_PRICING)
	.filter((k) => k !== "__default__")
	.sort();

type RateField = keyof ModelPricing;

const RATE_FIELDS: { key: RateField; label: string; tooltip: string }[] = [
	{
		key: "inputPerMTok",
		label: "Input/MTok",
		tooltip: "Per-million prompt tokens sent to the model.",
	},
	{
		key: "outputPerMTok",
		label: "Output/MTok",
		tooltip: "Per-million response tokens from the model.",
	},
	{
		key: "cacheReadPerMTok",
		label: "Cache Read/MTok",
		tooltip: "Per-million tokens re-read from prompt cache (discounted vs. fresh input).",
	},
	{
		key: "cacheCreation1hPerMTok",
		label: "Cache 1h/MTok",
		tooltip: "Per-million tokens written to the 1-hour prompt cache.",
	},
	{
		key: "cacheCreation5mPerMTok",
		label: "Cache 5m/MTok",
		tooltip: "Per-million tokens written to the 5-minute prompt cache (default).",
	},
];

// Per-cell working state — strings rather than numbers so an empty input
// stays empty (not 0), letting the "Default: $X" hint show beneath. Empty
// strings get coerced to 0 at submit time per spec.
type RateDraft = Partial<Record<RateField, string>>;

// One in-progress add-row. We track `id` (synthesized) so React keys are
// stable as the user adds/removes rows; `name` is what gets normalized
// + persisted at save time.
type NewRow = {
	id: string;
	name: string;
	rates: RateDraft;
};

// Pricing override table for the Costs page (#193 step 5, closes #160).
// Renders one row per built-in default + one per existing override + zero
// or more in-progress add-model rows. All edits land in local component
// state until "Save pricing" — at which point we flatten the working set
// into the `tokenUsage.updatePricing` mutation payload.
//
// Ordering note: this component is mounted *after* the lenses on the costs
// page so it lives below the analytics surface — pricing is configuration,
// not a metric, and this keeps the visual hierarchy "metrics first, knobs
// after". Coordinated with U3 (#195 SavingsSection) which inserts before us.
export function PricingOverrideTable({ projectId: _projectId, projectSummary }: Props) {
	const utils = api.useUtils();
	const { data: pricing, isLoading } = api.tokenUsage.getPricing.useQuery(undefined, {
		staleTime: 60_000,
	});

	// Working state: per-model RateDraft. We seed this from the merged
	// pricing on mount but keep edits client-side until save. The map's
	// keys are normalized model names (matching what gets persisted).
	const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});
	const [newRows, setNewRows] = useState<NewRow[]>([]);
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

	const updatePricing = api.tokenUsage.updatePricing.useMutation({
		onSuccess: () => {
			toast.success("Pricing updated");
			void utils.tokenUsage.getPricing.invalidate();
			// Clear new-row UI on successful save — the rows are now part of
			// the persisted overrides and will render via the existing-rows
			// loop on the next render pass.
			setNewRows([]);
			setRowErrors({});
		},
		onError: (err) => {
			toast.error(`Failed to save pricing — ${err.message}`);
		},
	});

	// Compute the set of model rows to render. Built-in defaults are
	// always present; persisted overrides for *non-default* models append
	// after. We dedup by case-insensitive normalized name so a malformed
	// JSON blob with both `gpt-4o` and `GPT-4o` still produces one row.
	const builtinRows = BUILTIN_KEYS;
	const overrideRows = useMemo(() => {
		if (!pricing) return [];
		const builtinSet = new Set(BUILTIN_KEYS);
		return Object.keys(pricing)
			.filter((k) => k !== "__default__" && !builtinSet.has(k))
			.sort();
	}, [pricing]);

	// `builtinRows` is module-scope-stable so it's not a meaningful dep — the
	// memo only needs to recompute when persisted overrides change.
	const allModelKeys = useMemo(() => [...builtinRows, ...overrideRows], [overrideRows]);

	// Unknown-model warnings — any model in `byModel` summary that we have
	// no rates for (neither default nor override). Shows up as a single
	// amber DiagnosticRow per offender beneath the table.
	const unknownModels = useMemo(() => {
		if (!projectSummary || !pricing) return [];
		const known = new Set(Object.keys(pricing).map((k) => k.toLowerCase()));
		return projectSummary.byModel
			.map((m) => m.model)
			.filter((m) => m !== "__default__" && !known.has(m.toLowerCase()));
	}, [projectSummary, pricing]);

	if (isLoading || !pricing) {
		return (
			<Section step="01" title="Pricing">
				<p className="text-xs text-muted-foreground">Loading pricing…</p>
			</Section>
		);
	}

	// ─── Cell handlers ────────────────────────────────────────────────

	const setRateDraft = (model: string, field: RateField, value: string) => {
		setDrafts((prev) => ({
			...prev,
			[model]: { ...(prev[model] ?? {}), [field]: value },
		}));
	};

	const resetRow = (model: string) => {
		// Drop both the local draft *and* the persisted override for this
		// model. We rebuild the override payload from the current working
		// set minus this model and fire the mutation immediately so the
		// "reset" feels like a single confirmable action rather than a
		// staged edit that needs a save click.
		// Compute next-drafts up front and pass to both setDrafts and the
		// payload builder — using the closure `drafts` after `setDrafts`
		// would read the pre-update value, leaking the row's draft values
		// back into persisted overrides for any *other* edited row.
		const nextDrafts = { ...drafts };
		delete nextDrafts[model];
		setDrafts(nextDrafts);
		const nextOverrides = buildOverridesPayload({
			pricing,
			drafts: nextDrafts,
			newRows,
			excludeModel: model,
		});
		updatePricing.mutate({ overrides: nextOverrides });
	};

	const addNewRow = () => {
		setNewRows((prev) => [
			...prev,
			{ id: `new-${Date.now()}-${prev.length}`, name: "", rates: {} },
		]);
	};

	const updateNewRowName = (id: string, name: string) => {
		setNewRows((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
		// Clear any inline error tied to this row as the user edits.
		if (rowErrors[id]) {
			setRowErrors((prev) => {
				const next = { ...prev };
				delete next[id];
				return next;
			});
		}
	};

	const updateNewRowRate = (id: string, field: RateField, value: string) => {
		setNewRows((prev) =>
			prev.map((r) => (r.id === id ? { ...r, rates: { ...r.rates, [field]: value } } : r))
		);
	};

	const removeNewRow = (id: string) => {
		setNewRows((prev) => prev.filter((r) => r.id !== id));
		setRowErrors((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
	};

	// ─── Save handler ─────────────────────────────────────────────────

	const handleSave = () => {
		// Validate every in-progress row up front. Bail on the first error
		// per row but collect across rows so the user sees all problems at
		// once rather than fix-one-then-discover-the-next.
		const errors: Record<string, string> = {};
		const seenNewNames: string[] = [];
		for (const row of newRows) {
			const result = validateNewModelName({
				rawName: row.name,
				defaultModelKeys: BUILTIN_KEYS,
				overrideKeys: overrideRows,
				otherNewRowNames: seenNewNames,
			});
			if (result.kind === "err") {
				errors[row.id] = result.message;
			} else {
				seenNewNames.push(result.normalized);
			}
		}
		if (Object.keys(errors).length > 0) {
			setRowErrors(errors);
			return;
		}
		setRowErrors({});

		const overrides = buildOverridesPayload({ pricing, drafts, newRows });
		updatePricing.mutate({ overrides });
	};

	// ─── Render ───────────────────────────────────────────────────────

	const isSaving = updatePricing.isPending;

	return (
		<Section step="01" title="Pricing">
			<VerifiedBanner />

			{/* Visually a table; semantically a stack of labelled rows. We
			    deliberately avoid `role="table"` + `role="row"` ARIA roles
			    on `<div>`s because biome's a11y rules require focusable
			    interactive elements for those, which would degrade the
			    experience without adding screen-reader value — every input
			    has its own `aria-label`. */}
			<div className="space-y-1">
				<HeaderRow />
				<div className="space-y-1.5">
					{allModelKeys.map((model) => (
						<PricingRow
							key={model}
							model={model}
							pricing={pricing[model] ?? DEFAULT_PRICING.__default__}
							draft={drafts[model] ?? {}}
							isOverride={!builtinRows.includes(model) || hasOverride(pricing, model)}
							onChangeRate={(field, value) => setRateDraft(model, field, value)}
							onReset={() => resetRow(model)}
							saving={isSaving}
						/>
					))}
					{newRows.map((row) => (
						<NewModelRow
							key={row.id}
							row={row}
							error={rowErrors[row.id]}
							onChangeName={(name) => updateNewRowName(row.id, name)}
							onChangeRate={(field, value) => updateNewRowRate(row.id, field, value)}
							onRemove={() => removeNewRow(row.id)}
						/>
					))}
				</div>
			</div>

			{unknownModels.length > 0 && (
				<div className="space-y-1.5 pt-1">
					{unknownModels.map((m) => (
						<DiagnosticRow key={m}>
							Unknown model: {m} — add pricing above to see accurate costs.
						</DiagnosticRow>
					))}
				</div>
			)}

			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
				<button
					type="button"
					onClick={addNewRow}
					disabled={isSaving}
					className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 font-mono text-2xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
				>
					<Plus className="h-3 w-3" />
					Add model
				</button>
				<button
					type="button"
					onClick={handleSave}
					disabled={isSaving}
					className="inline-flex items-center gap-1.5 rounded-md border border-foreground/20 bg-foreground/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-60"
				>
					{isSaving ? "Saving…" : "Save pricing"}
				</button>
			</div>
		</Section>
	);
}

// ─── Banner ────────────────────────────────────────────────────────

function VerifiedBanner() {
	return (
		<div className="rounded border-l-2 border-l-amber-500 bg-amber-500/5 px-3 py-1.5 font-mono text-2xs text-amber-700 dark:text-amber-400">
			Defaults last verified: {PRICING_LAST_VERIFIED} · Verify against provider pricing page
		</div>
	);
}

// ─── Header (desktop only) ────────────────────────────────────────

function HeaderRow() {
	return (
		<div className="hidden grid-cols-[1.5fr_repeat(5,1fr)_auto] gap-2 border-b border-border/50 pb-1.5 sm:grid">
			<HeaderCell tooltip="Model identifier (pricing keys on this exact string).">Model</HeaderCell>
			{RATE_FIELDS.map((f) => (
				<HeaderCell key={f.key} tooltip={f.tooltip}>
					{f.label}
				</HeaderCell>
			))}
			<HeaderCell>{""}</HeaderCell>
		</div>
	);
}

function HeaderCell({ children, tooltip }: { children: ReactNode; tooltip?: string }) {
	if (!tooltip) {
		return (
			<div className="font-mono text-2xs uppercase tracking-wide text-muted-foreground/70">
				{children}
			</div>
		);
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="cursor-help text-left font-mono text-2xs uppercase tracking-wide text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
				>
					{children}
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="top"
				sideOffset={6}
				className="max-w-md px-2.5 py-1.5 text-xs leading-snug normal-case tracking-normal whitespace-normal"
			>
				{tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

// ─── Pricing row ───────────────────────────────────────────────────

type PricingRowProps = {
	model: string;
	pricing: ModelPricing;
	draft: RateDraft;
	isOverride: boolean;
	onChangeRate: (field: RateField, value: string) => void;
	onReset: () => void;
	saving: boolean;
};

function PricingRow({
	model,
	pricing,
	draft,
	isOverride,
	onChangeRate,
	onReset,
	saving,
}: PricingRowProps) {
	const hasDraftEdits = Object.values(draft).some((v) => v !== undefined && v !== "");
	const showReset = isOverride || hasDraftEdits;

	return (
		<div className="grid grid-cols-2 gap-2 rounded-md border border-transparent px-2 py-2 sm:grid-cols-[1.5fr_repeat(5,1fr)_auto] sm:items-baseline sm:rounded-none sm:border-0 sm:px-0 sm:py-1">
			<div className="col-span-2 sm:col-span-1">
				<span className="font-mono text-xs text-foreground/90">{model}</span>
			</div>
			{RATE_FIELDS.map((f) => (
				<RateCell
					key={f.key}
					label={f.label}
					field={f.key}
					defaultValue={pricing[f.key]}
					draftValue={draft[f.key]}
					onChange={(v) => onChangeRate(f.key, v)}
					isOverridden={hasOverrideForField(model, pricing, f.key) || draft[f.key] !== undefined}
				/>
			))}
			<div className="col-span-2 flex justify-end sm:col-span-1 sm:justify-start">
				{showReset && (
					<button
						type="button"
						onClick={onReset}
						disabled={saving}
						aria-label={`Reset ${model} pricing`}
						className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
					>
						<RotateCcw className="h-3 w-3" />
					</button>
				)}
			</div>
		</div>
	);
}

// ─── New-model row ────────────────────────────────────────────────

type NewModelRowProps = {
	row: NewRow;
	error: string | undefined;
	onChangeName: (name: string) => void;
	onChangeRate: (field: RateField, value: string) => void;
	onRemove: () => void;
};

function NewModelRow({ row, error, onChangeName, onChangeRate, onRemove }: NewModelRowProps) {
	return (
		<div
			className={cn(
				"grid grid-cols-2 gap-2 rounded-md border px-2 py-2 sm:grid-cols-[1.5fr_repeat(5,1fr)_auto] sm:items-baseline",
				error ? "border-amber-500/40 bg-amber-500/5" : "border-violet-500/30 bg-violet-500/5"
			)}
		>
			<div className="col-span-2 sm:col-span-1">
				<input
					type="text"
					value={row.name}
					onChange={(e) => onChangeName(e.target.value)}
					placeholder="model-name"
					aria-label="Model name"
					className="w-full bg-transparent border-b border-border/50 px-0 py-0.5 font-mono text-xs text-foreground/90 focus:border-foreground/50 focus:outline-none"
				/>
				{error && (
					<p className="pt-1 font-mono text-2xs text-amber-700 dark:text-amber-400">{error}</p>
				)}
			</div>
			{RATE_FIELDS.map((f) => (
				<RateCell
					key={f.key}
					label={f.label}
					field={f.key}
					defaultValue={0}
					draftValue={row.rates[f.key]}
					onChange={(v) => onChangeRate(f.key, v)}
					isOverridden={row.rates[f.key] !== undefined && row.rates[f.key] !== ""}
					hideDefaultHint
				/>
			))}
			<div className="col-span-2 flex justify-end sm:col-span-1 sm:justify-start">
				<button
					type="button"
					onClick={onRemove}
					aria-label="Remove new model row"
					className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="h-3 w-3" />
				</button>
			</div>
		</div>
	);
}

// ─── Rate cell (single number input + default hint) ───────────────

type RateCellProps = {
	label: string;
	field: RateField;
	defaultValue: number;
	draftValue: string | undefined;
	onChange: (value: string) => void;
	isOverridden: boolean;
	hideDefaultHint?: boolean;
};

function RateCell({
	label,
	field,
	defaultValue,
	draftValue,
	onChange,
	isOverridden,
	hideDefaultHint,
}: RateCellProps) {
	return (
		<div className="space-y-0.5">
			<span className="block font-mono text-2xs uppercase tracking-wide text-muted-foreground/60 sm:hidden">
				{label}
			</span>
			<input
				type="number"
				step="0.001"
				min="0"
				value={draftValue ?? ""}
				onChange={(e) => onChange(e.target.value)}
				aria-label={label}
				name={field}
				className={cn(
					"font-mono text-2xs tabular-nums w-20 bg-transparent border-b focus:outline-none",
					isOverridden ? "border-b-violet-500" : "border-border/50",
					"focus:border-foreground/50"
				)}
			/>
			{!hideDefaultHint && (
				<span className="block font-mono text-2xs tabular-nums text-muted-foreground/50">
					Default: ${formatRate(defaultValue)}
				</span>
			)}
		</div>
	);
}

// ─── Section frame (mirrors token-tracking-setup-dialog "Section") ─

function Section({ step, title, children }: { step: string; title: string; children: ReactNode }) {
	return (
		<section className="space-y-3 border-t border-border/50 pt-4">
			<div className="flex items-baseline gap-2.5">
				<span className="font-mono text-2xs text-muted-foreground/60 tabular-nums">{step}</span>
				<h3 className="text-sm font-medium tracking-tight">{title}</h3>
			</div>
			{children}
		</section>
	);
}

// ─── Diagnostic row (amber muted strip) ───────────────────────────

function DiagnosticRow({ children }: { children: ReactNode }) {
	return (
		<div className="rounded border-l-2 border-l-amber-500 bg-amber-500/5 px-3 py-1.5 font-mono text-2xs text-amber-700 dark:text-amber-400">
			{children}
		</div>
	);
}

// ─── Helpers ───────────────────────────────────────────────────────

// Did the user persist *any* override for this model? We compare each rate
// against the built-in default for visual styling. For models that aren't
// in `DEFAULT_PRICING` (pure overrides), we always treat them as overridden.
function hasOverride(pricing: Record<string, ModelPricing>, model: string): boolean {
	const builtin = DEFAULT_PRICING[model];
	const current = pricing[model];
	if (!builtin || !current) return true;
	return RATE_FIELDS.some((f) => current[f.key] !== builtin[f.key]);
}

function hasOverrideForField(model: string, pricing: ModelPricing, field: RateField): boolean {
	// Compare against the model's own built-in default — not the zero
	// `__default__` fallback — otherwise every built-in model (e.g. gpt-4o
	// at $5/MTok) reads as "overridden" the moment the table loads. For
	// models with no built-in entry (pure user-added rows), any non-zero
	// value is by definition an override.
	const builtin = DEFAULT_PRICING[model];
	if (!builtin) return pricing[field] !== 0;
	return pricing[field] !== builtin[field];
}

function formatRate(value: number): string {
	if (value === 0) return "0";
	if (value < 1) return value.toFixed(3).replace(/\.?0+$/, "");
	return value.toFixed(2).replace(/\.?0+$/, "");
}

// Build the `overrides` payload for the `updatePricing` mutation. Combines:
//   - existing persisted overrides (everything in `pricing` that's not a
//     built-in default-only row),
//   - current local drafts (per-field overrides of those models),
//   - validated new-model rows (full 5-field inserts).
// Honors `excludeModel` so the "reset row" path can omit a model from the
// payload entirely (the merged result loses the override and falls back to
// `DEFAULT_PRICING`).
function buildOverridesPayload({
	pricing,
	drafts,
	newRows,
	excludeModel,
}: {
	pricing: Record<string, ModelPricing>;
	drafts: Record<string, RateDraft>;
	newRows: NewRow[];
	excludeModel?: string;
}): Record<string, ModelPricing> {
	const result: Record<string, ModelPricing> = {};

	// Carry forward existing pricing for every model except the excluded
	// one. We start from the merged values so partial drafts only touch
	// the fields the user edited.
	for (const [model, rates] of Object.entries(pricing)) {
		if (model === "__default__") continue;
		if (excludeModel && model.toLowerCase() === excludeModel.toLowerCase()) continue;
		// For built-in models, only persist if there's actually an
		// override — otherwise we'd write defaults verbatim and the
		// "reset" semantics would still leave a row in `tokenPricing`.
		const isBuiltin = BUILTIN_KEYS.includes(model);
		if (isBuiltin && !hasOverride(pricing, model) && !drafts[model]) continue;
		result[model] = { ...rates };
	}

	// Apply local drafts on top of the carried-forward state.
	for (const [model, draft] of Object.entries(drafts)) {
		if (excludeModel && model.toLowerCase() === excludeModel.toLowerCase()) continue;
		const base =
			result[model] ?? pricing[model] ?? DEFAULT_PRICING[model] ?? DEFAULT_PRICING.__default__;
		result[model] = {
			inputPerMTok:
				draft.inputPerMTok !== undefined ? coerceRateValue(draft.inputPerMTok) : base.inputPerMTok,
			outputPerMTok:
				draft.outputPerMTok !== undefined
					? coerceRateValue(draft.outputPerMTok)
					: base.outputPerMTok,
			cacheReadPerMTok:
				draft.cacheReadPerMTok !== undefined
					? coerceRateValue(draft.cacheReadPerMTok)
					: base.cacheReadPerMTok,
			cacheCreation1hPerMTok:
				draft.cacheCreation1hPerMTok !== undefined
					? coerceRateValue(draft.cacheCreation1hPerMTok)
					: base.cacheCreation1hPerMTok,
			cacheCreation5mPerMTok:
				draft.cacheCreation5mPerMTok !== undefined
					? coerceRateValue(draft.cacheCreation5mPerMTok)
					: base.cacheCreation5mPerMTok,
		};
	}

	// New-model rows. Names are validated upstream; we re-normalize here
	// defensively. Empty rates persist as 0 per spec.
	for (const row of newRows) {
		const normalized = row.name.trim().toLowerCase();
		if (!normalized) continue;
		result[normalized] = {
			inputPerMTok: coerceRateValue(row.rates.inputPerMTok),
			outputPerMTok: coerceRateValue(row.rates.outputPerMTok),
			cacheReadPerMTok: coerceRateValue(row.rates.cacheReadPerMTok),
			cacheCreation1hPerMTok: coerceRateValue(row.rates.cacheCreation1hPerMTok),
			cacheCreation5mPerMTok: coerceRateValue(row.rates.cacheCreation5mPerMTok),
		};
	}

	return result;
}
