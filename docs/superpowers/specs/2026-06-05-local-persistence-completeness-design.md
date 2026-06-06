# Phase 4b — Local Persistence Completeness (design)

**Date:** 2026-06-05
**Status:** OPEN
**Author / Executor:** Claude.
**Source:** roadmap item #4 (cross-device persistence), decomposed. This is **4b — local only**: durably persist every project artifact to IndexedDB so nothing is lost on reload or when reopening a project. The opt-in cloud sync + E2EE ("publish a project, like GitHub/OneDrive") is **Phase 4a**, specced later and built on top of this.

## Model & invariants

- **Local-by-default.** The app stays fully client-side and private. 4b adds no network/server anything — it only completes local IndexedDB persistence. (Privacy-first invariant untouched.)
- **Project-scoped.** Every artifact is keyed by `pid` and restored when that project opens; switching projects swaps state cleanly.
- **IndexedDB, not localStorage** (existing invariant). Current DB version is **8**; this bumps to **9** for two new stores.
- **Non-destructive / replayable** pipeline unchanged.

## Current state (verified 2026-06-05)

| Artifact | Persisted? | Where |
|---|---|---|
| Pipelines, projects, raw datasets, dataset registry, coach chats, workbench (Calculate equations) | ✅ | `indexedDB.js` stores (v8) |
| Plots | ✅ (pid-scoped) | `plotHistory.js` — key `plotHistory_<pid>` in the `pipelines` store |
| **Pinned models / comparison buffer** | ❌ in-memory singleton | `services/modelBuffer.js` (`_buf` array, MAX 8; no pid, no persistence) |
| **Maps (spatial layer configs)** | ❌ component state | `SpatialPlotTab.jsx` / `SpatialGeoPlot.jsx` |

Scope (confirmed): **pinned models + comparison only** for the Modeling tab (NOT the active estimator/variable-selection/subsets session). Plus maps. Plus verify plots + equations restore on open.

---

## Part A — Pinned models persistence

**Goal:** the pinned-model comparison buffer survives reload and is restored per project.

### A1. New IDB store (`indexedDB.js`, bump v8→v9)
- Add store `model_buffer`, `keyPath: "pid"`. Record shape `{ pid, models: TrimmedResult[], ts }`.
- Export `saveModelBuffer(pid, models)` / `loadModelBuffer(pid)` / `deleteModelBuffer(pid)` mirroring the existing `saveCoachChats`/`loadCoachChats` pattern.

### A2. Trim heavy fields before persisting
EstimationResult objects carry large arrays (fitted values, residuals, full vcov) that bloat storage and aren't needed to redisplay a comparison. Persist a **comparison-sufficient** projection: `id, label/modelLabel, type, spec` (yVar/xVars/zVars/wVars/entityCol/timeCol/cutoff/etc.), `varNames, beta, se, pVals, tStats, R2, adjR2, n, df, Fstat, Fpval, att/attSE/attP, late/lateSE/lateP, seType`, and RDD/SC summary scalars. **Strip** `fittedValues`, `residuals`, `firstStages[].*` large arrays, and any `vcov`/large matrices. (Reuse/extend the `trimResult` projection already in `services/AI/sessionSnapshot.js` — factor it into a shared helper `src/services/persistence/trimResult.js` so snapshot + buffer share one definition.)
- Note in the UI/spec: restored pinned models are **display- and export-capable** (ModelComparison, LaTeX/forest export) but not re-diagnosable from stripped arrays; re-running the estimator (data + pipeline persist) reproduces the full result if needed.

### A3. Make `modelBuffer` project-aware
`modelBuffer.js` is a singleton. Add:
- `setProject(pid)` — sets the current pid, loads `loadModelBuffer(pid)` into `_buf`, notifies subscribers.
- On `add`/`remove`/`clear`, debounce-persist `saveModelBuffer(currentPid, _buf.map(trim))` (e.g. 400ms).
- Keep the existing synchronous in-memory API for consumers (ModelBufferBar, ModelComparison) — persistence is a side effect.
- Guard: if no pid set (e.g. pre-project), behave as today (in-memory only, no save).

### A4. Wire into the project lifecycle
- `DataStudio` (or `ModelingTab` via a prop) calls `modelBuffer.setProject(projectPid)` when a project opens / `pid` changes, so the buffer loads that project's pinned models and subsequent edits save under it.

---

## Part B — Maps persistence

**Goal:** a spatial map the user built (layers, basemap, color scales, bound columns) is restored on reopen.

### B1. New IDB store (`indexedDB.js`, v9)
- Add store `spatial_maps`, `keyPath: "pid"`. Record `{ pid, maps: SerializableMapConfig, ts }`.
- Export `saveSpatialMaps(pid, config)` / `loadSpatialMaps(pid)` / `deleteSpatialMaps(pid)`.

### B2. Serialize the layer config (not the rendered tiles)
The map's reproducible state = its **layer definitions**: per-layer `{ datasetId/column refs, geom type, basemap id, color scale config, opacity, radius, legend settings }`. The Leaflet/Observable render is rebuilt from this on load. Identify the authoritative config object in `SpatialPlotTab.jsx` (Map tab) and `SpatialGeoPlot.jsx` (Plot tab); ensure it is a plain serializable object (no Leaflet instances).

### B3. Lift + persist
- Lift the layer-config state so the Spatial tab can emit it on change (debounced `saveSpatialMaps(pid, config)`) and accept it on mount (`loadSpatialMaps(pid)` → hydrate).
- On project open, restore; on dataset removal, prune layers referencing the gone dataset (fail-soft: skip a layer whose `datasetId`/columns no longer exist rather than crash).

> If lifting full map state proves large, MVP can persist only the **Map tab** (`SpatialPlotTab`) layer config and defer the geo-plot tab — but prefer both if the config objects are already plain.

---

## Part C — Verify plots & equations restore on open

These already persist; confirm the **load path** exists and is pid-scoped.
- **Plots:** `plotHistory.getPlotHistory(pid)` — confirm a consumer (PlotBuilder/Explorer) loads it on mount for the active `pid` and that saves happen on plot create. If the load-on-open is missing, add it.
- **Calculate equations:** `workbenchStore` + `loadWorkbenchRecord(pid)` — confirm CalculateTab restores the workbench on open. If missing, add it.
- No schema change expected here — this is a wiring/verification part.

---

## Part D — Project switch & cleanup

- On project delete (`deleteProject`), also delete `model_buffer`, `spatial_maps` for that pid (extend the existing cascade alongside `deleteCoachChats`/`deleteDatasetRegistry`).
- On project switch, `modelBuffer.setProject(newPid)` and the Spatial tab reloads — no bleed between projects (mirror the `<DataStudio key={pid}>` remount discipline already used for project isolation).

---

## Testing / validation

- Node harness `src/services/Persistence/__validation__/trimResult.test.mjs`: `trimResult` keeps comparison fields, strips `fittedValues`/`residuals`/large arrays, round-trips through JSON.
- `npm run build` clean.
- Browser (Franco): (1) pin 2 models → reload → comparison buffer restored; (2) build a spatial map → reload → map restored; (3) switch projects → each project shows only its own pinned models/maps (no bleed); (4) create a plot and a Calculate equation → reload → both restored; (5) delete a project → its model_buffer/spatial_maps are gone.

## File checklist

- [ ] `src/services/Persistence/indexedDB.js` — bump to v9; add `model_buffer` + `spatial_maps` stores + save/load/delete fns; extend the delete-project cascade.
- [ ] `src/services/persistence/trimResult.js` — NEW shared trim helper (used by modelBuffer + sessionSnapshot).
- [ ] `src/services/AI/sessionSnapshot.js` — use the shared `trimResult`.
- [ ] `src/services/modelBuffer.js` — `setProject(pid)` + debounced persistence.
- [ ] `src/DataStudio.jsx` — call `modelBuffer.setProject(pid)` on open; restore spatial maps; verify plot/equation restore.
- [ ] `src/components/tabs/spatial/map/SpatialPlotTab.jsx` (+ `plot/SpatialGeoPlot.jsx`) — lift/emit/hydrate layer config.
- [ ] `src/components/PlotBuilder.jsx` / Explorer + `CalculateTab.jsx` — confirm/add load-on-open (Part C).
- [ ] `src/services/Persistence/__validation__/trimResult.test.mjs` — NEW harness.
- [ ] `CLAUDE.md` — note v9 stores + new files.

## Out of scope (→ later phases)
- Any cloud/server/sync (Phase 4a).
- Full Modeling-session restore (active estimator/variables/inference/subsets) — only pinned models here.
- E2EE / passphrase / publish-project UI (Phase 4a).
- Persisting rendered map tiles or plot bitmaps (only the reproducible config).
