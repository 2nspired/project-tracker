# Energy & CO₂ methodology

The Costs page reports an estimate of the watt-hours and grams of CO₂ each
session, handoff, and project consumed. This document is the standing reference
for how those numbers are produced — the assumptions, the citation trail per
model, the size of the error bar, and the override path.

## TL;DR

- **Token-derived estimate, not a meter reading.** Pigeon computes
  `energyWh = inputTokens × inputCoeff + outputTokens × outputCoeff`, where the
  coefficients live in `src/lib/energy-coefficients-defaults.ts`.
- **Single grid intensity.** CO₂ uses one constant — the IEA 2024 world-average
  `475 g CO₂ / kWh`. Per-region selection is intentionally deferred for v1.
- **Approximate by ~±50 %.** The frontier-model coefficients aren't published;
  Pigeon scales public-research figures by parameter count and price ratio.
  Treat the numbers as ballpark, not invoice-grade.
- **No schema migration.** Energy is derived at read time, exactly like the
  dollar `costUsd` value — coefficient changes apply retroactively.

## What is and isn't counted

Counted:

- `inputTokens` × `wattHoursPerInputToken`
- `outputTokens` × `wattHoursPerOutputToken`

Not counted:

- **Cache-read tokens** — loading from prompt cache skips the forward pass; the
  marginal energy is dominated by network and storage, which is rounded to zero
  for this estimate.
- **Cache-creation tokens** — within an order of magnitude of input-token cost;
  treated as input-equivalent for now, which understates writes by a factor of
  one to two. Documented as a known underestimate.
- **Embodied energy of training the model** — controversial, no consensus
  amortization rule. Out of scope.
- **Local-machine power draw** (the device running Claude Code) — would need
  OS-level APIs and adds noise that swamps the inference signal.

## Per-model coefficients

`src/lib/energy-coefficients-defaults.ts` is the source of truth. Each row
carries its own `source` and `citationUrl` so the citation trail stays beside
the number.

| Model               | Wh / input token | Wh / output token | Source                                                                     |
| ------------------- | ---------------- | ----------------- | -------------------------------------------------------------------------- |
| `claude-opus-4-7`   | 0.0005           | 0.005             | de Vries 2023 (Joule), scaled for Opus-class parameter count               |
| `claude-opus-4-6`   | 0.0005           | 0.005             | de Vries 2023, same scaling                                                |
| `claude-sonnet-4-6` | 0.00015          | 0.0015            | de Vries 2023, scaled by Anthropic Sonnet/Opus price ratio (~3×)           |
| `claude-haiku-4-5`  | 0.00005          | 0.0005            | de Vries 2023, scaled by Anthropic Haiku/Opus price ratio (~10×)           |
| `gpt-4o`            | 0.0003           | 0.003             | Luccioni et al. 2024 (HF AI Energy Score), GPT-4-class lower-bound         |
| `gpt-4o-mini`       | 0.00005          | 0.0005            | Luccioni et al. 2024, small-model band                                     |
| `gpt-4-turbo`       | 0.0005           | 0.005             | de Vries 2023, original GPT-4-class                                        |
| `o1`                | 0.0005           | 0.008             | de Vries 2023, GPT-4-class with reasoning-token uplift on output           |
| `__default__`       | 0                | 0                 | fallback for unknown models — add to the defaults file rather than guess   |

### Why output costs ~10× input

Autoregressive decoding runs one full forward pass per emitted token. Input
tokens go through the encoder once, in parallel; output tokens drag the model
through one decode step each. The 10× ratio is consistent across the public
literature.

### Why the frontier-model figures are scaled, not measured

Anthropic and OpenAI do not publish per-token energy figures for their hosted
frontier models. The closest public-research anchor is de Vries (2023, Joule)
on ChatGPT-class queries. Pigeon scales that figure by relative parameter
count using the price ratios the providers publish — a rough proxy, but
within the same order of magnitude as the few independently-measured figures
on the Hugging Face AI Energy Score leaderboard.

The `__default__` row is intentionally zero. When an unknown model shows up,
the UI's pricing-table flagging behavior already nudges users to add a row.
The same nudge serves energy: an honest zero is better than an invented
non-zero estimate.

## Grid intensity

`WORLD_AVG_GCO2_PER_KWH = 475` — IEA, *Electricity 2024 — Analysis and
Forecast to 2026*, world-average emissions intensity of electricity supply.

A single global constant is a deliberate v1 simplification. For users running
inference on hyperscale-cloud regions (which often disclose lower-carbon grids)
this overstates the footprint; for users on coal-heavy grids it understates.
Per-region selection is queued as a follow-up — it requires inferring or
asking which provider region serviced the call, neither of which Pigeon
records today.

## Sources

- de Vries, A. (2023). *The growing energy footprint of artificial intelligence*. Joule, 7(10). DOI: [10.1016/j.joule.2023.09.004](https://doi.org/10.1016/j.joule.2023.09.004)
- Luccioni, A. S., et al. (2024). *AI Energy Score Leaderboard*. Hugging Face. [huggingface.co/spaces/AIEnergyScore/Leaderboard](https://huggingface.co/spaces/AIEnergyScore/Leaderboard)
- Strubell, E., Ganesh, A., & McCallum, A. (2019). *Energy and Policy Considerations for Deep Learning in NLP*. ACL. [arxiv.org/abs/1906.02243](https://arxiv.org/abs/1906.02243)
- IEA (2024). *Electricity 2024 — Analysis and Forecast to 2026*. [iea.org/reports/electricity-2024](https://www.iea.org/reports/electricity-2024)

## Overriding coefficients

For v1 there is no override UI. To replace a default coefficient — for
example, after a provider publishes a measured figure — edit
`src/lib/energy-coefficients-defaults.ts` directly:

```ts
"claude-opus-4-8": {
  wattHoursPerInputToken: 0.0004,
  wattHoursPerOutputToken: 0.004,
  source: "Anthropic — published efficiency note for Opus 4.8 (2026-Q3)",
  citationUrl: "https://www.anthropic.com/...",
},
```

Bump `COEFFICIENTS_LAST_VERIFIED` when you make a change. Editions and
dashboards re-render with the new coefficient on next read — no migration,
no backfill.

A user-editable override surface (paralleling the pricing override table) is
out of scope for v1 and tracked as a follow-up if demand materializes.

## Calling out the uncertainty

The Costs page tooltip says *"Estimated from per-token coefficients × world-
average grid intensity"* and links here. Be honest with downstream readers:
this is a defensible ballpark, not a meter. The number's job is to make
sustainability *visible* alongside dollars — and to give projects an
order-of-magnitude floor for sustainability decisions, not a precise figure
for carbon-credit accounting.
