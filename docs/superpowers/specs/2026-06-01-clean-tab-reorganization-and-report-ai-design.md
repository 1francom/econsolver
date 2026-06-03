# Design: Clean Tab Reorganization + Report AI Unified Script
**Date:** 2026-06-01  
**Status:** Approved  
**Scope:** Two independent but related improvements — UI surgery on the Clean tab, and a cross-module session log that feeds the Report AI.

---

## Background

The Report AI currently only sees the Clean pipeline and the active model result. Spatial operations, Calculate equations, and Simulate parameters are invisible to it. Separately, the Clean tab has accumulated redundant subtabs (Dummies, Panel no idx) and a fragmented layout (Numbers/Strings split, Reshape and Merge as separate top-level tabs).

The goal is reproducible unified scripts where logic is deterministic, and descriptive narrative comments where it is not (e.g. Monte Carlo simulation).

---

## Part 1 — Clean Tab Reorganization

### Changes to FeatureTab.jsx (Transform subtabs)

| Current | Action | Reason |
|---------|--------|--------|
| Panel (no idx) | **Remove** | Covered by Panel Structure tab with proper index |
| Dummies | **Remove** | Covered by `mutate` with `ifelse`/`case_when`; FE models compute dummies automatically |
| Numbers | **Merge → Formatting** | Numbers and Strings are both column-formatting concerns |
| Strings | **Merge → Formatting** | (same as above) |

The Formatting subtab contains the union of Numbers and Strings operations. No logic is deleted — only the split is removed.

### Changes to WranglingModule top-level tabs

| Current tabs | After |
|---|---|
| `[Clean, Panel, Transform, Reshape, Dictionary, Merge, Subset]` | `[Clean, Panel, Transform, Dictionary, Reshape & Merge, Subset]` |

**Reshape & Merge** is a single tab with two clearly labeled sections:
- **Reshape** — `pivot_longer`, `group_summarize` (from current ReshapeTab.jsx)
- **Merge** — LEFT/INNER JOIN, APPEND (from current MergeTab.jsx)

The two sections can be rendered as visual dividers within one component, or as two inner sub-tabs — whichever is cleaner. Both are backed by existing runner.js step types; no new steps needed.

### Files touched
- `src/components/wrangling/FeatureTab.jsx` — remove two subtabs, merge two into one
- `src/WranglingModule.jsx` — remove Reshape + Merge tab entries, add Reshape & Merge
- `src/components/wrangling/ReshapeTab.jsx` — becomes a section inside the new combined tab (or is inlined)
- `src/components/wrangling/MergeTab.jsx` — same

---

## Part 2 — Report AI: Cross-Module Session Log

### Motivation

The Clean pipeline (runner.js) is the primary reproducibility artifact, but users also perform operations in Spatial, Calculate, and Simulate that should appear in the unified replication script. These modules currently leave no trace visible to the Report AI.

### Session Log Shape

A new lightweight log stored in React context (not IndexedDB — session-only, ephemeral):

```js
// One entry per user-initiated operation
{
  id:           string,       // uuid
  module:       "spatial" | "calculate" | "simulate",
  timestamp:    number,       // Date.now()
  opType:       string,       // e.g. "buffer_assign", "equation", "mc_run"
  params:       object,       // everything needed to reproduce or describe
  reproducible: boolean,      // true → emit code; false → emit comment
  label:        string,       // human-readable one-liner for the comment
}
```

### What each module writes

| Module | Op type | reproducible | Notes |
|--------|---------|-------------|-------|
| Spatial | `buffer_assign`, `distance`, `grid_assign`, `spatial_join`, `nearest_neighbor`, `geocode`, `crs_transform` | `true` | Adds columns to dataset — generate Python/R/Stata code |
| Spatial | `map_render`, `plot_render` | `false` | Visualization only — emit descriptive comment |
| Calculate | `equation` | `true` | Python preferred; R and Stata get best-effort translation |
| Simulate | `mc_run` | `false` | Stochastic by design — emit parameter comment |

### Where the log lives

New file: `src/services/session/sessionLog.jsx`  
Exports:
- `SessionLogProvider` — wraps the app (added to `App.jsx` context tree)
- `useSessionLog()` — returns `{ log, appendLog, clearLog }`

Each module calls `appendLog(entry)` when the user executes an operation and clicks a save/apply button (not on every UI change).

### Report AI integration

`buildSessionSnapshot` in `sessionSnapshot.js` is extended to accept `sessionLog`:

```js
buildSessionSnapshot({ cleanedData, result, sessionLog, availableDatasets })
```

`serializeSnapshot` serializes the log as a new section:

```
MODULE OPERATIONS (chronological):
  1. [spatial] buffer_assign — col="buffer_500m", radius=500, unit=m
  2. [calculate] equation — f(x) = 2x² - 3x + 1 (Python: 2*x**2 - 3*x + 1)
  3. [simulate] mc_run — n=1000, dist=normal, mean=0, sd=1 (non-reproducible)
```

`generateUnifiedScript` maps each reproducible entry to a code block per language. Spatial entries use a new `spatialOpToScript(entry, language)` helper in `services/export/spatialScript.js`. Non-reproducible entries become comments.

### Fix for existing gaps (found during analysis)

Two gaps identified in the current Report AI that get fixed in this same pass:

1. **`exporter.js` hardcoded load line** — `generateCleanScript` is updated to accept `loadOpts` and delegate to `buildRLoadLine`/`buildPyLoadLine`/`buildStataLoadLine` from `loadLine.js`. The call in `ReportingModule.jsx` passes `cleanedData?.loadOpts`.

2. **`allDatasets: {}` for join/append steps** — `ReportingModule` receives `availableDatasets` as a new prop from `App.jsx`. A map `{ [id]: { name, filename } }` is built from it and passed to `generateCleanScript`.

### Files touched
- `src/services/session/sessionLog.jsx` — **new** — context + hook
- `src/App.jsx` — add `SessionLogProvider`, pass `availableDatasets` to `ReportingModule`
- `src/ReportingModule.jsx` — accept `availableDatasets`, thread into `generateCleanScript`; pass `sessionLog` into `buildSessionSnapshot`
- `src/services/AI/sessionSnapshot.js` — extend `buildSessionSnapshot` + `serializeSnapshot`
- `src/pipeline/exporter.js` — accept + use `loadOpts` in `generateCleanScript`
- `src/services/export/spatialScript.js` — **new** — `spatialOpToScript(entry, language)`
- `src/components/tabs/spatial/analyze/*.jsx` — call `appendLog` on apply
- `src/components/tabs/CalculateTab.jsx` — call `appendLog` on equation save
- `src/components/tabs/SimulateTab.jsx` — call `appendLog` on MC run

### Out of scope
- Persisting the session log to IndexedDB (log is ephemeral; reloading the page clears it)
- Spatial → Clean pipeline injection (not needed given current linear workflow)
- Porting Explore summarise to Clean (separate future task)

---

## Implementation order

1. **Part 1** — Clean tab UI surgery (self-contained, no logic changes)
2. **Part 2a** — Fix the two existing Report AI gaps (load line + allDatasets)
3. **Part 2b** — Session log infrastructure (`sessionLog.jsx` + context wiring)
4. **Part 2c** — Module write points (Spatial, Calculate, Simulate)
5. **Part 2d** — Report AI consumes the log (snapshot + script generation)
