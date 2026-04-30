# #142 — MCP Command Palette · Design Spec

Companion preview: `preview.html` (open in a browser to see both surfaces in light + dark, with motion).

## 1. Aesthetic direction — *editorial reference manual*

Tool reference is a different content genre from "search & navigate." Where the existing Cmd-K palette is a workspace navigator (cards, pages, actions), the MCP catalog is **documentation**: it should feel like a printed API reference, not a launcher.

Concrete consequences:

- **Mono for tool names, sans for descriptions.** Names are code; descriptions are prose. The existing `--font-geist-sans` pairs with `--font-geist-mono` (Next.js default) — no new fonts.
- **Small-caps category labels** (`text-[10px] uppercase tracking-[0.14em]`). Borrowed from print directories.
- **A 1px left rule on the Essentials section** instead of a heading-style group label. Quieter visual separation, more typographic.
- **`ExternalLink` glyph at row-end** signals "this opens the docs," not "this runs."
- **No purple gradients, no glass-blur novelty.** Stays inside shadcn new-york tokens.

The aesthetic is a refinement, not a new direction — it has to coexist with cards, dialogs, and the existing Cmd-K palette without looking like a transplant.

## 2. Architectural decision — resolve the Cmd-K collision

**Conflict in the original card plan:** `src/components/command-palette.tsx` already owns `Cmd-K` for navigation/card search. The card's "Cmd-K opens the MCP palette" requirement would either replace that or fight it.

**Recommendation (architect mode):** **Two surfaces, one data source.**

| Surface | Trigger | Purpose | Component |
|---|---|---|---|
| **Existing global palette** | `Cmd-K` | Navigation + card search + a new pinned "MCP Tools — Essentials" group (10 rows) → row select opens doc anchor in new tab | extend `CommandPalette` |
| **Dedicated MCP catalog** | Header `{ } MCP` button · `?` hotkey | Full two-tier catalog with categories, parameter preview, deep links | new `McpCatalogPopover` |

Why this split:

- `Cmd-K` stays a single, predictable shortcut. Users who already know it discover MCP tools incidentally — a learning surface they didn't have to seek out.
- The catalog popover is a **reference panel**, not a launcher. Bigger, denser, with collapsible categories and parameter preview — affordances that don't belong in a fast launcher.
- Both surfaces source from the **same** new tRPC procedure `system.toolCatalog`, so they can never drift.
- No shortcut collision: `?` is the conventional "help" key (Linear, GitHub, Slack all use it) and isn't bound elsewhere in the app.

**Net effect on the card's acceptance criteria:** all met, but "Cmd-K opens *the* palette" becomes "Cmd-K's existing palette gains an MCP Essentials group, and `?` opens the dedicated catalog." Worth confirming with the user before feature-dev runs.

## 3. Layout & components

### 3.1 Header affordance

Position: between the existing `Search ⌘K` button and `ServerStatusPill` in `src/app/(main)/layout.tsx:67`.

```tsx
<button
  type="button"
  onClick={() => setMcpOpen(true)}
  className="hidden items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground sm:flex"
  aria-label="Browse MCP tools"
>
  <Boxes className="h-3.5 w-3.5" />
  MCP
  <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">?</kbd>
</button>
```

The dashed border echoes `TagCombobox`'s "Add tag" pill — same visual family, different intent. The `?` kbd teaches the shortcut without taking up shortcut bar real estate.

On `< sm` breakpoint the button collapses to icon-only (`Boxes`). On tap, the catalog opens as a bottom-anchored Sheet instead of a Popover (use `useMediaQuery` or a `Sheet`/`Popover` switch — pattern already used elsewhere if `useMediaQuery` exists; otherwise just always-Popover with `align="end"` is acceptable for v1).

### 3.2 Catalog popover — anatomy

```
┌──────────────────────────────────────────────────┐
│  ⌕  Search tools…                          ⌘K   │  ← cmdk CommandInput
├──────────────────────────────────────────────────┤
│ ┃ briefMe          one-shot session primer    ↗ │  ← Essentials
│ ┃ saveHandoff      wrap up & save handoff     ↗ │     (left rule, no heading)
│ ┃ createCard       create one card            ↗ │
│ ┃ updateCard       update card fields         ↗ │
│ ┃ moveCard         move to another column     ↗ │
│ ┃ addComment       comment on a card          ↗ │
│ ┃ registerRepo     link git repo to project   ↗ │
│ ┃ checkOnboarding  startup status check       ↗ │
│ ┃ getTools         browse extended tools      ↗ │
│ ┃ runTool          execute extended tool      ↗ │
├──────────────────────────────────────────────────┤
│ EXTENDED                                          │
│ ▸ Discovery                              13 tools │  ← collapsible
│ ▾ Cards                                   5 tools │
│   bulkCreateCards   batch card creation       ↗ │
│   bulkMoveCards     batch column move         ↗ │
│   …                                              │
│ ▸ Milestones                              4 tools │
│ ▸ Sessions                                5 tools │
│ ▸ Decisions                               3 tools │
│ …                                                │
└──────────────────────────────────────────────────┘
```

Width: `w-[28rem]` (~448px) on desktop. Max height: `max-h-[min(36rem,75vh)]`, internal scroll on the `CommandList`.

The Essentials section has **no heading label** — just a `border-l border-foreground/20 pl-3 -ml-1` rule on each row. Deliberately quieter than a `CommandGroup heading`.

The Extended section uses `CommandGroup heading="Extended"` with category sub-groups rendered as `<details>` or controlled accordion items. Each category collapses independently; state persists in `localStorage` (key: `mcp-catalog:expanded-categories`).

### 3.3 Per-tool row

```tsx
<CommandItem className="group flex items-center gap-3 px-3 py-2">
  <span className="font-mono text-sm font-medium tabular-nums text-foreground">
    {name}
  </span>
  <span className="line-clamp-1 flex-1 text-xs text-muted-foreground">
    {description}
  </span>
  {/* category shown only in Extended sections */}
  {showCategory && (
    <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
      {category}
    </span>
  )}
  <a
    href={docUrl}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(e) => e.stopPropagation()}
    className="opacity-40 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100"
    aria-label={`${name} — open docs`}
  >
    <ExternalLink className="h-3.5 w-3.5" />
  </a>
</CommandItem>
```

- Selecting the row (Enter) opens the doc URL in a new tab — the row itself is the link target, the icon is decorative.
- Hovering the row brightens the `ExternalLink` glyph; selected (keyboard-focused) row also brightens it.
- `tabular-nums` on the name keeps mono columns aligned even with proportional digits in some glyphs.

### 3.4 Parameter preview

On row focus (keyboard) or hover (pointer), an inline `<details>`-like panel expands **below the row** (not as a side panel — keeps the popover width predictable on mobile, simpler implementation, doesn't fight cmdk's filter logic).

```
┌──────────────────────────────────────────────────┐
│ ▾ briefMe          one-shot session primer    ↗ │
│   ┌──────────────────────────────────────────┐  │
│   │ PARAMS                                    │  │
│   │   boardId?  string  Board UUID — auto…    │  │
│   │   format?   "json" | "toon"  default…     │  │
│   │ RETURNS                                   │  │
│   │   { handoff, candidates, blockers, … }    │  │
│   └──────────────────────────────────────────┘  │
```

Reveal trigger: a small `▸`/`▾` chevron to the *left* of the tool name, click to toggle. Default collapsed. Keyboard: `Tab` from a row focuses its chevron, `Enter` toggles. The chevron is the only "expand" affordance — hover doesn't expand (avoids flicker on quick mouse passes through the list).

Parameter rows: `font-mono text-xs`, with `?` suffix for optional. Description after the type, truncated to one line at `text-[10px] text-muted-foreground`. Returns shape uses the `_meta.estimatedTokens` shape we already get from `getToolCatalog()`.

If `getToolCatalog({ tool })` returns no schema (some tools don't ship one), show `No parameter schema published.` in muted text — no error state.

## 4. Motion

All within `tw-animate-css` (already imported in `globals.css`):

| Element | Animation | Duration | Easing |
|---|---|---|---|
| Popover open | `slide-in-from-top-2 fade-in-0` | 150ms | `ease-out` |
| Popover close | `slide-out-to-top-2 fade-out-0` | 100ms | `ease-in` |
| Category expand | height + `fade-in-0` | 180ms | `ease-out` |
| Param preview | `slide-in-from-top-1 fade-in-0` | 140ms | `ease-out` |
| Header button hover | `border-color`, `bg`, `color` 120ms | 120ms | `ease-out` |

No staggered list reveals — the popover is reference content, not a hero. Motion stays subordinate to information density.

## 5. Search behavior

`cmdk` filters across `name + description + category` (set `value={`${name} ${description} ${category}`}` on each `CommandItem`).

When the search query is non-empty:
- Hide category headers and Essentials rule.
- Render a flat ranked list (cmdk's default scoring is fine).
- Show top 50 matches; below that, show a `…and N more — refine your query` row.
- If zero matches, show `No tools match "<query>". Try a category name like cards or sessions.`

Search input is **autofocused** on open — every interaction is "I'm looking for something."

## 6. Empty / loading states

- Initial fetch (≤ 200ms typical, comes from in-process `getToolCatalog()` so usually instant): render 6 skeleton rows in the Essentials section. No skeleton in Extended (collapsed by default, so no flash).
- If `system.toolCatalog` errors (offline tRPC, dev-only): show a single row with `Could not load MCP tools — check the dev server.` Don't retry automatically.

## 7. Doc URL fallback

```ts
function docUrl(toolName: string): string {
  const base = process.env.NEXT_PUBLIC_DOCS_BASE ?? "https://2nspired.github.io/pigeon";
  return `${base}/tools/#${toolName}`;
}
```

Until `tools.mdx` has anchors for every tool, the link still resolves — the page just won't jump to the right section. That's acceptable for v1; `scripts/sync-tool-docs.ts --check` (referenced in the card) is the safety net.

## 8. Accessibility

- Trigger button: `aria-label="Browse MCP tools"`, `aria-expanded`, `aria-controls="mcp-catalog"`.
- `Popover` content: `role="dialog" aria-label="MCP tool catalog"`.
- Focus trap is provided by `PopoverContent` (Radix). On close, focus returns to the trigger.
- Param preview chevron: `aria-expanded`, `aria-controls={paramPanelId}`.
- All rows reachable by `↑` / `↓` (cmdk default) and Tab once the chevron exists.
- The doc-link `<a>` inside each row uses `aria-label` because the visible text is the tool name (already announced by the row).
- Lighthouse a11y target: ≥ 95 on the header in both light and dark.

## 9. Files to create / modify

Per the card, plus the architectural changes from §2:

**New**
- `src/components/header/mcp-catalog-popover.tsx` — Popover + Command, owns the catalog UI
- `src/components/header/mcp-catalog-trigger.tsx` — header button + `?` hotkey
- `src/components/header/mcp-tool-row.tsx` — single-row component (used by both popover and Cmd-K group)
- `src/server/api/routers/system.ts` — `toolCatalog` procedure exposing `getToolCatalog()`
- `src/lib/doc-url.ts` — single-source helper for the docs URL convention

**Modified**
- `src/app/(main)/layout.tsx` — mount `<McpCatalogTrigger />` between the search button and `ServerStatusPill`
- `src/components/command-palette.tsx` — add `MCP Tools — Essentials` group, sourced from `api.system.toolCatalog`
- `src/server/api/root.ts` — register `system` router

**Verify (out of scope to fix here)**
- `docs-site/src/content/docs/tools.mdx` anchor coverage — `scripts/sync-tool-docs.ts --check`

## 10. What this design intentionally does NOT do

Restating the card's out-of-scope list with the design's reading of each:

- **No "click to run" tool execution.** The row is a doc link. There is no execute affordance, no parameter input form. Reinforces the "reference manual" mental model.
- **No personalization (recents/favorites).** Pinned Essentials are *editorial* — same for every user — not derived from history.
- **No telemetry.** Don't even instrument row clicks.
- **No vim/chord shortcuts.** `?` open, `Esc` close, `Cmd-K` for the navigation palette. Three keys, no hidden layer.

## 11. Open questions for the implementer

1. **Confirm `?` hotkey** doesn't collide with any existing handler. Quick grep before wiring.
2. **Mobile Sheet vs. Popover**: if no `useMediaQuery` hook exists, default to Popover with `align="end"` and ship the Sheet variant in a follow-up.
3. **Param schema source**: does `getToolCatalog({ tool })` return the same Zod-derived shape as `getTools({ tool })` from MCP? If not, may need a new `system.toolDetail` procedure — but check first, the registry probably exposes it already.

---

*Preview the visual design at `preview.html` — opens in any browser, no build step.*
