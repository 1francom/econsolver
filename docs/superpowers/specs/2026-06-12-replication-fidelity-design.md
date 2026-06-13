# Replication Fidelity — Spec & Execution Plan

**Date:** 2026-06-12
**Owner:** Franco Medero
**Executors:** Claude Fable 5 (primary) → Codex (continuation when Fable 5 runs out of tokens)
**Status:** Fase 0 = DONE (browser-validated 2026-06-12; loadOpts-hydration regression found+fixed, task 2.4 added from the test). Fase 1 = CODE-COMPLETE (2026-06-12, browser-validation pending Franco). Fase 2 = CODE-COMPLETE (2026-06-12; derivation `f057078f`, spatial ordering `d7a96868`, manual edits `51819010`, multi-model `d4bc3d4c`). **Fase 2 browser-test round (Franco 2026-06-12): APPROVED** — all datasets load, left_join ✓, in-R derived subset ✓, estimation ✓, manual-edit warning + note in script ✓. **3 follow-up fixes landed from the test:** (1) manual-edit warning now counts patches across ALL session datasets (was active-only → disappeared on Report dataset switch); banner names affected datasets, note lists each `<name>_cleaned.csv`; (2) recipe-backed derive-children excluded from REQUIRED LOAD CALLS + marked in SESSION DATASETS (script was loading "summary_nombre_comuna" from a nonexistent file AND deriving it); (3) extensionless in-app dataset names (grid_cells, spatial_result) normalized to `<name>.csv` + "export from Litux first" note in load hints and workspace skeleton. **Still pending from the test:** multi-model with 2+ pinned models across datasets (needs another browser round); spatial CODE generation is Track P (comments-only is by design for now); .docx modelsummary output "medio raro" (low-prio polish). Next: Fase 3 / Track P. This doc is the single source of truth — design + task checklist.

> **Read this first (executing agent):** you did NOT see the design conversation.
> Every decision is locked in §2 — do not re-litigate. Work top-to-bottom through
> §5. Each task has exact files, a surgical change description, and an acceptance
> gate. Check the box `[x]` when a task's acceptance passes and commit. After each
> task run `npm run build` and `npm run lint:undef` (both must be green). Franco
> browser-validates; you never mark a task "done-done" — you mark it
> "code-complete, browser-validation pending Franco".

---

## 1. Goal & scope

Every Litux operation in the research pipeline must be replicable in R, Python,
or Stata. Two layers:

- **Per-module mini-scripts** (deterministic, free, section-scoped) — generated in
  JS by `pipeline/exporter.js` + `services/export/*Script.js`. These already exist
  for Clean/Model.
- **Unified script** (Claude-assembled, **Premium/Pro paid feature**, ~5¢/call) —
  `generateUnifiedScript()` in `AIService.js`. Must be correct; cost is monetized.

**Unified script scope = Data / Clean / Model / Spatial (+ plots).**
Calculate, Stat (StatWorkspace), and Simulate are EXCLUDED from the unified script
for now (they keep their own section mini-scripts). Future carve-out: when Simulate
*generates* a dataset that is later modeled, the DGP+seed (`dgp_save` log already
stores it) becomes that dataset's load step. Not now.

---

## 2. Decisions (LOCKED — do not change)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | The deterministic JS skeleton owns operation ORDER. The AI must NEVER reorder. | Current `UNIFIED_SCRIPT_PROMPT` rule 2 tells the AI to reorder → emits spatial-join-before-grid → broken script. This is THE correctness bug. |
| D2 | Manual cell edits (`patch` steps): per-language. R/Stata → Warning + "download the cleaned dataset and load that". Python → may emit row-keyed cell edits. | A single click-and-type edit is not faithfully reproducible in R/Stata; be honest, not broken. |
| D3 | Structuring question in Report UI before generate: **Per module** (default) / **Per execution order** (disabled until Fase 3) / **Custom** (free-text → injected into prompt). | Punts interleaving to user intent; cheap and powerful. |
| D4 | Derived subsets (summarize/group/filter → new dataset): **hybrid, default = derivation edge on `globalPipeline`** (parent + recipe, emitted in topo order like joins). Snapshot-as-data-source only as fallback when the recipe is not capturable. | `handleSaveSubset` currently stores rows + parent pointer but NOT the recipe → derivation edge unreplicable. |
| D5 | Instrument Explore FULLY: save/pin → artifact for TS/distribution/correlation plots AND descriptive stats (head/tail/summary/quantile/correlation), capturing EXACT arguments. NOT auto-logging every render. | Explore has no pipeline/log/save today → all its work is ephemeral. This is the shared root cause of "plots not saveable" + "stats not replicable" + the argument-fidelity gap. |
| D6 | Plots: build the deterministic `plotConfig → ggplot2` translator FIRST, then matplotlib + Stata twoway. One mini-script per saved plot. | PlotBuilder is already ggplot grammar → mechanical translation. No plot→code generation exists yet (greenfield). |
| D7 | Spatial Map (Leaflet): replicate via R `leaflet` package + Python `folium` (both ≈1:1). Stata → research later / warning. Requires promoting the Map tab from single autosave to a NAMED saved-maps history (mirror `plotHistory`). | R/Python have native leaflet bindings; the blocker is that maps aren't saved as named artifacts. |
| D8 | Argument fidelity is an acceptance bar: `head(df, n)`, `quantile(x, probs=c(...))`, `geom_vline(xintercept=)`/`geom_hline(yintercept=)`, summarise args — every parameter the user set must be captured and emitted. | A paper replication must reproduce the exact numbers/figures. |

---

## 3. Key files map

| Concern | File | Notes |
|---------|------|-------|
| Unified-script AI call | `src/services/AI/AIService.js` (`generateUnifiedScript`, ~L1176) | sig: `(sections, language, dataDictionary, { snapshot })`. Add `userInstruction`. Multi-dataset REQUIRED LOAD CALLS already landed 2026-06-12. |
| Unified-script prompt | `src/services/AI/Prompts/index.js` (`UNIFIED_SCRIPT_PROMPT`, ~L877) | Rule 2 = reorder bug (D1). Rules 8a–8f already cover multi-dataset. |
| Report unified-script UI | `src/ReportingModule.jsx` (`AIUnifiedScript`, ~L747; `generate()`) | Language selector is here; add structuring question + manual-edit warning. |
| Deterministic exporters | `src/pipeline/exporter.js` (`generateCleanScript`, `generateWorkspaceScript`, `toDfVar`, `topoSort`) | Honors per-dataset `loadOpts` as of 2026-06-12. |
| Step → code translators | `src/pipeline/stepTranslators.js` (`toR`, `toStata`, `toPython`) | Where new step types (derivation) get their code. |
| Cross-dataset edges | `src/services/session/sessionState.jsx` (`globalPipeline`, G-steps, `addGlobalStep`) | Derivation edges (D4) live here. |
| Subset creation | `src/DataStudio.jsx` (`handleSaveSubset`, L928) | Stores `origin:activeId` pointer only — add recipe (D4). |
| Cross-module log | `src/services/session/sessionLog.jsx` | Ephemeral `useState`. Fase 1 persists + broadens it. |
| Plot persistence pattern | `src/services/Persistence/plotHistory.js` | `plotHistory_<pid>` (named list). Mirror for saved maps (D7). |
| Plot config shape | `src/components/PlotBuilder.jsx` (`savePlot`, L1203; geom defaults ~L121) | layers + aes + scaleState; geoms: point/line/bar/histogram/density/smooth/boxplot/errorbar/ribbon/hline/vline. |
| Spatial geo-plot | `src/components/tabs/spatial/plot/SpatialGeoPlot.jsx` | Has `plotHistory` + `geoPlotConfig`. |
| Spatial map | `src/components/tabs/spatial/map/SpatialPlotTab.jsx` (`saveSpatialMaps`, L241) | Single autosave `{layers, basemap, crsInput}` — promote to named history (D7). |
| Explore | `src/ExplorerModule.jsx` | Uninstrumented (D5). |
| Snapshot for AI | `src/services/AI/sessionSnapshot.js` | `buildSessionSnapshot` / `serializeSnapshot`. |

---

## 4. The execution-timeline architecture (Fase 1 foundation)

Faithful "per execution order" replication needs ONE ordered, persisted timeline.
Today it is fragmented: Clean steps (per-dataset pipeline + IDB, ordered),
estimations (model buffer, no timestamp), spatial/calc/sim (`sessionLog`,
timestamped but ephemeral), dataset loads (registry, no order).

**Fase 1 builds a unified timeline:** every pipeline-affecting user action emits a
timestamped event to one persisted log (IDB, keyed `timeline_<pid>`). Event kinds:
`dataset_load`, `pipeline_step` (per dataset), `derive` (subset recipe),
`estimate`, `spatial_op`, `plot_save`, `explore_stat`. The unified script is a
deterministic walk of this log. The AI only polishes; it never orders.

`sessionLog.jsx` is the seed — extend its coverage and persist it. Until Fase 1
lands, the Fase 0 rule is: **each artifact emits at the end of its owning section.**

---

## 5. Phased tasks

### FASE 0 — Pre-test safety (cheap, no timeline) — DO FIRST

- [x] **0.1 — Prompt: forbid reordering.** *(code-complete 2026-06-12, browser-validation pending Franco)*
  File: `src/services/AI/Prompts/index.js`, `UNIFIED_SCRIPT_PROMPT` rule 2.
  Change rule 2 from "Reorder statements for logical flow…" to: preserve the order
  of operations exactly as given; group only with section headers; NEVER move an
  operation before its dependency (e.g. a spatial join before the grid it joins to,
  a model plot before its estimation). Add a new rule: if a `STRUCTURE INSTRUCTION`
  block is present in the user payload, honor it for sectioning/ordering.
  Accept: prompt text updated; `npm run build` green.

- [x] **0.2 — Structuring question + custom instruction.** *(code-complete 2026-06-12, browser-validation pending Franco)*
  Files: `src/ReportingModule.jsx` (`AIUnifiedScript`), `src/services/AI/AIService.js`
  (`generateUnifiedScript`), `src/services/AI/Prompts/index.js`.
  - `AIUnifiedScript`: add state `structureMode` (`"module"` default | `"execution"` | `"custom"`)
    and `customInstruction`. Render a small chip row above the language selector:
    "Per module" / "Per execution order" (disabled, tooltip "coming soon") / "Custom".
    When `custom`, show a textarea.
  - In `generate()`, build `userInstruction` from the mode (module → "Structure the
    script grouped by module section."; custom → the textarea text) and pass it.
  - `generateUnifiedScript`: extend options to `{ snapshot, userInstruction }`;
    inject as a high-priority `STRUCTURE INSTRUCTION:` block in the user payload
    (place it right after `TARGET LANGUAGE`).
  Accept: selecting Custom + typing an instruction changes the generated script's
  structure; build + lint:undef green.

- [x] **0.3 — Manual-edit warning (per-language).** *(code-complete 2026-06-12, browser-validation pending Franco. Note: prompt-level only — `manualEditNote` instructs Claude not to emit row-id patches; the deterministic translators in rScript/stataScript still emit them in their own mini-script paths, cleanup is Fase 2.3)*
  File: `src/ReportingModule.jsx` (`AIUnifiedScript`).
  - Detect ad-hoc cell edits: `const manualEdits = (cleanedData?.pipeline ?? []).filter(s => s.type === "patch")`.
  - If `manualEdits.length > 0` and lang ∈ {r, stata}: render a warning banner
    (`C.gold` border) — "N manual cell edits can't be faithfully replicated in
    R/Stata. Download the cleaned dataset and load it directly." + a button
    "Download cleaned dataset (CSV)" that blobs `cleanedData.cleanRows` +
    `cleanedData.headers` to CSV. Also pass a flag into `generateUnifiedScript` so
    the prompt emits a load-section comment pointing at the cleaned file.
  - Python: no banner; allow the existing `patch` translators to emit cell edits.
  Accept: a pipeline with a `patch` step shows the banner for R/Stata, downloads a
  clean CSV, and the R/Stata script comments the manual-edit caveat; build + lint green.

> **After Fase 0: STOP and let Franco run ONE browser test** (multi-dataset session)
> before spending on more AI calls.

### FASE 1 — Unified, persisted execution timeline + Explore instrumentation

- [x] **1.1 — Timeline store.** *(code-complete 2026-06-12)* New `src/services/Persistence/timeline.js` mirroring
  `plotHistory.js` (`getTimeline(pid)`, `appendTimeline(pid, event)`, `saveTimeline`, keyed
  `timeline_<pid>` in the `pipelines` store). Events stored in the sessionLog entry shape
  (module/opType/timestamp/params/reproducible/label, opType = event kind).
- [x] **1.2 — Persist + broaden `sessionLog`.** *(code-complete 2026-06-12, browser-validation pending Franco)*
  `SessionLogProvider` gains `pid` (App passes it): hydrates from `getTimeline` on mount,
  `appendLog` writes through `appendTimeline`, `clearLog` wipes. New `useSessionLogOptional`
  (no-throw) for components that may render outside the provider. Emitters added:
  `dataset_load` + `dataset_derive` (DataStudio `addParsedDataset`/`handleSaveSubset` —
  the two funnels), `estimate` (ModelingTab result-change effect — covers ALL estimator
  branches), `pipeline_step` (WranglingModule `addStep` funnel, tagged with datasetId).
  `serializeSnapshot` MODULE OPERATIONS capped at last 60 entries (persisted log grows
  across sessions; protects the AI payload budget).
- [x] **1.3 — Explore instrumentation (D5).** *(code-complete 2026-06-12, browser-validation pending Franco)*
  `PinBtn` ("⊕ Pin") added to every Explore surface; each pin emits an `explore_stat`
  timeline event with EXACT args (D8) + the active QuickFilter conds + dataset name:
  summary (columns/groupBy/custom percentiles), head/tail (n), overdispersion (col, CT),
  histogram (col/bins/transform), bar chart (col/order), spaghetti (col/entity/time),
  correlation (method/cols), time series (y/time/group/agg), ACF-PACF (maxLag), ADF.
  **Deviation from spec text (justified):** quick-look plots pin to the TIMELINE, not
  `plotHistory` — plotHistory is the PlotBuilder layer-config shape; forcing quick-look
  configs into it would corrupt the PlotBuilder history UI. The `explore_stat` params
  carry everything Track P needs to emit plot code. Nothing auto-logs; pin-only.
  Accept: pinned Explore artifacts survive reload (timeline IDB) and appear in MODULE
  OPERATIONS; build + lint green.

### FASE 2 — Manual-edit honesty + spatial ordering + derivation edges

- [x] **2.1 — Derivation edges (D4).** *(code-complete 2026-06-12, browser-validation pending Franco)* In `handleSaveSubset` (DataStudio.jsx), when a
  subset is saved from a known recipe (group_summarize/filter/etc.), register a
  `globalPipeline` derivation G-step (`opType:"derive"`, `parentId`, `recipe`) via
  `addGlobalStep`, instead of only the `origin` pointer. Extend `generateWorkspaceScript`
  + `topoSort` to emit derivation edges (`df_child <- df_parent %>% <recipe>`) in
  topo order. Fallback to snapshot-as-data-source when no recipe is available.
  Caller must pass the recipe spec to `handleSaveSubset` (plumb from SubsetManager /
  Reshape save-as-dataset).
- [x] **2.2 — Spatial dependency ordering.** *(code-complete 2026-06-12, browser-validation pending Franco)* Emit spatial ops strictly in timeline
  order; guarantee grid creation precedes any grid assignment/join. Verify the Map-tab
  grid-creation path lands a timeline event before assignment (Analyze-tab `GridSection`
  already logs; confirm Map tab).
- [x] **2.3 — Manual-edit snapshot path** *(code-complete 2026-06-12, browser-validation pending Franco)* wired to the timeline (cleaned-dataset export
  referenced as the load step for R/Stata when patches present).
- [x] **2.4 — Multi-model replication (Franco, browser-test 2026-06-12).** *(code-complete 2026-06-12, browser-validation pending Franco)* The unified
  script currently replicates only the ACTIVE result; all PINNED models should emit
  their own estimation blocks. `snapshot.pinnedModels` already carries trimmed specs
  (`trimResult`) incl. each model's `spec.filename` → bind each to its source df like
  the active model. UI: a toggle "Replicate: active model / all pinned models".
  Deterministic side: `_buildModelScript` loops pinned specs; prompt rule 8e updates
  from "mention them in a comment" to "emit each pinned model's estimation".

### FASE 3 — "Per execution order" mode

- [ ] **3.1** Enable the "Per execution order" structuring mode: the deterministic
  skeleton is the timeline walk; the AI preserves it.
- [ ] **3.2** Interleaving detection (same dataset re-cleaned after modeling, or
  multiple datasets modeled) → auto-pick the smart default structuring mode.

### TRACK P — Plot replication (parallel; independent of the timeline)

- [x] **P1 — `plotConfig → ggplot2` translator.** *(code-complete 2026-06-12, browser-validation pending Franco)* New `src/services/export/plotScript.js`
  (`buildGgplot(plotEntry)`). Map geoms 1:1: point→geom_point, line→geom_line,
  bar→geom_col/geom_bar, histogram→geom_histogram, density→geom_density,
  smooth→geom_smooth, boxplot→geom_boxplot, errorbar→geom_errorbar, ribbon→geom_ribbon,
  hline→geom_hline(yintercept=), vline→geom_vline(xintercept=). aes: x/y/color/fill/size/alpha.
  Scales: log→scale_x/y_log10, domain→xlim/ylim, catOrder→scale_x_discrete(limits=c(...)),
  labels→labs(title,x,y), palette from `scheme`. Read exact field names from
  `PlotBuilder.jsx` `savePlot`. Add a per-plot "Copy R" / mini-script button in the
  plot history UI. Runs on the cleaned dataset df.
  **Approximation note:** PlotBuilder density uses binned proportions; the R export
  uses ggplot2's kernel `geom_density(adjust=...)`, preserving the configured adjust value.
- [x] **P2 — Spatial Plot geo variant.** *(code-complete 2026-06-12, browser-validation pending Franco)* Extend the translator for WKT geometry →
  `sf::st_as_sf` + `geom_sf`/`geom_polygon`; fill scales. Basemap tile: drop with a
  comment, or `ggspatial::annotation_map_tile` with a caveat.
  **Approximation note:** heatmaps use ggplot2's `stat_density_2d` KDE rather than
  Litux's metric-grid KDE; basemaps use internet-fetched `ggspatial` tiles at render time.
- [x] **P3 — Spatial Map named history + leaflet/folium generator.** *(code-complete 2026-06-13, browser-validation pending Franco)* Promote
  `SpatialPlotTab` from single autosave to a named saved-maps history (mirror
  `plotHistory`: a "Save map" button → list). Generate R `leaflet()` (addTiles/
  addProviderTiles(basemap) + addPolygons/addCircleMarkers per layer) and Python
  `folium.Map` from `{layers, basemap, crsInput}`. Stata → warning comment.
  **Approximation note:** generated lat/lon grids are not regenerated in either
  script; the user is prompted to export and load the generated grid dataset.
  Leaflet and folium basemap tiles require internet access when the script runs.
- [x] **P4 — Model plots.** *(code-complete 2026-06-13, browser-validation pending Franco — needs Codex's P5 `scriptPreamble` seam in PlotBuilder.jsx to be wired end-to-end)*
  New `src/services/export/modelPlotScript.js` (`buildModelPlotPreamble(result, language, {mode})`):
  emits the preamble that re-materializes the model-derived columns the Model PlotBuilder
  uses. ModelingTab appends `__resid__`/`__yhat__` (not `.resid`/`.fitted`) to `resultRows`,
  so the preamble defines those exact names on `plot_df`. R: `broom::augment(fit)` with a
  `model.frame(fit)` + `residuals/fitted` fallback (works for lm/glm/fixest/ivreg) → aliases
  `.resid`→`__resid__`, `.fitted`→`__yhat__`. Python: `fit.resid`/`fit.fittedvalues`. Stata:
  `predict __yhat__, xb` + `predict __resid__, residuals`. `mode:"comparison"` (G13 coef plots)
  emits a `broom::tidy`/`coefplot` stacking preamble instead. References the `fit` object the
  Estimation section creates. Wired in `ModelingTab.jsx` via the PlotBuilder `scriptPreamble`
  prop (Track P5 seam) — passes a `(lang) => preamble` only when `result` exists; mode follows
  `plotDataMode`. **Split note:** P4 owns `modelPlotScript.js` + `ModelingTab.jsx` ONLY; the
  `scriptPreamble` prop + `plot_df` plumbing live in PlotBuilder.jsx (Codex's P5 lane) and
  are now wired end-to-end.
- [x] **P5 — matplotlib + Stata twoway parity** for P1/P2 geoms. *(code-complete 2026-06-13, browser-validation pending Franco)*
  **Approximation note:** Stata error bars and ribbons use `rcap` and `rarea`;
  Stata geo export is intentionally skipped with a comment because Stata has no
  native `sf`-style geometry plotting. Matplotlib geo uses geopandas.

---

## 6. Validation gates (every task)

1. `npm run build` → green.
2. `npm run lint:undef` → "no undefined-identifier violations".
3. No new hardcoded hex colors / non-`C` constants in touched UI.
4. Franco browser-validates the user story; agent marks "code-complete,
   browser-validation pending Franco" — never "done" unilaterally.

R-validation is not required here (no R on this machine) — the deterministic
translators are validated by Franco running the emitted script in his R/Stata.

---

## 7. Handoff protocol (Fable 5 → Codex)

When Fable 5 runs low on tokens, Codex continues. To resume cleanly:

1. **State of work lives in two places:** the `[ ]/[x]` checkboxes in §5 of THIS
   file, and the git log. Read both first.
2. A task is "code-complete" only when its acceptance line passes AND build+lint are
   green AND it is committed. Half-done tasks must be left with a `// TODO(handoff):`
   comment at the exact stopping point and a note appended under the task bullet.
3. Codex: do NOT re-architect. Follow the same surgical-patch convention (state what
   to add/delete and where; no full-file rewrites). The decisions in §2 are locked.
4. After resuming, run build+lint before writing code to confirm a clean baseline.
5. One commit per task (or per logical file group). Conventional commit messages.
6. Update this file's checkboxes in the SAME commit that lands the task.

---

## 8. Acceptance (Fase 0 launch-gate for this round)

- Unified script never emits an operation before its dependency.
- User can pick Per-module or give a custom structuring instruction; the output
  respects it.
- A pipeline with manual cell edits produces a clear R/Stata warning + downloadable
  cleaned dataset; no silently-broken row-id patches for R/Stata.
- Calculate/Stat/Simulate are absent from the unified script.
- Build + lint:undef green; Franco browser-validates one multi-dataset session
  (3 datasets incl. a `.dta`) — all loaded with correct readers, model runs on its
  source df.
