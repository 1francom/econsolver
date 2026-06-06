# Phase 4b — Local Persistence Completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Checkbox steps.
>
> Source spec: `docs/superpowers/specs/2026-06-05-local-persistence-completeness-design.md`. Executor: Claude.

**Goal:** Durably persist the pinned-model buffer and spatial maps to IndexedDB (project-scoped, restored on open), and confirm plots + Calculate equations restore. Local only — no cloud.

**Architecture:** Two new IDB stores (`model_buffer`, `spatial_maps`, keyed by `pid`) added at DB v9 via the existing idempotent `contains`-guarded `onupgradeneeded` + `REQUIRED_STORES` auto-upgrade. A shared `trimResult` strips heavy arrays before persisting models. `modelBuffer` becomes project-aware (`setProject(pid)` + debounced save). Restore is wired into the project lifecycle.

**Tech Stack:** React + Vite + plain JS. No JS unit runner — gates: Node harness for `trimResult`, `npm run build`, Franco browser-validation.

**Invariants:** local-only (no network); pid-scoped; IndexedDB not localStorage; no cross-project bleed. Branch `Main-`. Collision-free with Codex (idle); add only each task's files.

---

## Task 1: IDB v9 — `model_buffer` + `spatial_maps` stores

**Files:** `src/services/Persistence/indexedDB.js`

- [ ] **Step 1: Add store constants + bump version + REQUIRED_STORES**

```js
const DB_VERSION           = 9;            // was 8
const STORE_MODEL_BUFFER   = "model_buffer";
const STORE_SPATIAL_MAPS   = "spatial_maps";
```
Add both names to the `REQUIRED_STORES` array.

- [ ] **Step 2: Create the stores in `onupgradeneeded`** (after the `dataset_registry` block, same idempotent pattern):

```js
      // model_buffer store — pinned-model comparison buffer, keyed by project pid.
      if (!db.objectStoreNames.contains(STORE_MODEL_BUFFER)) {
        db.createObjectStore(STORE_MODEL_BUFFER, { keyPath: "pid" });
      }
      // spatial_maps store — serialized spatial map/layer configs, keyed by project pid.
      if (!db.objectStoreNames.contains(STORE_SPATIAL_MAPS)) {
        db.createObjectStore(STORE_SPATIAL_MAPS, { keyPath: "pid" });
      }
```

- [ ] **Step 3: Add save/load/delete fns** (mirror `saveCoachChats`/`loadCoachChats`/`deleteCoachChats`):

```js
export async function saveModelBuffer(pid, models) {
  if (!pid) return { stored: false };
  try {
    const db = await openDB();
    await tx(STORE_MODEL_BUFFER, db, "readwrite", s =>
      s.put({ pid, models: Array.isArray(models) ? models : [], ts: Date.now() }));
    return { stored: true };
  } catch (err) { console.warn("[IDB] saveModelBuffer failed:", err.message); return { stored: false }; }
}
export async function loadModelBuffer(pid) {
  if (!pid) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE_MODEL_BUFFER, "readonly");
      const req = t.objectStore(STORE_MODEL_BUFFER).get(pid);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror = e => reject(e.target.error);
    });
  } catch { return null; }
}
export async function deleteModelBuffer(pid) {
  try { const db = await openDB(); await tx(STORE_MODEL_BUFFER, db, "readwrite", s => s.delete(pid)); } catch {}
}
```
Add the identical trio for `spatial_maps` → `saveSpatialMaps(pid, maps)` / `loadSpatialMaps(pid)` / `deleteSpatialMaps(pid)` (record `{ pid, maps, ts }`).

- [ ] **Step 4: Extend the delete-project cascade**

Find `deleteProject(pid)` (and/or wherever `deleteCoachChats`/`deleteDatasetRegistry` are cascaded) and add `await deleteModelBuffer(pid); await deleteSpatialMaps(pid);` so removing a project cleans these too.

- [ ] **Step 5: Build**

Run: `npm run build` → success.

- [ ] **Step 6: Commit**

```bash
git add src/services/Persistence/indexedDB.js
git commit -m "feat(persistence): IDB v9 — model_buffer + spatial_maps stores

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared `trimResult` + harness

**Files:** Create `src/services/persistence/trimResult.js`, `src/services/Persistence/__validation__/trimResult.test.mjs`; modify `src/services/AI/sessionSnapshot.js`.

- [ ] **Step 1: Write the shared helper** (lift/extend the projection already in `sessionSnapshot.js`):

```js
// src/services/persistence/trimResult.js
// Comparison-sufficient projection of an EstimationResult: keeps coefficients,
// fit stats, and spec; strips heavy arrays (fitted values, residuals, vcov,
// first-stage arrays) that bloat IDB and aren't needed to redisplay/export.
export function trimResult(r) {
  if (!r || typeof r !== "object") return null;
  const {
    id, type, label, modelLabel, spec, yVar, xVars, zVars, wVars, varNames,
    beta, se, pVals, tStats, testStats, R2, adjR2, n, df, Fstat, Fpval,
    att, attSE, attP, late, lateSE, lateP, seType, kernel, bandwidth, cutoff,
    runningVar, treatVar, postVar, entityCol, timeCol,
  } = r;
  return {
    id, type, label: label ?? modelLabel,
    spec: spec ?? { yVar, xVars, zVars, wVars, entityCol, timeCol, postVar, treatVar, runningVar, cutoff, bandwidth, kernel },
    varNames, beta, se, pVals, tStats: tStats ?? testStats,
    R2, adjR2, n, df, Fstat, Fpval, att, attSE, attP, late, lateSE, lateP, seType,
  };
}
```

- [ ] **Step 2: Harness** `trimResult.test.mjs`:

```js
import { trimResult } from "../../persistence/trimResult.js";
let pass = 0, fail = 0; const check = (n, c) => c ? (pass++, console.log("  [pass]", n)) : (fail++, console.log("  [FAIL]", n));
const big = { id: "m1", type: "OLS", modelLabel: "OLS", spec: { yVar: "y", xVars: ["x"] },
  varNames: ["(Intercept)", "x"], beta: [1, 2], se: [0.1, 0.2], pVals: [0.5, 0.01],
  R2: 0.8, n: 100, fittedValues: new Array(100).fill(0), residuals: new Array(100).fill(0), vcov: [[1,0],[0,1]] };
const t = trimResult(big);
check("keeps coefficients", t.beta.length === 2 && t.se.length === 2);
check("keeps fit + spec", t.R2 === 0.8 && t.spec.yVar === "y" && t.label === "OLS");
check("strips fittedValues", t.fittedValues === undefined);
check("strips residuals", t.residuals === undefined);
check("strips vcov", t.vcov === undefined);
check("json round-trips", JSON.parse(JSON.stringify(t)).beta[1] === 2);
check("null in → null out", trimResult(null) === null);
console.log(`\ntrimResult: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run harness** → `node src/services/Persistence/__validation__/trimResult.test.mjs` → `7 passed`.

- [ ] **Step 4: Refactor sessionSnapshot to use the shared helper**

In `sessionSnapshot.js`, replace its local `trimResult` with `import { trimResult } from "../persistence/trimResult.js";` (delete the duplicate definition; keep behavior). Verify the snapshot still serializes (its fields are a subset of the shared projection).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/services/persistence/trimResult.js src/services/Persistence/__validation__/trimResult.test.mjs src/services/AI/sessionSnapshot.js
git commit -m "feat(persistence): shared trimResult helper (modelBuffer + sessionSnapshot) + harness"
```

> Note the two path casings already coexist in the repo (`services/Persistence/` for IDB, lowercase used elsewhere). Create `trimResult.js` under `src/services/persistence/` (lowercase) as referenced; if the build's case-sensitivity complains, place it beside `indexedDB.js` under `Persistence/` and update the import. Confirm at build.

---

## Task 3: Project-aware `modelBuffer` + debounced persistence

**Files:** `src/services/modelBuffer.js`

- [ ] **Step 1: Add pid + persistence**

```js
import { saveModelBuffer, loadModelBuffer } from "./Persistence/indexedDB.js";
import { trimResult } from "./persistence/trimResult.js";

let _buf = [];
let _pid = null;
let _saveTimer = null;

function _persist() {
  if (!_pid) return;                         // pre-project: in-memory only
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveModelBuffer(_pid, _buf.map(trimResult).filter(Boolean));
  }, 400);
}

// Load this project's pinned models into the buffer. Returns a Promise.
export async function setProject(pid) {
  _pid = pid || null;
  if (!_pid) { _buf = []; return; }
  const rec = await loadModelBuffer(_pid);
  _buf = Array.isArray(rec?.models) ? rec.models : [];
}
```

- [ ] **Step 2: Persist on mutation**

In `add`, `remove`, `clear`, call `_persist()` before returning. (`add` returns `id` as before; persistence is a side effect.)

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/services/modelBuffer.js
git commit -m "feat(modeling): modelBuffer is project-aware (setProject + debounced IDB persistence)"
```

---

## Task 4: Restore pinned models on project open

**Files:** `src/components/ModelingTab.jsx` (and/or `src/DataStudio.jsx`)

- [ ] **Step 1: Call `setProject` + re-render on pid change**

`ModelingTab` already re-reads the buffer via a `bufferVersion` counter (`pinnedModels = useMemo(() => modelBuffer.getAll(), [bufferVersion])`). Add an effect that loads the project's buffer on `pid` change, then bumps `bufferVersion`:

```js
useEffect(() => {
  let cancelled = false;
  modelBuffer.setProject(pid).then(() => { if (!cancelled) setBufferVersion(v => v + 1); });
  return () => { cancelled = true; };
}, [pid]);
```

(Read `ModelingTab` to confirm the exact names: the `pid` prop, the `bufferVersion` state setter, and the `modelBuffer` import. Match them.)

- [ ] **Step 2: Build + browser sanity**

Run: `npm run build` → success. Browser: pin 2 models → reload → they're still in the comparison buffer.

- [ ] **Step 3: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): restore pinned-model buffer on project open"
```

---

## Task 5: Maps persistence (Part B)

**Files:** `src/components/tabs/spatial/map/SpatialPlotTab.jsx` (+ `plot/SpatialGeoPlot.jsx`), `src/DataStudio.jsx`

- [ ] **Step 1: Locate the authoritative layer-config state**

Read `SpatialPlotTab.jsx` (Map tab) and `SpatialGeoPlot.jsx` (Plot tab). Identify the serializable config object (layers array + basemap + color scales + bound dataset/column refs + opacity/radius/legend). Confirm it contains **no** Leaflet/DOM instances (only plain data). If render objects are mixed into state, separate the serializable config from the live render handles.

- [ ] **Step 2: Accept `pid` + persistence props**

Thread `pid` into the Spatial tab. On config change, debounced `saveSpatialMaps(pid, config)`. On mount, `loadSpatialMaps(pid)` → hydrate the config state (rebuild the Leaflet/Observable render from it).

- [ ] **Step 3: Fail-soft on missing datasets**

When hydrating, drop any layer whose `datasetId`/columns no longer exist in the current session (skip, don't crash). Surface a small "1 layer skipped (dataset removed)" note if any are pruned.

- [ ] **Step 4: Build + browser-validate**

Run: `npm run build` → success. Browser: build a map (a layer or two) → reload → map restored; remove the underlying dataset → map loads without that layer, no crash.

- [ ] **Step 5: Commit**

```bash
git add src/components/tabs/spatial/map/SpatialPlotTab.jsx src/components/tabs/spatial/plot/SpatialGeoPlot.jsx src/DataStudio.jsx
git commit -m "feat(spatial): persist + restore map/layer configs per project"
```

> If the geo-plot tab's config is not already a plain object, MVP-scope this task to the Map tab (`SpatialPlotTab`) and open a follow-up for the geo-plot tab — note it in the commit.

---

## Task 6: Verify plots + equations restore (Part C)

**Files:** read `src/components/PlotBuilder.jsx` / `ExplorerModule.jsx`, `src/components/tabs/CalculateTab.jsx`, `src/components/calculate/workbench/workbenchStore.js`

- [ ] **Step 1: Plots** — confirm a consumer calls `getPlotHistory(pid)` on mount and `savePlotHistory(pid, …)` on plot create. If load-on-open is missing, add it (hydrate the plot list for the active `pid`).

- [ ] **Step 2: Equations** — confirm `CalculateTab`/workbench calls `loadWorkbenchRecord(pid)` on open and `saveWorkbenchRecord(pid, …)` on change. If missing, add it.

- [ ] **Step 3: Build + browser-validate** — create a plot and a Calculate equation → reload → both restored. Commit only if changes were needed:

```bash
git add -p   # only the touched files
git commit -m "fix(persistence): restore plots + Calculate equations on project open"
```

---

## Task 7: Docs

**Files:** `CLAUDE.md`, `ClaudePlan.md`

- [ ] **Step 1:** In `CLAUDE.md`, update the `indexedDB.js` line to note v9 + `model_buffer`/`spatial_maps` stores; add `src/services/persistence/trimResult.js`.
- [ ] **Step 2:** In `ClaudePlan.md`, set the `2026-06-05 local-persistence-completeness` row to `DONE (browser-validation pending)`.
- [ ] **Step 3:** Commit.

---

## Self-review notes

- **Spec coverage:** Part A → Tasks 1–4; Part B → Task 5; Part C → Task 6; Part D (cascade + no bleed) → Task 1 Step 4 + Task 4 (setProject swaps cleanly).
- **Type consistency:** `trimResult` output shape is the single persisted model projection (Tasks 2/3), consumed identically by buffer restore and sessionSnapshot.
- **No JS unit runner:** Task 2's harness is the automated gate; the rest is build + browser.
- **Determinism / isolation:** `setProject(pid)` swaps `_buf` per project; pre-project (no pid) stays in-memory-only (no stray saves).
