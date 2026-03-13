# Usage Audit Diff vs Official OpenClaw WebUI

## Scope
- Local implementation: `src/features/usage/components/UsagePage.tsx` wired at `src/App.tsx` (`/usage`)
- Official reference: `upstream/ui/src/ui/views/usage.ts` plus:
  - `upstream/ui/src/ui/views/usage-render-overview.ts`
  - `upstream/ui/src/ui/views/usage-render-details.ts`
  - `upstream/ui/src/ui/views/usage-metrics.ts`
  - `upstream/ui/src/ui/app-render-usage-tab.ts`
  - `upstream/ui/src/ui/app.ts`

## Current Local Status Summary
- The local page is a substantial React port of the official Usage tab, not a placeholder.
- It already includes the major official surface areas: header/filters, query filters, overview summary cards, insight lists, activity mosaic, daily usage chart, sessions list, session detail, time series, context breakdown, and session logs.
- It also adds a few local-only touches: bilingual copy (`en`/`zh`), an explicit disconnected empty state, and a secondary metric shown inside each session row.
- Overall parity is **good at the section level** but **not yet faithful at the interaction/default-state/detail level**.

## Differences vs Official

| Area | Local repo | Official WebUI | Impact |
| --- | --- | --- | --- |
| Default state | Defaults to **today only**, `dailyChartMode=by-type`, `timeSeriesMode=per-turn`, `timeSeriesBreakdownMode=by-type`, `sessionSort=recent` | Defaults to **today only**, `by-type`, `per-turn`, `by-type`, `recent` | Default behavior is aligned |
| Shift-selection behavior | `Shift` selects **contiguous visible ranges** for days / hours / sessions | `Shift` selects **contiguous ranges** for days, hours, and sessions | Core bulk-selection workflow is restored |
| Time-series interaction | Visible selected range, range summary, dimmed out-of-range bars, scoped visible-range filtering, and “no data in range” handling; native hover titles only, no draggable handles | Interactive SVG chart with tooltips, visible selection overlay, draggable handles, range summary, and empty-in-range handling | Main structural interaction gap is closed; richer tooltip/drag affordances remain |
| Sessions list behavior | No copy action; no separate “Selected (N)” panel; rows show active metric plus inverse metric | Copy button per row; dedicated selected-sessions panel for multi-select; tighter row layout | Multi-select and session management are weaker than official |
| Session logs | “Expand all” means show more rows; no per-entry tool accordion; header shows `N rows - Ready/Refreshing` | “Expand/Collapse All” opens tool detail accordions; header shows `X of Y` and `(timeline filtered)`; tool pills are rendered | Filtering is usable, but official log-inspection affordances are missing |
| Context panel | Shows stacked bar + legend + lists, but no total context number, no `% of input`, no item counts, no sorted “top-heavy” ordering | Shows total context estimate, `% of input`, counts per bucket, sorted lists, and `+N more` style cues | Context cost attribution is less informative |
| Daily chart density | Always shows totals under bars; simpler fixed bar layout | Hides totals for wider ranges, adjusts bar width, provides hover tooltips | Local view gets denser/noisier on 30-day windows |
| Copy hierarchy / hints | Missing official help-hint tooltips on summary cards; warnings are lighter inline text | Official uses stronger titles, hint affordances, and callout treatment | Lower information hierarchy and explainability |
| Layout composition | Session detail is more stacked; logs sit below summary/context | Official detail view keeps summary/time-series on top and logs/context side-by-side below | Same data, but less compact and less like upstream |
| Empty/disconnected states | Adds a dedicated disconnected empty state and a visible empty detail placeholder | Official usage tab is more compact and does not show the same disconnected-state treatment inside the tab | Local has useful extra behavior, but it is not upstream-faithful |

## Priority Fix List

### P0
- Completed:
  - default state now matches official (`today`, `by-type`, `per-turn`, `by-type`, `recent`), and the local `today-only` default is confirmed against upstream's same-day start/end initialization
  - `Shift` now selects contiguous ranges for days, hours, and sessions
  - time-series interaction now includes a visible selected range, stronger selected-range affordance, clearer selected-range summary, dimmed out-of-range bars, and explicit no-data-in-range handling
- Remaining gap vs official P0 intentionally deferred here:
  - native hover titles are present, but not the richer custom tooltip layer
  - draggable range handles are still not implemented

### P1
- Match the **sessions card** behavior more closely:
  - completed: add row-level copy action
  - completed: add dedicated `Selected (N)` subpanel for multi-select
  - completed: tighten row density to official proportions
- Match the **session logs** behavior:
  - completed: show `X of Y` count and `(timeline filtered)` when applicable
  - completed: make expand/collapse control affect per-entry tool details, not just row count
  - completed: render tool summary/details closer to upstream with per-entry accordions and tool pills
- Bring the **context panel** to official parity:
  - completed: total context estimate
  - completed: `% of input` descriptor
  - completed: sorted lists by weight
  - completed: count / overflow cues
- Adjust the **daily chart** to official density rules: adaptive bar sizing, conditional totals, hover tooltip behavior.
  - deferred in this pass to keep scope on Usage P1 session/detail parity only.

### P2
- Reintroduce the official **summary-card hints / help affordances** and stronger warning/callout styling.
- Align smaller copy/details: mosaic section labels/legend, session-detail header stats, log role labeling, empty-state wording.
- Add official-style **debounced query apply** behavior while preserving the local explicit apply button if desired.
- Decide whether to keep local-only extras (bilingual copy, disconnected state, inverse metric in session rows) as intentional product deviations.

## Recommended Implementation Order
1. **Align defaults and selection semantics first** so the page behaves like official before visual polish.
2. **Rebuild the time-series interaction model** because it drives downstream detail/log filtering behavior.
3. **Fix the sessions list and multi-select affordances** to restore official navigation and inspection flow.
4. **Bring logs and context panels up to parity** so detailed diagnosis matches upstream.
5. **Polish density, hints, warnings, and copy hierarchy** after behavior is aligned.

## Bottom Line
- The local Usage page is already feature-rich and broadly recognizable as the official OpenClaw Usage surface.
- The main parity gaps are not missing top-level sections; they are **defaults, selection semantics, detailed analysis interactions, and information density**.
- If the goal is “looks and behaves like upstream,” the highest-value work is in the controller/interaction layer, not in adding new cards.
