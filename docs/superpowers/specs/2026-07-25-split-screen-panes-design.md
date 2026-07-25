# Split-screen panes — design

**Date:** 2026-07-25
**Status:** design approved by Franco (brainstormed 2026-07-25); implementation plan not yet written
**Branch context:** follows the Clean/Workbench redesign (`clean-tab-redesign`)

---

## Problem

A user working on a real research task constantly bounces between two modules — cleaning a
variable in Clean and re-estimating in Model, or comparing an Explore plot against the pipeline
that produced it. Today the workspace shows exactly one module at a time, so every comparison
is a tab round-trip held in the user's head.

Goal: let the user show two modules side by side (and more, if the mechanism allows it for free),
with the split proportion adjustable like Windows snap.

**Sequencing decision:** this lands *before* Tauri desktop packaging. Tauri is a wrapper that
inherits whatever layout exists; packaging first would ship a UX we'd immediately rework.
CLAUDE.md already defers Tauri "until feature-complete", and this is a feature.

---

## Key architectural finding — why this is cheap

The naive implementation reparents modules into pane containers. That is exactly what must NOT
happen: moving a mounted component to a different parent makes React unmount and remount it,
destroying all module state (pipeline, results, scroll position).

It turns out no reparenting is needed. Two facts about the current code:

1. **Every tab panel is already mounted simultaneously.** `App.jsx:3030` renders all panels in
   one stack and toggles `display: none` / `flex`, with the comment *"Tab panels — kept mounted
   via display:none to preserve state"*. All modules already coexist in one React tree without
   conflicting.
2. **Each panel is already absolutely positioned.** `tabPanel` (`App.jsx:3220`) is
   `{position:absolute, inset:0, overflow:hidden}` inside a `position:relative` container.

So the split is **purely a CSS box change**. Instead of `inset:0`, each visible panel gets
explicit horizontal coordinates:

```
1 pane:   left:0    width:100%
2 panes:  left:0    width:R%     |    left:R%   width:(100-R)%
```

Panels not assigned to any pane keep `display:none` and stay mounted, exactly as today. The
React tree is untouched — zero remounts, zero state loss, and with a single pane the rendered
result is byte-identical to current behaviour, so regression risk is minimal.

**Free consequence:** because each module is a single DOM element, it is *structurally
impossible* to show the same module in two panes. Assigning an already-visible module to the
other pane swaps the two. This sidesteps the real hazard of a naive design — two `DataStudio`
instances colliding on `studioRef`, on the `litux:wrangle_tab:${pid}` sessionStorage key, and on
debounced IndexedDB writes.

A third existing fact makes the split genuinely useful rather than decorative: **per-tab dataset
selection already exists** (`activeDatasetIds[tab]`, `App.jsx:2847`). Clean can sit on dataset A
while Model sits on dataset B.

---

## Design

### Pane model

New state in `App.jsx`:

- `panes: string[]` — ordered tab ids, e.g. `["clean"]` or `["clean","model"]`.
- `focusedPane: number` — index into `panes`.
- `paneRatio: number` — fraction of width for the first pane, default `0.5`.

A helper `paneBox(tabId)` returns the CSS box for a panel: its pane's `left`/`width` when
assigned, or `display:none` when not. This replaces the current
`{...tabPanel, display: activeTab==="x" ? "flex" : "none"}` expression at each of the ~9 call
sites. `activeTab` becomes a derived value (`panes[focusedPane]`) so existing consumers —
`navigateToTab`, the tour's `onTabChange`, the coach — keep working unchanged.

### Interaction

- A **⊞ button in `WorkspaceBar`** toggles the split on and off.
- The **focused pane** carries a subtle border. Clicking anywhere inside a pane focuses it.
- Clicking a tab in the WorkspaceBar loads that module **into the focused pane**. If that module
  is already in the other pane, the two swap.
- The WorkspaceBar marks which tabs are currently open, so the user can see at a glance what is
  where.
- Closing a pane returns the survivor to full width.

### Divider (Windows-snap behaviour)

- Default **50/50**.
- **Continuous drag** — the ratio is free, not stepped.
- **Magnetic snap at 50%**: a small dead zone near centre so restoring the even split is easy.
- **Double-click resets to 50/50.**
- **Minimum pane width ~360px.** Dragging past the minimum closes that pane and the other goes
  full width, matching Windows.
- The ratio persists with the layout.

### Sidebars that fold themselves

Two fixed-width sidebars dominate the width budget:

| Sidebar | Width | Location |
|---|---|---|
| Pipeline History (Clean) | `230px`, `flexShrink:0` | `History.jsx:84` |
| Estimator sidebar (Model) | `300px`, `flexShrink:0` | `ModelingTab.jsx:2019` |

At 1280px split evenly, Clean is left with ~410px of content and Model with ~340px — too tight.
Each sidebar therefore observes **its own container width** with `ResizeObserver` (the pattern
`PlotBuilder` already uses) and folds to a narrow rail below **~700px**, with a button to open it
as a temporary overlay above the content. Widening the pane restores it, continuously while
dragging.

This is deliberately self-contained per sidebar rather than a prop threaded from `App`: it
depends only on the observed width, so it also improves small laptops today, with no split
involved.

---

## Phases

1. **Collapsible sidebars** with width-driven auto-fold. Ships value on its own, no split, near-zero risk.
2. **Two-pane split**: pane state, `paneBox`, focus, WorkspaceBar assignment + ⊞ toggle, draggable divider with snap/min-width, layout persistence.
3. **N panes** (optional). The coordinate mechanism already generalises — it is just dividing widths — but with these sidebars three panes are only usable on a very wide monitor. Not committed.

---

## Decisions taken as defaults (not asked)

- **Coach sidebar (`AIContextSidebar`) stays global**, outside the split, acting on the focused
  pane's context. Per-pane coach instances would duplicate chat sessions and credit spend.
- **Layout persists** in sessionStorage scoped per project pid — `panes`, `focusedPane` and
  `paneRatio` — following the existing `litux:wrangle_tab:${pid}` convention.

---

## Out of scope / known limitations

- **Modals are viewport-centred, not pane-confined.** The Standardize dialog (`CleanTab`) and
  `AuditTrail` will cover both panes in split mode. Confining them requires reparenting into the
  pane, which is precisely the cost this design avoids. Accepted for the MVP.
- **Same module twice is not supported** — structurally impossible by design (see above), and
  the swap behaviour is the intended answer.
- **Vertical (stacked) split** is not in scope; horizontal only.

---

## Risks

- `tabPanel` is spread at ~9 call sites in `App.jsx`; the change is mechanical but wide, so each
  panel must be checked for panels that pass extra `flexDirection` styling.
- Modules with internal `position:fixed` click-outside overlays (the dropdown scrims in
  `WranglingModule`) span the viewport by design and are unaffected, but should be eyeballed once
  in split mode.
- Charts sized by `ResizeObserver` (PlotBuilder, spatial maps) must re-measure when the divider
  moves; verify no stale canvas widths after a drag.

---

## Files expected to change

- `src/App.jsx` — pane state, `paneBox`, divider, focus handling, derived `activeTab`.
- `src/components/workspace/WorkspaceBar.jsx` — ⊞ toggle, open-tab markers, assign-to-focused-pane.
- `src/components/wrangling/History.jsx` — self-observed collapse.
- `src/components/ModelingTab.jsx` — self-observed collapse of the estimator sidebar.
- New: a small `SplitDivider` component (drag, snap, double-click reset).
