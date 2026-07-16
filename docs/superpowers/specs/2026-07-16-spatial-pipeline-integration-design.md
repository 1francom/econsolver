# Spatial Pipeline Integration — Design

**Date:** 2026-07-16
**Status:** Spec approved section-by-section by Franco in brainstorming session
**Goal:** everything the user creates in the Spatial module (Analyze sections) becomes part of the
non-destructive pipeline — replayable, undoable, and eventually replicable in R/Python/Stata —
sharing the per-dataset Clean pipeline so execution order is a single timeline.

## Problem

Spatial Analyze sections compute results via pure `SpatialEngine.js` functions, hold them as
`pendingRows`, and save via `OutputPanel` → `onAddDataset(name, rows, headers)` →
`addApiData` — a **materialized dataset with no recipe**. Consequences:

- No replay: the operation cannot be re-run on updated parent data.
- No undo/History entry.
- No replication: the derivation edge is invisible to the workspace script generator, so any
  chain through a spatial dataset is unreplicable (the exact gap flagged in the 2026-06-12
  replication-fidelity design for derived subsets).
- Only trace is an ephemeral `sessionLog` entry (lost on reload).

Precedents already in the codebase that this design builds on:

- `geocode` is already a pipeline step (`runner.js` ~line 1679).
- `join` already resolves secondary datasets via `context.datasets[s.rightId]`.
- `studioRef.current.addInjectColumnStep` (DataStudio.jsx ~1114) already lets a non-Clean tab
  append a step to a dataset's pipeline (used by ModelingTab's Extract panel).
- `handleSaveSubset(name, rows, headers, recipe)` (DataStudio.jsx ~953) already records a
  derivation edge (`ADD_GLOBAL_STEP`, `opType:"derive"`) when given a recipe.

## Decisions (Franco, 2026-07-16)

1. **Hybrid model (option C):** column-adding ops become in-place pipeline steps on the active
   dataset; dataset-producing ops keep the save-as-new-dataset flow but record a derivation edge.
2. **Preview → explicit commit (option A):** `Apply` in each section stays a local preview;
   committing is a separate button. No auto-apply.
3. **Pipeline integration first, replication translators later (option B):** this spec covers
   steps + runner + registry + UI + derive edges. R/Python/Stata translators for `sp_*` steps are
   a follow-up; until then untranslated steps must emit a visible
   `# spatial step not yet translated` comment in generated scripts, never silently drop.

## Step catalogue

Each Analyze section serializes its operation as a flat-params step, replayed in `runner.js` by
calling the same pure `SpatialEngine.js` function the section already uses.

| Section | Step type | Category | Key params |
|---|---|---|---|
| Distance to Point | `sp_distance` | column | latCol, lonCol, refLat, refLon, outCol, metric, binCol |
| CRS Transformer | `sp_crs_transform` | column | srcCols, fromEPSG, toEPSG, outCols |
| Buffer Indicator | `sp_buffer` | column | latCol, lonCol, refLat, refLon, radiusKm, outCol |
| Grid Assignment | `sp_grid_assign` | column | latCol, lonCol, gridDatasetId, gridIdCol, outCol |
| Spatial Join | `sp_spatial_join` | column | latCol, lonCol, polyDatasetId, wktCol, attrCols, carryGeometry |
| Nearest Neighbour | `sp_nearest` | column | latCol, lonCol, targetDatasetId, targetLatCol, targetLonCol, outCols |
| Distance to Boundary | `sp_boundary_dist` | column | latCol, lonCol, polyDatasetId, wktCol, outCol |
| Geocode | `geocode` (exists) | column | reuse the existing step; the section emits it instead of pendingRows |
| Metric Buffers | `sp_metric_buffer` | new dataset (derive edge) | source, radius, mode |
| Buffer Exposure | `sp_buffer_exposure` | per mode¹ | dissolve/overlap params |
| Aggregate to Grid | `sp_aggregate_grid` | new dataset (derive edge) | pointDatasetId, gridDatasetId, agg, valueCol |
| Areal Interpolation | `sp_areal_interp` | new dataset (derive edge)² | srcDatasetId, tgtDatasetId, valueCols, weightMode |

¹ Buffer Exposure: if the mode adds an exposure column to the active points → column step; if it
produces dissolved polygons → new dataset. Resolve by reading the section at implementation time.

² Areal Interpolation writes columns onto the *target polygon* dataset, which may not be the
active one — treating it as a dataset derived from the target avoids appending steps to a
non-active dataset's pipeline.

Secondary-dataset references (`gridDatasetId`, `polyDatasetId`, …) resolve through
`context.datasets[id]` at replay, identically to `join`. The I4 real-filename resolution rule
(`stepTranslators.js`) will apply when translators arrive.

### Derived datasets are snapshots, not live views

Dataset-producers materialize rows (as today) *plus* record the recipe. If the parent dataset's
pipeline changes later, the derived dataset does **not** auto-recompute — same contract as
existing subsets. The recipe guarantees faithful replication as-of creation time. Column-adder
steps, by contrast, are live: they re-run on every pipeline replay, and downstream Clean joins see
the spatial columns because joins operate on post-pipeline versions.

Derived datasets are first-class: they appear in the dataset manager and can be joined in Clean
(both directions). The derive edge and join G-steps both live in `globalPipeline`, and
`generateWorkspaceScript` already topo-sorts them, so chains like
`points → sp_aggregate_grid → grid → join into comunas` emit in correct order.

## Runner / registry integration

- **`runner.js`:** one `case` per `sp_*` type, each calling the existing `SpatialEngine.js`
  function. No new computation logic — only param serialization.
- **`registry.js`:** one entry per type, new category `"spatial"`. The
  `pipelineReliabilityValidation.mjs` harness (T5) enforces registry↔runner sync automatically.
- **`auditor.js`:** human-readable description per step.
- **DuckDB:** `sp_*` steps have no SQL translation — they use `duckdbRunner.js`'s existing
  JS-fallback (materialize then run in JS), like the other untranslated steps. No new work.
- **NL command bar:** `sp_*` steps are **excluded** from `serializeAllowedSteps` for now — the AI
  must not emit spatial steps until they are validated. Add an exclusion flag if none exists.

## UI changes — SpatialTab

- **New prop `onAddStep(step)`** from App.jsx → `studioRef.current.addSpatialStep(step)`,
  mirroring `addInjectColumnStep`. ⚠️ `wranglingAddStepRef` targets the *Clean-active* dataset;
  the Spatial tab may be viewing a different one (`tabDsId("spatial")`). The wrapper must
  guarantee the step lands on the dataset Spatial is showing — either by selecting that dataset
  first or by extending the ref to `addStepTo(datasetId, step)`, whichever is cleaner in code.
- **Sections:** `onResult(rows, cols)` becomes `onResult(rows, cols, baseHeaders, stepSpec)` —
  the serialized step with the exact params of that run. `Apply` stays a pure local preview.
- **OutputPanel dual-mode:**
  - column stepSpec → **"➕ Add to pipeline"** button (no name input). On commit:
    `onAddStep(stepSpec)`; the pipeline replays, SpatialTab receives the new rows with columns
    integrated, and the step appears in Clean's History sidebar with undo/redo.
  - dataset stepSpec → current name + Save flow, but routed through
    `handleSaveSubset(name, rows, headers, recipe = stepSpec)` instead of `addApiData`, so the
    derive edge is recorded.
- **Cleanup:** remove the dead `onMergeColumns` prop App.jsx passes (SpatialTab never
  destructures it) — superseded by this design.
- `sessionLog.appendLog` calls stay as-is (the replication-fidelity Fase 1 timeline will consume
  them).

## Risks & edge cases

1. **Replay cost.** The non-destructive pipeline replays everything on each step add/undo/edit.
   Spatial Join and Nearest Neighbour are O(n×m). Accepted (same contract as heavy Clean steps).
   Cheap future optimization if needed: memo per `(step.id, input fingerprint)` — does not change
   this design.
2. **Geocode & network.** The `geocode` step replays from the sessionStorage address cache
   (`geocodeRowsFromCache`); uncached addresses in a future replay come back null. Existing
   behavior, unchanged.
3. **Deleted referenced dataset.** If the polygon/grid dataset a step references is deleted, the
   step silently no-ops — exactly like `join` (`if (!right) break`). Kept consistent; surfacing a
   History warning would apply to both and is out of scope.
4. **Pre-existing spatial datasets** (saved before this change) remain recipe-less snapshots. No
   migration.

## Out of scope

- R/Python/Stata translators for `sp_*` steps (follow-up phase; steps emit a visible
  "not yet translated" comment until then).
- Map / Plot sub-tabs (visual artifacts — covered by the separate replication-fidelity Track P).
- Live recomputation of derived datasets when the parent changes.
- History warnings for missing referenced datasets.

## Verification

- `npm run build` green.
- `npm run lint:undef` green.
- `node src/pipeline/__validation__/pipelineReliabilityValidation.mjs` — T5 must pass for every
  `sp_*` type.
- Browser validation: Franco (add each op both ways, undo/redo, reload persistence, derived
  dataset join in Clean, workspace script shows derive edge + untranslated-step comment).
