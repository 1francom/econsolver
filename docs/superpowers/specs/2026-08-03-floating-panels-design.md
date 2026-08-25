# Floating panels

**Date:** 2026-08-03
**Status:** spec approved by Franco; implementation plan not yet written
**Origin:** IDEAS.md Idea 5 — *"Add multipanel/multiwindows displays, like we did with the
distinct function… Example: pinned plots are opened in a separate window display, just like
in R we have the plot viewer."* Feasibility graded 5 (in-page panels) / 1 (real OS windows).

---

## 1 · Problem

`DistinctValuesPanel.jsx` introduced a pattern this app did not have: a floating,
non-modal, minimizable panel that stays visible while the user keeps working elsewhere —
deliberately unlike `AuditTrail.jsx`'s full-screen dimmed overlay, which blocks. The
pattern works, and there is now a second thing that wants it (saved artifacts), but the
shell is fused to its one use: the frame, the close/minimize buttons, the fixed
bottom-right position and the distinct-values query all live in the same 110-line
component.

Two things are needed: a reusable shell, and a policy for what happens when more than one
panel is open.

### The constraint that shapes everything

`WranglingModule.jsx:853-863` already documents it:

> *"switching to Model/Explore hides the panel (`display:none` on an ancestor hides
> `position:fixed` descendants too) but preserves its state"*

Confirmed: App keeps tab panels mounted with `display:"none"` to preserve their state
(`App.jsx:2785`, `App.jsx:3215`). So **a floating panel mounted inside a module is
invisible whenever that module is not the active tab.** For the distinct-values panel that
is correct behaviour — its columns belong to Clean. For a plot viewer it is exactly wrong:
the entire point is to look at a chart *while* building a model in another tab.

### What already exists and must not be reinvented

- `ExplorePinBar.jsx:102` receives a `renderPlot(item)` callback that reconstructs a live
  chart from `item.params`. A floating viewer consumes that; it does not need a new
  rendering path.
- `services/Persistence/artifactOrder.js` already defines a unified artifact concept —
  a closed type set (`plot` | `map` | `model`), namespaced ids, and a project-scoped
  persisted display/replication order, with `orderArtifacts()` to apply it.

---

## 2 · Scope

**v1 ships two panels**, chosen so the abstraction is exercised at both extremes rather
than validated against a single case:

| Panel | Scope | Content |
|---|---|---|
| **Artifact Viewer** *(new)* | app | saved plots, maps and models, navigated ◀ ▶ in the project's existing artifact order |
| **Distinct Values** *(migrated)* | module | unchanged behaviour; still hides on leaving Clean |

If both consumers had the same scope the abstraction would be untested, and the second
scope would break it on arrival.

**Out of v1, deliberately:**

- **Drag and resize.** Panels stack; dragging unstacks them and hands window management
  back to the user, which is what the stacked layout exists to avoid. Additive later, no
  redesign needed.
- **`AuditTrail`'s modal.** A different pattern on purpose — it dims and blocks because it
  wants undivided attention. Untouched.
- **Real OS windows** (`window.open`). Severs the React tree, the inline-style theming and
  the DuckDB singleton. This is the "1" in the IDEAS.md grade.
- **Explore's session pins as panel content.** The viewer shows *saved* artifacts;
  ephemeral session pins are a separate collection and stay in `ExplorePinBar`.

---

## 3 · The shell, and one simplification

`<FloatingPanel>` is **presentational only**: title bar, minimize, close, frame, stacking
registration. It does not know what it displays or where it lives.

**Scope is not a prop — it is the mount point.**

- *module* scope → mounted inside the module, as today. It inherits the tab panel's
  `display:none`, which is why it hides on leaving and returns with its state intact.
- *app* scope → mounted in a single `PanelHost` at App level, a sibling of the tab panels,
  so no `display:none` reaches it.

This satisfies "each panel declares its scope" without a `scope` prop or conditional
branches inside the component. A component with two behaviours must be read end to end to
know which one you get; two mount points make the decision visible at the import.

---

## 4 · Stacking

The two panels live in different React trees and cannot coordinate through layout. A
`PanelStackContext` provider at App level hands out positions: each panel registers
`{id, height, visible}` and receives its offset from the bottom-right corner.

`visible` is load-bearing, not decorative. A module-scoped panel hidden by `display:none`
**is still mounted and still registered** — without the flag it would reserve its slot and
the Artifact Viewer would float above an invisible gap. App already knows which tab is
active (it computes the `display:none`), so this is one boolean threaded down.

This offset math over visible-only panels is the one piece of genuinely new logic in this
spec, and it gets a unit test (§6).

---

## 5 · Artifact Viewer content

Navigates `orderArtifacts(artifacts, await getArtifactOrder(pid))`.

The consequence worth stating: the panel shows **the same sequence the replication bundle
emits**, because it is literally the same order. What the user sees and what they export
cannot drift apart — a class of bug this codebase has hit before in other export paths.

Open/minimized state and the current index persist in `sessionStorage`, **keyed by `pid`**,
per the project invariant that no state bleeds between projects.

---

## 6 · Validation

Little to validate numerically — this is UI.

- `npm run build` and `npm run lint:undef` green.
- A new `.mjs` harness for the `PanelStackContext` offset computation: offsets must be
  assigned over *visible* panels only, so a hidden-but-registered panel leaves no gap.
  Cases: nothing open, one visible, one visible + one hidden, two visible, and a panel
  toggling visibility.
- `orderArtifacts` needs **no** new coverage — `services/Persistence/__validation__/artifactOrderValidation.mjs`
  already tests both the honoured-order path and the `unknown`-append-by-`savedAt` branch,
  including the empty-order case.
- No browser validation (project rule); Franco does the browser pass.

**Addendum, 2026-08-22 (Franco's report):** the panel showed "No saved plots or maps" despite
a pinned Explore Time Series analysis sitting in `ExplorePinBar` at the bottom of the same
screen. Root cause was scoped-out at v1, not a regression: `getExplorePins`/`saveExplorePins`
already existed as a third sibling of `getPlotHistory`/`getMapHistory` in `plotHistory.js` —
same file, same IndexedDB store, same project-scoped `pid` convention — but this panel's fetch
`useEffect` never called it. Explore's descriptive-stat/time-series pins (`{kind, label,
params}`, rendered by `ExplorePinBar`'s own `renderPinnedPlot`, a function local to
`ExplorerModule`'s closure) are structurally unlike a PlotBuilder entry — heterogeneous params
per `kind`, and no stored `datasetId` to resolve rows against, since a pin is implicitly scoped
to whatever dataset Explore was open on. Given `renderPinnedPlot` isn't a reusable, stateless
renderer, Explore pins get the identical "summary card + open" treatment §5's Maps already use
for the identical reason class (no generic renderer available) — reusing `ExplorePinBar`'s own
`KIND_ICON` map (now exported) rather than a second copy, and the pin's own `label` (already
the human-readable string `ExplorePinBar` itself displays) instead of hand-written per-kind
copy. `App.jsx`'s `onOpenArtifact` gained a matching `kind === "explore"` branch that only
navigates to Explore (no dataset-switch attempt, mirroring the Map branch's own simplicity,
since there is no `datasetId` to switch on). **Found in passing, deliberately not fixed:** this
plan's own §1 table lists "models" alongside plots/maps as Artifact Viewer content, and the
completed implementation plan's task notes describe "Maps/models" as sharing the v1
summary-card boundary — but no `kind === "model"` branch was ever built; pinned models are
used only for replication-bundle ORDERING (`ReportingModule.jsx`'s `makeArtifactId("model",
…)`), never for browsing here. Not touched now because pinned models already have a dedicated,
richer browsing surface (`ModelBufferBar`'s own ◀ ▶, labels, and restore-into-sidebar) that a
generic summary card would duplicate rather than improve — a decision for Franco, not a bug.

## 7 · Help copy

Per the CLAUDE.md convention, a new thing the user opens from the UI updates the module's
`HintBox` in the same change:

- **Explore** (`ExplorerModule.jsx:2589`) and **Model** (`components/ModelingTab.jsx:2117`) —
  the Artifact Viewer is reachable from both.
- One row in `APP_CAPABILITY_MAP` (`services/AI/appCapabilityMap.js`) so the coach's
  navigation guidance knows the panel exists.
- No counts written into the prose, per project rule — the panels are named.
