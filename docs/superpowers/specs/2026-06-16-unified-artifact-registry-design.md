# Unified Project-Artifact Registry — Persistent, Cross-Dataset Plots/Maps/Models + Always-Available Report

**Date:** 2026-06-16
**Status:** OPEN
**Author:** Claude (brainstormed + design-approved with Franco)

## Problem

Two user-reported bugs and a feature request, all rooted in artifact scoping:

1. **Report locked after refresh.** A refresh is a new session. Pinned models survive (they live in the
   project-scoped `model_buffer` IndexedDB store), but the **Report** tab becomes unavailable. If a user did
   all their work and left it saved, they should be able to go straight to Report and replicate with AI
   scripts — even without re-running anything.

2. **Pinned plots/models vanish on dataset switch.** In Explore, `PlotBuilder` history is keyed by the
   **dataset id** (`ExplorerModule` is `key/pid = tabDsId("explore")`), so switching datasets shows a
   different history — plots appear to disappear. The user wants saved plots and pinned models to **persist
   across all datasets in a project** so they can compare visuals/models built on different datasets.

3. **Click-to-edit, rename, reorder, full replication.** Clicking a saved plot/model should **auto-switch the
   active dataset** to that artifact's source so it can be edited without using the Dataset Manager. All saved
   plots and pinned models should be **renamable** (maps already are) and **reorderable**, and **every**
   artifact must be translated to **R / Python / Stata** and flow into **Report** for Claude to read and
   replicate in a single script.

## Current state (what already works — do not rebuild)

- **Plot translation:** `buildGgplot` (R), `buildMatplotlibPlot` (Python), `buildStataPlot` (Stata) —
  `services/export/plotScript.js`.
- **Map translation:** `buildLeafletR` (R), `buildFoliumPy` (Python); Stata = documented comment (no Leaflet).
- **Model translation:** R/Python/Stata via `rScript.js` / `pythonScript.js` / `stataScript.js` + the AI
  unified script (`generateUnifiedScript`).
- **Report aggregation:** `ReportingModule.jsx:1108-1164` already queries plot + map history across **every
  dataset id plus the project pid** (`histPids`), dedupes, and weaves Plots/Maps sections into the unified
  script. Models flow in via `pinnedModels` + `replicateMode` ("active" | "all").

So translation and cross-dataset Report aggregation already exist. The gaps are **UI scoping, rename,
ordering, click-to-switch, and Report availability** — not a translation rewrite and not a storage rewrite.

## Design

Layered approach: keep the existing three stores (`plotHistory_<pid>`, `mapHistory_<pid>`, `model_buffer`)
and the existing translators; add scoping fixes, per-artifact metadata (name, source dataset), a thin global
ordering array, and the Report availability fix.

### Part 1 — Report available when work is saved

- **App-level model buffer load.** Add one effect in `App.jsx` keyed on `pid`: call
  `modelBuffer.setProject(pid)` and seed `modelingSession.pinnedModels` from `modelBuffer.getAll()`.
  `ModelingTab` keeps writing through the same singleton and notifying App via `onSessionStateChange`, so
  state stays in sync — App simply no longer *depends* on the Model tab being mounted.
- **Unlock Report** when there is dataset output **or** `pinnedModels.length > 0`. The `WorkspaceBar` gate for
  the report tab gets an extra signal (e.g. App computes `hasOutput` for the report tab as
  `output || rawRows || pinnedModels.length > 0`).
- **Render Report from models.** When `reportCleanedData` is null but pinned models exist, render
  `ReportingModule` (replication is driven by each model's stored spec/pipeline/snapshot, not the live
  dataset) instead of `NeedsOutput`.

### Part 2 — Plots persist & compare across datasets (Explore)

- Thread the **real project `pid`** (`projectPid`) App → `ExplorerModule` → `PlotBuilder`, and key
  `plotHistory` + explore pins by **project pid** instead of dataset id. Data still comes from the active
  dataset.
- On first project-scoped load, **best-effort merge** the current dataset's legacy
  (`plotHistory_<datasetId>`) entries so existing plots aren't lost.
- Stamp every saved plot entry with `datasetId` + dataset name.
- Models already project-scoped; add the same `datasetId` tag to each pinned result (alongside the existing
  `spec.filename`).

### Part 3 — Rename, everywhere

- **Plots:** inline rename of `entry.name` in PlotBuilder's history list; persist via `savePlotHistory`.
- **Models:** add a renamable `label` to each pinned model, shown in the Model buffer bar; persist via the
  model buffer (trimmed result keeps `label`).
- **Maps:** already renamable (no change).

### Part 4 — One global ordered list driving the script

- **Per-module reorder:** reorder within each module — plots in Explore, models in the buffer bar, maps in
  Spatial. Persists to each module's own store (array order).
- **Global order array:** new tiny persisted record `artifactOrder_<pid>` (reuse the `pipelines`
  store, same pattern as `plotHistory.js`) = ordered list of **namespaced ids**: `plot:<id>`, `map:<id>`,
  `model:<id>`.
- **Report owns the global order.** Report builds the unified artifact list (plots + maps + models), sorts by
  `artifactOrder_<pid>` (ids not present append by `savedAt`), and lets the user **drag to set the global
  order**. That order drives the single R/Python/Stata script top-to-bottom (the deterministic visual/model
  sections are emitted in this order).

### Part 5 — Click an artifact → switch dataset

- **Models:** `ModelingTab` is not remounted on dataset change, so clicking a pinned chip calls a new
  `onSwitchDataset(datasetId)` → `selectDataset("model", datasetId)`; the `cleanedData` prop updates in place.
- **Plots:** `ExplorerModule` *does* remount on dataset change (`key=datasetId`). Clicking a history entry
  whose `datasetId ≠ current` sets a **pending-plot handoff** in App (`{datasetId, plotId}`, same pattern as
  `assistantPrefill`) and switches the dataset. The remounted `ExplorerModule` reads the handoff, loads that
  plot from the now project-scoped history, and clears it.

## Scope

**In scope:** Explore `PlotBuilder` plots, Spatial maps, `ModelingTab` pinned models; Report availability;
rename + reorder + click-to-switch; global ordering feeding the unified script.

**Out of scope (YAGNI):**
- A separate top-level unified panel (chosen model = per-module management + Report aggregates).
- Rewriting the three stores into a single registry (the ordering array layers over them).
- Stata Leaflet output (documented limitation — comment directs user to R/Python).
- The ModelingTab-embedded PlotBuilder's own history (only the Explore PlotBuilder is in scope).

## Architectural invariants honored

- Zero React in math/core; inline styles with the `C`/`T` theme tokens; surgical `Edit` patches.
- IndexedDB only (the new `artifactOrder_<pid>` reuses the existing `pipelines` store — no schema bump).
- AI egress unchanged; `callClaude`/`generateUnifiedScript` caching path untouched.
- `lint:undef` + build must stay green; Franco validates in the browser before sign-off.

## Validation

- `npm run lint:undef` + build green.
- Browser (Franco): (1) refresh with pinned models → Report unlocked + usable; (2) save plots on dataset A and
  B, switch datasets in Explore → both visible; (3) rename a plot and a model; (4) reorder the global list in
  Report and confirm the script order changes; (5) click a plot/model → active dataset switches to its source;
  (6) generate the unified R/Python/Stata script and confirm every saved plot, map, and model appears in the
  chosen order.
