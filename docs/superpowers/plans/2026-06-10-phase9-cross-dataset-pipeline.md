# Plan — Phase 9.3/9.4/9.5: Cross-Dataset (Two-Tier) Pipeline — finish & wire

**Date:** 2026-06-10
**Status:** DONE (implementation) — browser-validation PENDING (Franco). Task 3b = deferred follow-up.
**Owner:** Claude (resumable by Codex — this doc is self-contained)
**Spec:** Phase 9.3/9.4/9.5 in `ClaudePlan.md` (body, "Phase 9: Workspace Architecture")

---

## TL;DR — this is a WIRING + PERSISTENCE job, not a build

A code audit on 2026-06-10 found Phase 9.3/9.4/9.5 are ~80% implemented. The plan's
body rows ("PENDING") are stale. Do **not** rebuild — finish the 3 real gaps below.

## Audit findings (what already exists — verified with file:line)

| Capability | Where | Status |
|-----------|-------|--------|
| 9.3 global pipeline state (`globalPipeline`, `ADD/REMOVE_GLOBAL_STEP`, `addGlobalStep`/`removeGlobalStep`) | `src/services/session/sessionState.jsx:31,68-78,117-123` | ✅ |
| 9.3 step→dataset tagging + G-step registration on join/append | `src/WranglingModule.jsx:260-289` (`addStep` tags `datasetId: pid`; join/append dispatch `ADD_GLOBAL_STEP` with `leftDatasetId/rightDatasetId/opType/params`) | ✅ |
| 9.4 deletion cascade UI (`CascadeConfirm`, `computeGStepCascade`, `computeDatasetCascade`, save-snapshot vs delete-all, `REMOVE_GLOBAL_STEP`) | `src/components/workspace/DatasetManager.jsx:75-90,434-460,761-888` | ✅ |
| 9.4 interaction log (G-steps listed in DatasetManager) | `DatasetManager.jsx:814-888` | ✅ |
| 9.5 export DAG (`generateWorkspaceScript` + Kahn topo-sort + R/Stata/Python cross-dataset emit) | `src/pipeline/exporter.js:172-377` | ✅ logic exists |
| 9.5 single-dataset script + per-step `toR/toStata/toPython` | `src/pipeline/exporter.js:95-159`, `src/pipeline/stepTranslators.js` | ✅ |

## The 3 genuine gaps

### GAP A — `generateWorkspaceScript` is UNWIRED (no caller)
`grep generateWorkspaceScript src/` returns only the definition + JSDoc in
`exporter.js`. Nothing imports or calls it, so the workspace-level multi-dataset
replication script is unreachable from the UI.

### GAP B — `globalPipeline` is NOT persisted (lost on reload)
`sessionState.jsx` is a plain `useReducer` mounted `key={pid}` (see its header
comment). Per-dataset pipelines persist in IndexedDB (DataStudio), but the
session-level `globalPipeline` (the cross-dataset lineage) is ephemeral. Reopen a
project → joins still exist *in each left dataset's local pipeline* (those persist),
but the **G-step interaction log + cascade lineage are gone**, and any
workspace-export DAG can't be reconstructed.

### GAP C — derived-dataset model — DECIDED 2026-06-10: KEEP IN-PLACE
Current model (WranglingModule:277): a join's result stays **in-place** in the left
dataset (`outputDatasetId: pid`). The spec (9.2/9.3/9.4) drew joins as a
first-class `◎` derived node; Franco chose **keep in-place** (less surgery, already
shipped), conditional on replication being correct — analyzed below and confirmed OK.

**Replication analysis (the reason this needed thought):** the join step translators
in `stepTranslators.js` (`toR`/`toStata`/`toPython`, cases at :543 / :861 / :1155)
each emit a **self-contained** join that loads the right dataset INLINE
(`right_df <- read_...`; Stata `_right_tmp.dta`; pandas `pd.merge`). Good for a
standalone single-dataset script. BUT in `generateWorkspaceScript` the join would be
emitted **twice** — once inside the left dataset's local-pipeline loop (against a RAW
right load) and again in the cross-dataset DAG section (against the CLEANED
`df_right`). That double-join is the only real correctness risk of in-place.

**Resolution (folded into Task 1):** join/append local steps carry a `gStepId` tag
(set in `WranglingModule.jsx:287` when a G-step is registered). The workspace
exporter must FILTER those out of per-dataset local emission and emit cross-dataset
ops ONLY from `globalPipeline` (where the cleaned right df is in scope). With that
one filter, keep-in-place is correct across R / Python / Stata. The two export modes
are then well-defined:
- **Single-dataset / Clean-tab export** (`generateCleanScript`): join emitted inline
  with a raw right load. Quick + standalone; the right dataset's OWN local pipeline is
  NOT replayed (documented limitation — use the workspace export for full fidelity).
- **Workspace export** (`generateWorkspaceScript`): every dataset's non-`gStepId`
  local steps in topo order, then cross-dataset joins from `globalPipeline` using the
  cleaned dfs. This is the correct full replication.

---

## Tasks (ordered; each independently shippable)

### Task 1 — Wire `generateWorkspaceScript` to an export button  *(closes GAP A)*
**Files:** `src/components/workspace/DatasetManager.jsx` (add an export control near
the interaction-log section ~line 814), import from `src/pipeline/exporter.js`.
- Add an "Export workspace script" control (R / Stata / Python — mirror the
  per-tab export-bar pattern, e.g. `ExportMenu.jsx` / CodeEditor language tabs).
- Build the `datasets` arg as `{ [id]: { id, name, filename, pipeline } }` from the
  session registry (`useSessionState().datasets`) + each dataset's local pipeline.
  The per-dataset `pipeline` must come from DataStudio/IndexedDB (the registry meta
  may not carry steps — thread it, or load via `loadPipeline(id)` from
  `services/Persistence/indexedDB.js`).
- Pass `globalPipeline` from `useSessionState()`.
- Download via a Blob (copy the download helper already used in DatasetManager /
  ExportMenu).
- **CRITICAL (Gap C resolution):** `generateWorkspaceScript` must NOT emit
  `gStepId`-tagged local steps in the per-dataset loop, or joins emit twice (raw +
  cleaned). Filter them: in `exporter.js` `generateWorkspaceScript`, change each
  per-dataset loop `for (const step of (ds.pipeline ?? []))` to
  `for (const step of (ds.pipeline ?? []).filter(s => !s.gStepId))` (all 3 language
  branches: R ~line 249, Stata ~296, Python ~345). The cross-dataset section already
  emits joins from `globalPipeline`. Add a regression note in the file.
- **Acceptance:** with 2 datasets + 1 join, clicking R/Stata/Python downloads a
  script whose datasets appear in topo order, whose cross-dataset section emits the
  correct `left_join`/`merge`/`append` against the CLEANED right df, and where the
  join appears EXACTLY ONCE. `npm run build` + `lint:undef` green.

### Task 2 — Persist `globalPipeline` (+ calcWorkspace) to IndexedDB  *(closes GAP B)*
**Files:** `src/services/session/sessionState.jsx`, `src/services/Persistence/indexedDB.js`,
mount site in `src/App.jsx` (`SessionStateProvider key={pid}`).
- Add `saveSessionMeta(pid, { globalPipeline, calcWorkspace })` /
  `loadSessionMeta(pid)` to `indexedDB.js`, mirroring the `coach_chats` /
  `spatial_maps` per-pid pattern (reuse an existing store with a string key like
  `sessionMeta_<pid>` à la `plotHistory.js`, OR add a small store — prefer the
  string-key-in-existing-store route to avoid a version bump).
- `SessionStateProvider`: accept a `pid` prop; hydrate initial state from
  `loadSessionMeta(pid)` on mount (lazy initializer or an effect + `hydratedRef`
  guard like `SpatialPlotTab.jsx:223-243`); debounced-save `globalPipeline` +
  `calcWorkspace` on change (400ms). Guard against saving before hydration.
- Pass `pid` from the `<SessionStateProvider key={pid}>` mount in App.jsx.
- Cascade: clear `sessionMeta_<pid>` in `deleteProject` (indexedDB.js) alongside
  the other per-pid stores.
- **Acceptance:** create a join, reload the project → the G-step still shows in the
  DatasetManager interaction log and the workspace export still emits the join.
  `npm run build` + `lint:undef` green.

### Task 3 — Document the in-place model + verify cascade  *(GAP C — DECIDED: in-place)*
Unblocked (Franco chose in-place 2026-06-10).
- Update the Phase 9.2/9.3/9.4 spec text in `ClaudePlan.md` to describe the in-place
  model (joins augment the left dataset; no `◎` derived node is created), and note
  the two export modes from Gap C.
- Verify `computeDatasetCascade` / `computeGStepCascade` behave correctly when
  `outputDatasetId === leftDatasetId` (no orphan derived node to remove — cascade
  should warn about pinned models + downstream G-steps only). Add a regression note.
- (Derived-node model is explicitly NOT pursued; if a future workflow needs separate
  lineage, scope it as a new sub-plan.)

### Task 3b — Sync the G-step ↔ local-join-step pair  *(NEW — found during Task 3)*
The in-place model stores a join as TWO linked records: the left dataset's local
pipeline step (executes the join in-app) and a `globalPipeline` G-step (drives the
interaction log + workspace export), linked by `gStepId`. Deleting one does not
delete the other, so they can desync:
- Delete a G-step (DatasetManager) → local step still runs the join in-app, but the
  workspace export omits it (filtered from local emission by `gStepId`, absent from
  the global section). **Export now under-represents the join.**
- Delete the local step (Clean pipeline history) → orphan G-step still emits in the
  workspace export and shows in the interaction log.
**Options:** (a) make each deletion path remove its partner — needs App↔DataStudio↔
WranglingModule plumbing, and the left dataset's WranglingModule is only mounted when
it is the active dataset (non-active → must edit the stored pipeline in IDB directly);
or (b, cleaner) DERIVE `globalPipeline` by scanning all datasets' local pipelines for
join/append steps instead of storing it separately (eliminates the sync problem;
would supersede Task 2's persistence). Recommend evaluating (b). Scope as its own
change. **Not a data-loss risk** (the cascade no longer deletes datasets) — it is a
consistency/export-fidelity issue.

### Task 4 — End-to-end verification pass  *(PENDING — Franco, browser; no code unless a defect is found)*
- Load 2 datasets → join in Clean (Merge) → confirm: (a) G-step appears in
  DatasetManager interaction log; (b) deleting the G-step shows `CascadeConfirm`
  with the right cascade; (c) "save snapshot first" works; (d) workspace export
  (Task 1) emits correct R/Stata/Python; (e) reload (Task 2) preserves all of it.
- Record results; file defects as follow-up tasks.

---

## Constraints (CLAUDE.md)
- Non-destructive pipeline; `runner.js` is source of truth. Pure JS in `pipeline/`.
- Inline styles + `C`/`T` tokens. Surgical edits. IndexedDB not localStorage.
- `npm run build` + `npm run lint:undef` must pass before any commit.

## Out of scope
- 9.10 AI unified script (separate, `generateUnifiedScript` likely already covers it).
- 9.9 plot style presets (PlotBuilder already has `PRESETS`).
- Any new estimator / math work.

## Status log
- 2026-06-10: audit complete; plan written. Tasks 1–2 ready to execute; Task 3 blocked on Franco's GAP-C decision; Task 4 after 1–2.
- 2026-06-10: GAP C DECIDED = keep in-place (Franco). Replication double-join risk analyzed + resolved via `gStepId` filter in `generateWorkspaceScript` (folded into Task 1). Task 3 unblocked (now spec-text + cascade verify). All tasks ready; none blocked.
- 2026-06-10: **Task 1 DONE** (browser-validation pending). (a) `gStepId` filter applied to all 3 language branches in `exporter.js` `generateWorkspaceScript` (no double-join). (b) "Export workspace script" R/Stata/Python footer added to `DatasetManager.jsx` Interactions section → `exportWorkspace(language)` loads per-dataset pipelines+filenames via `loadProjectPipelines(pid)`, builds the `datasets` arg, calls `generateWorkspaceScript`, downloads `workspace_replication.{R,do,py}`. Shown when ≥1 dataset. Build + lint:undef green.
- 2026-06-10: **Task 2 DONE** (browser-validation pending). `saveSessionMeta`/`loadSessionMeta`/`deleteSessionMeta` added to `indexedDB.js` (key `sessionMeta_<pid>` in the pipelines store, no schema bump; mirrors plotHistory). `deleteProject` cascade clears it. `SessionStateProvider` now takes `pid`, hydrates `globalPipeline`+`calcWorkspace` via `HYDRATE_SESSION_META` on open (hydratedRef guard) and debounce-saves (400ms) on change; `App.jsx` passes `pid={pid}`. Cross-dataset lineage + interaction log now survive reload. Build + lint:undef green.
- 2026-06-10: **CLOSED — Tasks 1–3 implemented; build + lint:undef green.** Task 4 (e2e) left PENDING for Franco's browser pass; Task 3b (G-step↔local-step desync — consistency, not data-loss) deferred as a follow-up. Moving on.
- 2026-06-10: **Task 3 DONE** (browser-validation pending). Verification surfaced a **data-loss bug**: the cascade helpers (written for the derived-node model) put `outputDatasetId` — which equals the SOURCE `leftDatasetId` under in-place — into `datasetIds`, and `execCascade` deletes those datasets, so removing one join would delete the source left dataset. Fixed: `computeGStepCascade`/`computeDatasetCascade` rewritten for in-place — `datasetIds` always `[]` (no dataset ever removed by a cascade); CascadeConfirm degrades to interactions-only (its dataset section + "save snapshot" are gated on a non-empty list). Spec text in `ClaudePlan.md` (9.3) updated with an AS-BUILT in-place note covering state/deletion/export + the Task 3b limitation. Build + lint:undef green. **NEW: Task 3b filed** (G-step ↔ local-step desync — consistency/export-fidelity, not data-loss). **Next: Task 4 (e2e), and evaluate Task 3b option (b) derive-from-local.**
