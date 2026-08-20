# Model & Explore import/export — design

**Date:** 2026-08-20
**Status:** OPEN — approved by Franco, implementation plan not yet written
**Scope:** make pinned models and saved plots exportable to a JSON file and importable back,
mirroring the existing Clean `pipeline.json` round-trip.

---

## 1. Motivation

Clean already has a working replication round-trip: `ExportMenu` writes
`{version, filename, exportedAt, steps}` and `ImportPipelineButton` validates it against
`STEP_TYPES` + `exprGuard` and applies it atomically. Model and Explore have no equivalent,
even though both already hold a fully serialisable recipe:

- **Model** — `modelBuffer.add()` stores an `EstimationResult` trimmed by `trimResult()`,
  which preserves `spec`. The recipe exists; there is no file format and no way back in
  from a file.
- **Explore** — `plotHistory` entries are `{id, name, layers[], title, scales…, facetCol}`
  and `loadPlotEntry()` (`PlotBuilder.jsx:1626`) is already a complete restorer. Same
  situation: recipe present, file absent.

So this is mostly plumbing plus one real correctness fix (§3).

---

## 2. Decisions taken

| Question | Decision |
|---|---|
| Unit of exchange | **One file per module.** `model.json` and `plots.json`, each with its own Export/Import control. No `workspace.json` bundle. |
| What a model file carries | **The recipe, not the result.** Importing fills the sidebar; the user presses Estimate against *their* data. No foreign coefficients enter the model buffer. |
| Missing columns on import | **Apply partially + banner.** Fields whose column is absent are left empty and named explicitly by role. Never a silent partial spec. |
| Multiple items in one file | **Explore appends, Model picks.** Plots are appended to `plotHistory` (non-destructive; the existing history picker is the tray). Models open a modal listing the N specs; the user picks one. |
| Derived datasets | **Out of scope** — separate spec (§7). |

---

## 3. Prerequisite: one canonical model spec

`result.spec` cannot be the export source as it stands. Each estimator branch in
`estimationDispatch.js` builds its own `spec`, and several are incomplete — the file itself
records at line 410 that Callaway-Sant'Anna parameters "were passed to runCallawayCS but
never captured in spec". The only canonical stamp today is `specExtras`
(`ModelingTab.jsx:897`), described in its own comment as "the single place that stamps it".

Two consequences already visible in shipped behaviour:

- Exporting from `result.spec` would produce silently incomplete files for Synthetic
  Control, Poisson FE, Sun-Abraham, Callaway-Sant'Anna and Spatial Regression.
- The pin restore path (`ModelingTab.jsx:3845`) refills only ~12 fields and skips `seType`
  behind a comment claiming SE settings "aren't reliably stored on results today" — which
  stopped being true when `specExtras` started stamping `seType`/`clusterVar`/`clusterVar2`.
  Restoring a pin therefore loses its SE choice and every estimator-specific field.

### 3.1 `src/components/modeling/modelSpec.js` (new)

A single declaration table plus two functions:

```
MODEL_SPEC_FIELDS = [
  { key: "yVar",       kind: "column"    },
  { key: "xVars",      kind: "columns"   },
  { key: "feCols",     kind: "columns"   },
  { key: "factorRefs", kind: "columnMap" },              // column -> reference level
  { key: "interactionTerms", kind: "termList" },         // [{var1, var2, type:"*"|":"}]
  { key: "seType",     kind: "enum", values: SE_TYPES },
  { key: "spatialWeightsDatasetId", kind: "datasetRef" },
  { key: "cutoff",     kind: "scalar"    },
  …
]

collectSpec(state)        -> plain JSON spec
applySpec(spec, setters)  -> { applied, missing: [{ key, role, value }] }
```

`kind` is load-bearing: it drives serialisation, the missing-column check, and the banner
copy, so the three behaviours cannot drift apart. `resolveSpatialWeights` is a **function**
and must never be serialised — the table is also the allowlist that keeps it out.

### 3.2 Three consumers, one definition

1. `specExtras` stamps via `collectSpec` → pins store the **complete** spec.
2. `onRestore` uses `applySpec` → closes the 12-field/`seType` gap as a side effect.
3. Import uses `applySpec` → no second restore path is written.

The serialised spec is **flat** — `panel` is a state object in `ModelingTab`, but it travels
as `entityCol`/`timeCol`, since a nested container has no `kind` and would bypass the checks
in §6.

The full field set is the `_runEstimation` dependency array (`ModelingTab.jsx:900`):
`model, family, yVar, xVars, wVars, zVars, postVar, treatVar, runningVar, cutoff, bwMode,
bwManual, kernel, polyOrder, weightVar, seType, clusterVar, clusterVar2, panel.entityCol,
panel.timeCol, noIntercept, treatedUnit, synthTreatTime, treatTimeCol, kPre, kPost, feCols,
factorVars, factorRefs, interactionTerms, poissonEntityCol, poissonOffsetCol,
poissonExtraFE, cohortCol, periodCol, saUnitCol, saControlMode, saRefPeriod, cs*, spatial*`.

---

## 4. File formats

```jsonc
// model.json
{ "version": 1, "kind": "litux/model-specs", "exportedAt": "…",
  "models": [ { "label": "Baseline FE", "type": "FE", "family": "linear", "spec": { … } } ] }

// plots.json
{ "version": 1, "kind": "litux/plots", "exportedAt": "…",
  "plots": [ { "name": "Plot 1", "layers": [ … ], "title": "", "xLabel": "", "yLabel": "",
               "scheme": "", "xScale": "linear", …, "facetCol": "", "facetCols": 3 } ] }
```

The plot entry shape is exactly `currentPlotEntry()` (`PlotBuilder.jsx:1661`) plus `name`.
`id`, `savedAt`, `datasetId` and `datasetName` are **regenerated on import and never
travel** — a foreign `datasetId` would point at a dataset that does not exist in the
importing session.

`kind` is checked on import so a `plots.json` fed to the model importer fails with a clear
message instead of a confusing field-level error.

---

## 5. Flows

### Model

- **Export** — `↓ Export models` beside `ModelBufferBar`. Writes the specs of all pins.
  Disabled when the buffer is empty.
- **Import** — `↑ Import models` beside the same bar. Validate → modal listing the N specs
  (label, estimator, and a `y ~ x1 + x2` preview built from the spec) → user picks one →
  `applySpec` fills the sidebar → banner if anything was dropped → the user presses
  Estimate. **Nothing is pinned and nothing is estimated automatically.** To try another
  spec, reopen the file; no new persistent state is introduced.

### Explore

- **Export** — `↓ Export plots` in PlotBuilder's history bar (`PlotBuilder.jsx:~1932`).
  Writes all saved history entries. The in-canvas plot must be saved first — this matches
  the existing meaning of the history, and is not a new rule.
- **Import** — `↑ Import plots` in the same bar. Validate → append to `plotHistory` with
  fresh ids and the current `datasetId` → persist via `savePlotHistory(histPid, next)` →
  load the first imported entry into the canvas. Append, never replace: unlike the pipeline
  import there is no History panel to undo with.

---

## 6. Validation

The analogue of the pipeline importer's `STEP_TYPES` check. Unknown identifiers **abort**
the import with the offending list, rather than applying something that will no-op.

- **Model**: `type` ∈ `MODELS` (already exported from `EstimatorSidebar.jsx:19`),
  `family` ∈ `FAMILY_SUPPORT`, `seType` ∈ `SE_TYPES` (`InferenceOptions.jsx:25` — must be
  exported). A spec value must match its declared `kind` and nothing else: a primitive
  (`scalar`, `enum`, `column`, `datasetRef`), an array of primitives (`columns`), a flat
  string→string map (`columnMap`), or a `termList` — an array of `{var1, var2, type}` with
  `type ∈ {"*", ":"}`. Anything not matching its `kind` is rejected; a `kind` the table does
  not declare is dropped, so an unknown field can never reach a setter.

  A `termList` entry is validated as a unit: if either operand column is absent, the whole
  term is dropped and reported. A half-term (`{var1: "educ", var2: ""}`) would render as an
  editable but meaningless row in `VariableSelector`, and `expandInteractions` would build a
  product column against a missing operand.
- **Explore**: `geom` ∈ `GEOMS` (`PlotBuilder.jsx:82` — local today, must be exported),
  `scheme` ∈ the known scheme list.
- **Expressions**: verified during design — plot layers carry no evaluated expression field
  (no `expr`/`formula`/`eval` in `PlotBuilder.jsx`), and model specs are column names and
  scalars only. So `exprGuard` is **not** needed here, unlike the pipeline importer. If a
  future layer or spec field becomes an expression, it must route through `isSafeExpr`.
- **Both**: `JSON.parse` in `try/catch` and a file-size cap, as today.

### Partial application

`applySpec` returns `missing[]`; the banner names the role, not just the column:
`yVar: log_gdp — not in this dataset`. `datasetRef` fields (`spatialWeightsDatasetId`) are
treated the same way — a dataset id from another session cannot resolve, so the field is
cleared and reported rather than left pointing at nothing.

---

## 7. Out of scope (explicit)

- **Derived datasets.** Verified during design and worse than a missing export: Clean's
  `doSaveSubset()` calls `onSaveSubset(name, rows, headers)` with **no recipe**
  (`WranglingModule.jsx:484`), so `handleSaveSubset`'s `ADD_GLOBAL_STEP`/`derive` block —
  gated on `if (recipe && parentId)` (`DataStudio.jsx:868`) — never runs, and the operation
  is logged `reproducible: false`. Only Spatial's dataset producers pass a recipe
  (`App.jsx:3425`, `:3463`). A dataset derived in Clean therefore exists as data with **no
  recorded derivation at all**. Exporting that today would export nothing. Its own spec,
  starting from the recipe fix, not from the file format.
- Importing results/numbers (foreign coefficients in the model buffer).
- Column remapping UI.
- Spatial maps (`spatial_maps` store) — a third artifact type, deliberately not covered.

---

## 8. Testing

- `MODEL_SPEC_FIELDS` round-trip: `applySpec(collectSpec(s))` reproduces `s` for one
  fixture per estimator group (Linear / Panel / DiD / IV / RD / SC / Spatial), so no
  estimator's fields can be silently absent from the table.
- A spec naming absent columns yields the expected `missing[]` and applies the rest.
- Unknown `type`, unknown `geom`, and a wrong `kind` each abort with a message.
- A spec containing a function-valued field (e.g. `resolveSpatialWeights`) serialises
  without it.
- `npm run build` and `npm run lint:undef` green. Browser validation by Franco.
