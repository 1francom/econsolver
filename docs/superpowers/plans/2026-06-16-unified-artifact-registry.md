# Unified Project-Artifact Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved plots, maps, and pinned models persist project-wide (not per-dataset), be renamable/reorderable/clickable-to-switch-dataset, and flow into Report in a user-defined global order that drives the single R/Python/Stata replication script — and make Report available straight after a refresh whenever models are saved.

**Architecture:** Layer over the three existing stores (`plotHistory_<pid>`, `mapHistory_<pid>`, `model_buffer`) and the existing translators — no storage rewrite. Add (1) a tiny per-project `artifactOrder_<pid>` ordering array + pure helpers, (2) `datasetId` tags + rename on each artifact, (3) project-pid scoping for the Explore PlotBuilder, (4) App-level model-buffer loading + Report unlock, (5) click-to-switch via in-place dataset switch (models) or a pending-plot handoff (plots).

**Tech Stack:** React + Vite (JS, inline styles with `C`/`T` theme tokens), IndexedDB (`pipelines` + `model_buffer` stores), Node `.mjs` validation harnesses for pure-JS logic. Verification gates: `npm run lint:undef` + `npm run build` green; Franco browser-validates before sign-off.

---

## Conventions for every task

- **Surgical `Edit` patches only** — never rewrite a whole file.
- After code changes in a task, **always run** `npm run lint:undef` then `npm run build` and confirm both succeed before committing.
- Commit at the end of each task. Branch is `Main-` (push is Franco's job — do **not** push).
- Pure-JS logic gets a Node `.mjs` test under `src/services/Persistence/__validation__/` or `src/services/__validation__/`; UI/state behavior is browser-validated by Franco (note it in the commit body, do not claim it verified).

---

## File Structure

- **Create:** `src/services/Persistence/artifactOrder.js` — `getArtifactOrder`/`saveArtifactOrder` (IDB) + pure helpers `makeArtifactId`/`parseArtifactId`/`orderArtifacts`.
- **Create:** `src/services/Persistence/__validation__/artifactOrderValidation.mjs` — Node test for the pure helpers.
- **Modify:** `src/services/Persistence/trimResult.js` — preserve `datasetId`.
- **Modify:** `src/services/modelBuffer.js` — `setLabel(id,label)` + `reorder(ids)`.
- **Modify:** `src/App.jsx` — App-level buffer load, Report unlock + render-from-models, `projectPid` + handoff wiring.
- **Modify:** `src/components/workspace/WorkspaceBar.jsx` — accept `reportUnlocked`.
- **Modify:** `src/components/ModelingTab.jsx` — `datasetId` prop, stamp models, rename/reorder/switch wiring.
- **Modify:** `src/components/modeling/ModelBufferBar.jsx` — rename, reorder (◀▶), click body restores, dataset badge + switch.
- **Modify:** `src/components/PlotBuilder.jsx` — `projectPid` history scope + legacy merge, stamp `datasetId`, rename + reorder cards, request-dataset on load.
- **Modify:** `src/ExplorerModule.jsx` — thread `projectPid`, project-scope explore pins, `onRequestDataset`, consume `pendingPlot`.
- **Modify:** `src/components/tabs/spatial/map/SpatialPlotTab.jsx` — reorder controls on map history (rename already exists).
- **Modify:** `src/ReportingModule.jsx` — order the combined artifact list by `artifactOrder_<pid>` + drag UI; persist; feed order into the deterministic visual/model sections.

---

## Task 1: Artifact-order store + pure helpers

**Files:**
- Create: `src/services/Persistence/artifactOrder.js`
- Test: `src/services/Persistence/__validation__/artifactOrderValidation.mjs`

- [ ] **Step 1: Write the pure helpers + IDB accessors**

Create `src/services/Persistence/artifactOrder.js`:

```javascript
// ─── Unified artifact ordering — IndexedDB via the shared openDB singleton ─────
// A project's global display/replication order across plots, maps, and models.
// Stored in the existing `pipelines` store under key `artifactOrder_<pid>` as an
// array of namespaced ids ("plot:<id>" | "map:<id>" | "model:<id>"). Layers over
// the three existing stores — no migration, no schema bump.
import { openDB } from "./indexedDB.js";

const STORE = "pipelines";

// "plot" + "ph_x4" → "plot:ph_x4"
export function makeArtifactId(type, id) {
  return `${type}:${id}`;
}

// "plot:ph_x4" → { type: "plot", id: "ph_x4" }  (id may itself contain ":")
export function parseArtifactId(key) {
  const i = String(key).indexOf(":");
  if (i < 0) return { type: null, id: String(key) };
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}

// Sort `artifacts` (each must expose `.artifactId`) by `order` (array of
// namespaced ids). Items present in `order` come first in that order; items not
// in `order` are appended, sorted by `.savedAt` ascending (stable for ties).
export function orderArtifacts(artifacts, order) {
  const rank = new Map((order ?? []).map((k, i) => [k, i]));
  const known = [];
  const unknown = [];
  for (const a of artifacts ?? []) {
    if (rank.has(a.artifactId)) known.push(a);
    else unknown.push(a);
  }
  known.sort((x, y) => rank.get(x.artifactId) - rank.get(y.artifactId));
  unknown.sort((x, y) => (x.savedAt ?? 0) - (y.savedAt ?? 0));
  return [...known, ...unknown];
}

export async function getArtifactOrder(pid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(`artifactOrder_${pid}`);
    req.onsuccess = () => resolve(req.result?.order ?? []);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveArtifactOrder(pid, order) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put({ id: `artifactOrder_${pid}`, order, ts: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror = e => reject(e.target.error);
  });
}
```

- [ ] **Step 2: Write the failing Node test**

Create `src/services/Persistence/__validation__/artifactOrderValidation.mjs`. Import only the pure helpers (no IDB) by re-declaring them is NOT allowed — instead import from the source file; the IDB accessors import `openDB` which is browser-only, so guard the test to call only the pure exports (ESM import does not execute `getArtifactOrder`, and `openDB` is only referenced inside those async fns, so top-level import is safe):

```javascript
import assert from "node:assert/strict";
import { makeArtifactId, parseArtifactId, orderArtifacts } from "../artifactOrder.js";

// makeArtifactId / parseArtifactId round-trip, including ids containing ":"
assert.equal(makeArtifactId("plot", "ph_x4"), "plot:ph_x4");
assert.deepEqual(parseArtifactId("plot:ph_x4"), { type: "plot", id: "ph_x4" });
assert.deepEqual(parseArtifactId("model:a:b"), { type: "model", id: "a:b" });

// orderArtifacts: known ids honor order; unknowns append by savedAt
const arts = [
  { artifactId: "plot:p1", savedAt: 30 },
  { artifactId: "map:m1",  savedAt: 10 },
  { artifactId: "model:x", savedAt: 20 },
];
const ordered = orderArtifacts(arts, ["model:x", "plot:p1"]);
assert.deepEqual(ordered.map(a => a.artifactId), ["model:x", "plot:p1", "map:m1"]);

// empty order → pure savedAt ordering
assert.deepEqual(
  orderArtifacts(arts, []).map(a => a.artifactId),
  ["map:m1", "model:x", "plot:p1"]
);

console.log("artifactOrder OK");
```

- [ ] **Step 3: Run the test**

Run: `node src/services/Persistence/__validation__/artifactOrderValidation.mjs`
Expected: prints `artifactOrder OK`, exit 0. (If `openDB` import throws under Node because `indexedDB.js` touches `window` at module top-level, change the test to import the helpers from a local copy is NOT allowed — instead move the three pure helpers above the `import { openDB }` line in `artifactOrder.js` and confirm `indexedDB.js` has no top-level `window`/`indexedDB` access; it uses lazy `openDB()`, so the import is side-effect-free.)

- [ ] **Step 4: lint + build**

Run: `npm run lint:undef` then `npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/services/Persistence/artifactOrder.js src/services/Persistence/__validation__/artifactOrderValidation.mjs
git commit -m "feat(report): artifactOrder store + pure ordering helpers"
```

---

## Task 2: Persist model `datasetId` + rename/reorder in the buffer

**Files:**
- Modify: `src/services/Persistence/trimResult.js:10-28`
- Modify: `src/services/modelBuffer.js`

- [ ] **Step 1: Preserve `datasetId` through trimResult**

In `trimResult.js`, add `datasetId` to both the destructure and the returned object so the per-model source-dataset tag survives persistence and AI snapshots.

Destructure (add `datasetId` near `id, type, label`):

```javascript
  const {
    id, type, label, modelLabel, datasetId, spec, yVar, xVars, zVars, wVars, varNames,
```

Returned object (add `datasetId` right after `id`):

```javascript
  return {
    id,
    datasetId: datasetId ?? null,
    type,
    label: label ?? modelLabel,
```

- [ ] **Step 2: Add `setLabel` + `reorder` to modelBuffer**

In `src/services/modelBuffer.js`, after `remove()` (line ~59), add:

```javascript
// Rename a pinned model's label (used by ModelBufferBar inline rename).
export function setLabel(id, label) {
  _buf = _buf.map(r => r.id === id ? { ...r, label } : r);
  _persist();
}

// Reorder the buffer to match `ids` (array of model ids); unknown ids dropped,
// missing ids kept in their current relative order at the end.
export function reorder(ids) {
  const byId = new Map(_buf.map(r => [r.id, r]));
  const next = [];
  for (const id of ids) { if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); } }
  for (const r of _buf) { if (byId.has(r.id)) next.push(r); }
  _buf = next;
  _persist();
}
```

- [ ] **Step 3: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/services/Persistence/trimResult.js src/services/modelBuffer.js
git commit -m "feat(report): persist model datasetId + buffer setLabel/reorder"
```

---

## Task 3: Report available after refresh (App-level buffer load + unlock)

**Files:**
- Modify: `src/App.jsx` (state seed near 2653; new effect near 2690; `hasOutput`/render near 2937 and 3097)
- Modify: `src/components/workspace/WorkspaceBar.jsx:26,55`

- [ ] **Step 1: Import modelBuffer in App.jsx**

Add to the imports block at the top of `src/App.jsx` (next to other service imports):

```javascript
import * as modelBuffer from "./services/modelBuffer.js";
```

- [ ] **Step 2: Seed pinned models at App level on project open**

In `src/App.jsx`, immediately after the existing session-restore effect (after the block ending at line ~2699), add:

```javascript
  // Load this project's pinned-model buffer at the App level so Report (and its
  // lock) see saved models WITHOUT requiring a Model-tab visit (refresh bug).
  // ModelingTab shares the same modelBuffer singleton and keeps App in sync via
  // onSessionStateChange, so this only seeds the initial state.
  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    modelBuffer.setProject(pid).then(() => {
      if (!cancelled) setModelingSession(s => ({ ...s, pinnedModels: modelBuffer.getAll() }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pid]);
```

- [ ] **Step 3: Unlock Report when models exist**

In `src/App.jsx`, the `WorkspaceBar` usage (line ~2937), add a `reportUnlocked` prop alongside `hasOutput`:

```javascript
                hasOutput={!!(tabOutput(activeTab) || tabRawData(activeTab)?.rows?.length)}
                reportUnlocked={(modelingSession?.pinnedModels?.length ?? 0) > 0}
```

- [ ] **Step 4: Consume `reportUnlocked` in WorkspaceBar**

In `src/components/workspace/WorkspaceBar.jsx`, change the signature (line 26) to accept the prop:

```javascript
export default function WorkspaceBar({ activeTab, onTabChange, hasOutput, reportUnlocked, activeDatasetId, pid, onSelectDataset, onRemoveDataset, onStartTour, onOpenFeedback }) {
```

and change the lock computation (line 55) so Report unlocks when models exist:

```javascript
          const isLocked = tab.requiresOutput && !hasOutput && !(tab.id === "report" && reportUnlocked);
```

- [ ] **Step 5: Render Report from models when no live dataset**

In `src/App.jsx`, the REPORT panel (line ~3097), change the conditional so pinned models alone are enough:

```javascript
                  {(reportCleanedData || (modelingSession?.pinnedModels?.length ?? 0) > 0)
                    ? <ReportingModule result={activeResult} cleanedData={reportCleanedData} availableDatasets={availableDatasets} pinnedModels={modelingSession?.pinnedModels ?? []} pid={pid} />
                    : <NeedsOutput onGoToClean={() => navigateToTab("clean")} />
                  }
```

(Confirm `ReportingModule` tolerates `cleanedData={null}`: `buildSessionSnapshot` and `AIUnifiedScript` already default-guard `cleanedData?.…`. If any non-guarded `cleanedData.` access exists in `ReportingModule.jsx`, add a `?.`. Do a quick Grep `cleanedData\.` in that file and fix any bare access.)

- [ ] **Step 6: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/components/workspace/WorkspaceBar.jsx
git commit -m "fix(report): available after refresh — App-level buffer load + unlock on pinned models"
```

Browser-validate (Franco): refresh a project that has pinned models but no freshly-run pipeline → Report tab is unlocked and renders, ready to generate AI scripts.

---

## Task 4: Models — stamp datasetId, rename, reorder, click-to-switch

**Files:**
- Modify: `src/App.jsx` (ModelingTab usage ~3031)
- Modify: `src/components/ModelingTab.jsx` (props 206; specExtras 588; ModelBufferBar usage 3313)
- Modify: `src/components/modeling/ModelBufferBar.jsx`

- [ ] **Step 1: Pass dataset id + switch callback into ModelingTab**

In `src/App.jsx`, the `<ModelingTab …>` props (line ~3031), add:

```javascript
                        datasetId={tabDsId("model")}
                        onSwitchDataset={(id) => selectDataset("model", id, true)}
```

- [ ] **Step 2: Accept the new props in ModelingTab**

In `src/components/ModelingTab.jsx` (line 206) add `datasetId` and `onSwitchDataset` to the destructured props:

```javascript
export default function ModelingTab({ cleanedData, availableDatasets = [], onBack, onResultChange, onSessionStateChange, onCoachQuestion, onExtract, pid, datasetId, onSwitchDataset }) {
```

- [ ] **Step 3: Stamp every estimated result with `datasetId`**

In `src/components/ModelingTab.jsx`, in `specExtras` (line 588) the spec already records `filename`. Stamp the result object itself with `datasetId` so the buffer/`trimResult` persist it. After line 588's `const specExtras = …;` add the result-level tag on the dispatched result(s):

```javascript
    const _dsTag = datasetId ?? null;
    if (dispatch?.result)     dispatch.result.datasetId    = _dsTag;
    if (dispatch?.result?.fe) dispatch.result.fe.datasetId = _dsTag;
    if (dispatch?.result?.fd) dispatch.result.fd.datasetId = _dsTag;
```

Add `datasetId` to the `_runEstimation` useCallback dep array (end of the array at line 593): append `, datasetId`.

- [ ] **Step 4: Wire ModelBufferBar rename/reorder/switch**

In `src/components/ModelingTab.jsx`, replace the `<ModelBufferBar … />` block (lines 3313-3326) with:

```javascript
        <ModelBufferBar
          models={pinnedModels}
          activeId={activeBufferId}
          datasetNames={Object.fromEntries((availableDatasets || []).map(d => [d.id, d.name ?? d.filename]))}
          currentDatasetId={datasetId}
          onRestore={(id) => {
            const r = modelBuffer.get(id);
            if (r) { setResult(r); setActiveBufferId(id); }
          }}
          onRemove={(id) => {
            modelBuffer.remove(id);
            if (activeBufferId === id) setActiveBufferId(null);
            setBufferVersion(v => v + 1);
          }}
          onRename={(id, label) => { modelBuffer.setLabel(id, label); setBufferVersion(v => v + 1); }}
          onReorder={(ids) => { modelBuffer.reorder(ids); setBufferVersion(v => v + 1); }}
          onSwitchDataset={(id) => { if (id && id !== datasetId) onSwitchDataset?.(id); }}
          onCompare={() => setCompareOpen(true)}
        />
```

- [ ] **Step 5: Implement rename/reorder/switch UI in ModelBufferBar**

In `src/components/modeling/ModelBufferBar.jsx`, replace the signature (line 39) and the card `.map` (lines 59-100) to add: a dataset badge that switches on click, double-click-to-rename on the label, and ◀ ▶ reorder buttons. New signature:

```javascript
import { useState } from "react";
import { useTheme } from "./shared.jsx";
```

```javascript
export default function ModelBufferBar({ models, activeId, datasetNames = {}, currentDatasetId, onRestore, onRemove, onRename, onReorder, onSwitchDataset, onCompare }) {
  const { C, T } = useTheme();
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");
  if (!models?.length) return null;
  const canCompare = models.length >= 2;
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= models.length) return;
    const ids = models.map(m => m.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder?.(ids);
  };
```

Replace the card body (inside `models.map(r => { … })`) so each card renders index-aware controls. Use this card return (keep the existing `clr`/`stat`/`label`/`n` computations, but read `const dsId = r.datasetId; const dsName = datasetNames[dsId];` and add `i` to the map args `models.map((r, i) => {`):

```javascript
          <div
            key={r.id}
            onClick={() => onRestore(r.id)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "3px 7px 3px 9px",
              border: `1px solid ${isActive ? clr : C.border2}`,
              borderLeft: `3px solid ${clr}`,
              borderRadius: 3,
              background: isActive ? `${clr}14` : C.bg,
              cursor: "pointer", transition: "all 0.12s",
            }}
          >
            <button onClick={e => { e.stopPropagation(); move(i, -1); }} title="Move left"
              style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>◀</button>
            {editId === r.id ? (
              <input
                autoFocus value={editVal}
                onClick={e => e.stopPropagation()}
                onChange={e => setEditVal(e.target.value)}
                onBlur={() => { onRename?.(r.id, editVal.trim() || label); setEditId(null); }}
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditId(null); }}
                style={{ width: 90, background: C.surface2, border: `1px solid ${clr}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "1px 4px" }}
              />
            ) : (
              <span
                onDoubleClick={e => { e.stopPropagation(); setEditId(r.id); setEditVal(label); }}
                title="Double-click to rename"
                style={{ fontSize: T.caption.fontSize, color: clr, fontFamily: T.code.fontFamily, letterSpacing: "0.05em" }}>
                {label}
              </span>
            )}
            <span style={{ fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>
              ·n={n}{stat ? `·${stat}` : ""}
            </span>
            {dsName && dsId !== currentDatasetId && (
              <button onClick={e => { e.stopPropagation(); onSwitchDataset?.(dsId); }} title={`Switch to ${dsName}`}
                style={{ background: `${C.blue}18`, border: `1px solid ${C.blue}55`, borderRadius: 3, color: C.blue, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0 4px", lineHeight: 1.4 }}>
                ⇄ {dsName}
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); move(i, 1); }} title="Move right"
              style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>▶</button>
            <button onClick={e => { e.stopPropagation(); onRemove(r.id); }} title="Remove from buffer"
              style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: T.code.fontSize, padding: "0 2px", lineHeight: 1, marginLeft: 2 }}>×</button>
          </div>
```

- [ ] **Step 6: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/components/ModelingTab.jsx src/components/modeling/ModelBufferBar.jsx
git commit -m "feat(model): pinned-model datasetId tag + rename/reorder/switch-dataset in buffer bar"
```

Browser-validate (Franco): estimate models on datasets A and B; both stay pinned after switching datasets; double-click renames; ◀▶ reorder; the ⇄ badge switches the Model tab's dataset.

---

## Task 5: PlotBuilder — project-scoped history, datasetId tag, rename/reorder, request-dataset

**Files:**
- Modify: `src/components/PlotBuilder.jsx` (props 1121; history load 1177; save 1218; card 1006 + 1648; nav/delete)

- [ ] **Step 1: Add `projectPid`, `datasetId`, `onRequestDataset` props**

In `src/components/PlotBuilder.jsx` (line 1121):

```javascript
export default function PlotBuilder({ headers = [], rows = [], style, initialLayers = [], pid, projectPid, datasetId, onRequestDataset, scriptPreamble, datasetName }) {
```

Define a single source for the history scope just after `const { C, T, prefs } = useTheme();`:

```javascript
  const histPid = projectPid ?? pid; // history is project-scoped; falls back to pid
```

- [ ] **Step 2: Load project-scoped history + merge legacy per-dataset entries once**

Replace the history-load effect (lines 1177-1180) with:

```javascript
  // Load project-scoped plot history; one-time best-effort merge of legacy
  // per-dataset entries (old plotHistory_<datasetId>) so nothing is lost.
  useEffect(() => {
    if (!histPid) return;
    let cancelled = false;
    (async () => {
      const proj = await getPlotHistory(histPid).catch(() => []);
      let merged = Array.isArray(proj) ? proj : [];
      if (datasetId && datasetId !== histPid) {
        const legacy = await getPlotHistory(datasetId).catch(() => []);
        const have = new Set(merged.map(e => e.id));
        const adopt = (legacy ?? [])
          .filter(e => !have.has(e.id))
          .map(e => ({ ...e, datasetId: e.datasetId ?? datasetId, datasetName: e.datasetName ?? datasetName }));
        if (adopt.length) { merged = [...merged, ...adopt]; savePlotHistory(histPid, merged).catch(() => {}); }
      }
      if (!cancelled) setPlotHistory(merged);
    })();
    return () => { cancelled = true; };
  }, [histPid, datasetId]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Stamp `datasetId` on save + persist under `histPid`**

In `savePlot` (lines 1218-1240): in the new-entry branch (line 1229) add the dataset tag, and change the two `savePlotHistory(pid, …)` calls to `histPid`. New-entry object:

```javascript
      const entry = {
        id:      "ph_" + Math.random().toString(36).slice(2, 8),
        name:    `Plot ${plotHistory.length + 1}`,
        ...current,
        datasetId:   datasetId ?? null,
        datasetName: datasetName ?? null,
        savedAt: Date.now(),
      };
```

Persist line (1239) → `if (histPid) savePlotHistory(histPid, next).catch(() => {});` and update the dep array `[plotHistory, histIdx, layers.length, currentPlotEntry, histPid, datasetId, datasetName]`.

- [ ] **Step 4: Make delete + rename + reorder persist under `histPid`**

Find `deleteFromHistory` (line ~1280) and change its `savePlotHistory(pid, …)` to `histPid`. Add two callbacks next to it:

```javascript
  const renamePlot = useCallback((id, name) => {
    const next = plotHistory.map(e => e.id === id ? { ...e, name } : e);
    setPlotHistory(next);
    if (histPid) savePlotHistory(histPid, next).catch(() => {});
  }, [plotHistory, histPid]);

  const movePlot = useCallback((i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= plotHistory.length) return;
    const next = [...plotHistory];
    [next[i], next[j]] = [next[j], next[i]];
    setPlotHistory(next);
    if (histPid) savePlotHistory(histPid, next).catch(() => {});
  }, [plotHistory, histPid]);
```

- [ ] **Step 5: On load, request dataset switch if the plot belongs to another dataset**

Change the card `onLoad` (line 1654) so loading a foreign-dataset plot asks the parent to switch first:

```javascript
                  onLoad={() => {
                    if (entry.datasetId && datasetId && entry.datasetId !== datasetId) {
                      onRequestDataset?.(entry.datasetId, entry.id);
                    } else {
                      loadPlotEntry(entry); setHistIdx(i);
                    }
                  }}
```

- [ ] **Step 6: Pass index + rename/move into the card**

Update the `<PlotHistoryCard …>` usage (line 1649) to add `index`, `count`, `onRename`, `onMove`:

```javascript
                <PlotHistoryCard
                  key={entry.id}
                  entry={entry}
                  index={i}
                  count={plotHistory.length}
                  isCompared={compareIds.has(entry.id)}
                  C={C}
                  datasetName={entry.datasetName}
                  foreign={!!(entry.datasetId && datasetId && entry.datasetId !== datasetId)}
                  onLoad={() => {
                    if (entry.datasetId && datasetId && entry.datasetId !== datasetId) onRequestDataset?.(entry.datasetId, entry.id);
                    else { loadPlotEntry(entry); setHistIdx(i); }
                  }}
                  onRename={(name) => renamePlot(entry.id, name)}
                  onMove={(dir) => movePlot(i, dir)}
                  onDelete={() => deleteFromHistory(entry.id)}
                  onCompare={() => toggleCompare(entry.id)}
                />
```

(Remove the now-duplicated `onLoad` you added in Step 5 if you keep it here — keep a single `onLoad`.)

- [ ] **Step 7: Extend PlotHistoryCard with rename + move + source badge**

Replace `PlotHistoryCard` (lines 1006-1050). Add `useState` import at top of file if not present (PlotBuilder already imports `useState`). New component:

```javascript
function PlotHistoryCard({ entry, index, count, isCompared, onLoad, onRename, onMove, onDelete, onCompare, C: Cp, datasetName, foreign }) {
  const { T } = useTheme();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(entry.name || "");
  const geomNames = [...new Set(entry.layers.map(l => l.geom))].slice(0, 3).join(", ");
  return (
    <div
      onClick={onLoad}
      style={{
        flexShrink: 0, width: 150, cursor: "pointer", borderRadius: 4, padding: "6px 8px",
        background: isCompared ? "rgba(110,200,180,0.08)" : Cp.bg,
        border: `1px solid ${isCompared ? Cp.teal : Cp.border}`,
        display: "flex", flexDirection: "column", gap: 4, position: "relative",
      }}>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {entry.layers.slice(0, 5).map((l, i) => (
          <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: l.fill, flexShrink: 0, display: "inline-block" }} />
        ))}
      </div>
      <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.textMuted, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {geomNames || "empty"}
      </div>
      {editing ? (
        <input autoFocus value={val}
          onClick={e => e.stopPropagation()}
          onChange={e => setVal(e.target.value)}
          onBlur={() => { onRename?.(val.trim() || entry.name); setEditing(false); }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }}
          style={{ width: "100%", background: Cp.surface2, border: `1px solid ${Cp.teal}`, borderRadius: 3, color: Cp.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "1px 4px" }} />
      ) : (
        <div onDoubleClick={e => { e.stopPropagation(); setEditing(true); setVal(entry.name || ""); }}
          title="Double-click to rename"
          style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 500 }}>
          {entry.name}
        </div>
      )}
      {foreign && datasetName && (
        <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.blue, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          ⇄ {datasetName}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
        <button onClick={e => { e.stopPropagation(); onMove?.(-1); }} disabled={index === 0} title="Move left"
          style={{ background: "none", border: "none", color: index === 0 ? Cp.border : Cp.textMuted, cursor: index === 0 ? "default" : "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>◀</button>
        <button onClick={e => { e.stopPropagation(); onMove?.(1); }} disabled={index === count - 1} title="Move right"
          style={{ background: "none", border: "none", color: index === count - 1 ? Cp.border : Cp.textMuted, cursor: index === count - 1 ? "default" : "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>▶</button>
        <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
          <input type="checkbox" checked={isCompared} onChange={onCompare} style={{ accentColor: Cp.teal, cursor: "pointer", width: 10, height: 10 }} />
          <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.textMuted }}>cmp</span>
        </label>
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ marginLeft: "auto", background: "none", border: "none", color: Cp.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0 2px", lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 9: Commit**

```bash
git add src/components/PlotBuilder.jsx
git commit -m "feat(explore): project-scoped plot history + datasetId tag, rename/reorder, request-dataset on load"
```

---

## Task 6: ExplorerModule — thread projectPid, project-scope pins, pending-plot handoff

**Files:**
- Modify: `src/ExplorerModule.jsx` (signature 1847; pins effect 1883-1893; PlotBuilder usage 2081)

- [ ] **Step 1: Accept `projectPid`, `onRequestDataset`, `pendingPlot` props**

In `src/ExplorerModule.jsx` (line 1847):

```javascript
export default function ExplorerModule({cleanedData, onBack, onProceed, onSaveDataset, pid, projectPid, onRequestDataset, pendingPlot, onConsumePendingPlot}) {
```

Add a scope const after `const{C,T}=useTheme();`:

```javascript
  const histPid = projectPid ?? pid;
```

- [ ] **Step 2: Project-scope the explore pins**

In the pins load/save effects (lines 1883-1893) replace `pid` with `histPid` (4 occurrences across the two effects and `getExplorePins`/`saveExplorePins`), and update both dep arrays to `[histPid]` / `[histPid, pinnedItems]`.

- [ ] **Step 3: Pass scope + handoff into PlotBuilder**

In `src/ExplorerModule.jsx` (line 2081) change the PlotBuilder usage:

```javascript
        {tab==="plot"&&<PlotBuilder headers={headers} rows={filteredRows} pid={pid} projectPid={histPid} datasetId={pid} datasetName={filename} onRequestDataset={onRequestDataset} initialPendingPlotId={pendingPlot?.plotId ?? null} onConsumePendingPlot={onConsumePendingPlot} style={{marginTop:"0.25rem", height:"70vh", minHeight:520}}/>}
```

(Here `pid` is the dataset id for this ExplorerModule instance; `histPid` is the project id for history scope.)

- [ ] **Step 4: PlotBuilder consumes the pending plot after a dataset switch**

Back in `src/components/PlotBuilder.jsx`, add `initialPendingPlotId` + `onConsumePendingPlot` to the props (Step 1 of Task 5 signature) and a one-shot effect that opens the requested plot once history has loaded and the datasets match:

```javascript
  // After App switches datasets to honor a cross-dataset plot click, open the
  // requested plot once this dataset's history is present.
  useEffect(() => {
    if (!initialPendingPlotId || !plotHistory.length) return;
    const i = plotHistory.findIndex(e => e.id === initialPendingPlotId);
    if (i >= 0) {
      const entry = plotHistory[i];
      if (!entry.datasetId || entry.datasetId === datasetId) { loadPlotEntry(entry); setHistIdx(i); setHistOpen(true); }
      onConsumePendingPlot?.();
    }
  }, [initialPendingPlotId, plotHistory, datasetId]); // eslint-disable-line react-hooks/exhaustive-deps
```

Add `initialPendingPlotId, onConsumePendingPlot` to the destructured props list from Task 5 Step 1 (final signature):

```javascript
export default function PlotBuilder({ headers = [], rows = [], style, initialLayers = [], pid, projectPid, datasetId, onRequestDataset, initialPendingPlotId, onConsumePendingPlot, scriptPreamble, datasetName }) {
```

- [ ] **Step 5: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/ExplorerModule.jsx src/components/PlotBuilder.jsx
git commit -m "feat(explore): project-scoped pins + cross-dataset plot handoff into PlotBuilder"
```

---

## Task 7: App — projectPid + pending-plot handoff wiring

**Files:**
- Modify: `src/App.jsx` (state near 2657; ExplorerModule usage ~3013)

- [ ] **Step 1: Add pending-plot state**

In `src/App.jsx`, near `assistantPrefill` state (line ~2657) add:

```javascript
  // Cross-dataset plot click: switch the Explore dataset, then hand the target
  // plot id to the remounted ExplorerModule to open it (mirrors assistantPrefill).
  const [pendingExplorePlot, setPendingExplorePlot] = useState(null); // { datasetId, plotId }
```

- [ ] **Step 2: Wire ExplorerModule**

In `src/App.jsx`, the `<ExplorerModule …>` usage (lines 3013-3023) add the four props:

```javascript
                    ? <ExplorerModule
                        key={tabDsId("explore")}
                        pid={tabDsId("explore")}
                        projectPid={pid}
                        cleanedData={exploreCleanedData}
                        onBack={()=>navigateToTab("clean")}
                        onProceed={()=>navigateToTab("model")}
                        onRequestDataset={(dsId, plotId) => { setPendingExplorePlot({ datasetId: dsId, plotId }); selectDataset("explore", dsId, true); }}
                        pendingPlot={pendingExplorePlot?.datasetId === tabDsId("explore") ? pendingExplorePlot : null}
                        onConsumePendingPlot={() => setPendingExplorePlot(null)}
                        onSaveDataset={(name, rows, headers, recipe = null) => {
                          const newId = studioRef.current?.addApiData(name, rows, headers, recipe);
                          if (newId) selectDataset("explore", newId);
                        }}
                      />
```

- [ ] **Step 3: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(explore): App pending-plot handoff — click a foreign-dataset plot switches dataset and opens it"
```

Browser-validate (Franco): save a plot on dataset A, switch Explore to dataset B, both plots show in history; clicking A's plot switches Explore back to A and opens it.

---

## Task 8: Spatial map history — reorder controls

**Files:**
- Modify: `src/components/tabs/spatial/map/SpatialPlotTab.jsx`

- [ ] **Step 1: Locate the map-history list + persistence**

This tab persists via `getMapHistory`/`saveMapHistory` (imported at the top) and renders a `plotHistory.map(...)` list. Confirm the state setter name (likely `setMapHistory`/`setPlotHistory`) and the save call. Add a reorder helper next to the existing save logic:

```javascript
  const moveMap = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= plotHistory.length) return;
    const next = [...plotHistory];
    [next[i], next[j]] = [next[j], next[i]];
    setPlotHistory(next);
    if (pid) saveMapHistory(pid, next).catch(() => {});
  };
```

(Use whatever the actual state variable/setter and pid prop are named in this file — match them exactly. Rename already exists via the map name prompt.)

- [ ] **Step 2: Add ◀ ▶ buttons to each history row**

In the `plotHistory.map((entry, i) => (…))` row, add before the existing delete control:

```javascript
            <button onClick={e => { e.stopPropagation(); moveMap(i, -1); }} disabled={i === 0} title="Move up"
              style={{ background: "none", border: "none", color: i === 0 ? C.border : C.textMuted, cursor: i === 0 ? "default" : "pointer", fontFamily: mono, fontSize: T.caption.fontSize, padding: "0 2px" }}>▲</button>
            <button onClick={e => { e.stopPropagation(); moveMap(i, 1); }} disabled={i === plotHistory.length - 1} title="Move down"
              style={{ background: "none", border: "none", color: i === plotHistory.length - 1 ? C.border : C.textMuted, cursor: i === plotHistory.length - 1 ? "default" : "pointer", fontFamily: mono, fontSize: T.caption.fontSize, padding: "0 2px" }}>▼</button>
```

(Use the `C`/`T`/`mono` tokens already in scope in this file; if `mono` isn't imported, use `T.code.fontFamily`.)

- [ ] **Step 3: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/spatial/map/SpatialPlotTab.jsx
git commit -m "feat(spatial): reorder controls on saved map history"
```

---

## Task 9: Report — global artifact order drives the unified script

**Files:**
- Modify: `src/ReportingModule.jsx` (imports 22-25; `AIUnifiedScript` visual-section assembly 1108-1187; add an order panel)

- [ ] **Step 1: Import the ordering helpers**

In `src/ReportingModule.jsx` (near line 25) add:

```javascript
import { getArtifactOrder, saveArtifactOrder, makeArtifactId, orderArtifacts } from "./services/Persistence/artifactOrder.js";
```

- [ ] **Step 2: Build a unified ordered artifact list before emitting sections**

In `AIUnifiedScript`'s script-generation function, where `savedPlots`, `savedMaps`, and the model list are assembled (lines ~1133-1164 / 1004), build a combined list tagged with `artifactId`, then sort by the persisted order. Replace the separate `savedPlots.map(...)` / `savedMaps.map(...)` emission with an ordered single pass:

```javascript
        const order = await getArtifactOrder(pid).catch(() => []);
        const plotArts = (savedPlots ?? []).map(e => ({ kind: "plot", artifactId: makeArtifactId("plot", e.id), savedAt: e.savedAt ?? 0, entry: e }));
        const mapArts  = (savedMaps  ?? []).map(e => ({ kind: "map",  artifactId: makeArtifactId("map",  e.id), savedAt: e.savedAt ?? 0, entry: e }));
        const modelArts = [result, ...pinnedModels].filter(Boolean)
          .map(m => ({ kind: "model", artifactId: makeArtifactId("model", m.id), savedAt: 0, entry: m }));
        const visualArts = orderArtifacts([...plotArts, ...mapArts], order);
        const orderedVisualCode = visualArts.map(a => {
          if (a.kind === "plot") {
            const entryDf = idToVar(a.entry._srcId ?? a.entry.datasetId) ?? plotDfVar;
            const code = lang === "python" ? buildMatplotlibPlot(a.entry, { dfVar: entryDf })
                       : lang === "stata"  ? buildStataPlot(a.entry, { dataVar: entryDf })
                       :                     buildGgplot(a.entry, { dfVar: entryDf });
            return code ? `${comment} Plot: ${a.entry.name ?? "untitled"}\n${code}` : null;
          }
          // map
          let code;
          if (lang === "python") code = buildFoliumPy(a.entry, { datasets: availableDatasets });
          else if (lang === "stata") code = `${comment} Map "${a.entry.name ?? ""}" — Stata has no leaflet; reproduce in R (leaflet) or Python (folium)`;
          else code = buildLeafletR(a.entry, { datasets: availableDatasets });
          return code ? `${comment} Map: ${a.entry.name ?? "untitled"}\n${code}` : null;
        }).filter(Boolean).join("\n\n");
        if (orderedVisualCode) {
          visualSections += `\n\n${comment} ── Saved visuals (in your chosen order) ─────────────\n${orderedVisualCode}`;
        }
```

Delete the old separate `plotCode`/`mapCode` blocks (lines ~1136-1164) that this replaces. Keep the `dedupeHistory`, `savedPlots`, `savedMaps`, `histPids` setup above it unchanged.

- [ ] **Step 3: Add a collapsible "Saved Artifacts order" panel in the Report UI**

In `ReportingModule`'s render (near the existing model-replication-scope controls, line ~1303), add a panel listing the combined artifacts with ▲▼ buttons that update `artifactOrder_<pid>`. Load the artifact list with a small effect (reuse `histPids` = `[pid, ...availableDatasets.map(d=>d.id)]`, fetch plot+map histories, plus `[result, ...pinnedModels]`), hold `{artifactId, label, kind}` in state, and persist on reorder:

```javascript
  const [artOrder, setArtOrder] = useState([]);
  const [artList, setArtList] = useState([]); // [{artifactId, label, kind}]
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hp = Array.from(new Set([pid, ...availableDatasets.map(d => d.id)].filter(Boolean)));
      const plots = (await Promise.all(hp.map(p => getPlotHistory(p).catch(() => [])))).flat();
      const maps  = (await Promise.all(hp.map(p => getMapHistory(p).catch(() => [])))).flat();
      const seen = new Set();
      const items = [];
      for (const e of plots) { const k = makeArtifactId("plot", e.id); if (!seen.has(k)) { seen.add(k); items.push({ artifactId: k, label: e.name ?? "plot", kind: "plot", savedAt: e.savedAt ?? 0 }); } }
      for (const e of maps)  { const k = makeArtifactId("map",  e.id); if (!seen.has(k)) { seen.add(k); items.push({ artifactId: k, label: e.name ?? "map",  kind: "map",  savedAt: e.savedAt ?? 0 }); } }
      for (const m of [result, ...pinnedModels].filter(Boolean)) { const k = makeArtifactId("model", m.id); if (!seen.has(k)) { seen.add(k); items.push({ artifactId: k, label: m.label ?? m.type ?? "model", kind: "model", savedAt: 0 }); } }
      const ord = await getArtifactOrder(pid).catch(() => []);
      if (!cancelled) { setArtList(orderArtifacts(items, ord)); setArtOrder(ord); }
    })();
    return () => { cancelled = true; };
  }, [pid, availableDatasets, result, pinnedModels]);

  const moveArt = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= artList.length) return;
    const next = [...artList];
    [next[i], next[j]] = [next[j], next[i]];
    setArtList(next);
    const ord = next.map(a => a.artifactId);
    setArtOrder(ord);
    if (pid) saveArtifactOrder(pid, ord).catch(() => {});
  };
```

Render block (place inside the Report panel JSX, using `C`/`T` tokens):

```javascript
        {artList.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: "1rem" }}>
            <div style={{ padding: "0.45rem 0.75rem", borderBottom: `1px solid ${C.border}`, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Saved artifacts — script order
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {artList.map((a, i) => (
                <div key={a.artifactId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.3rem 0.75rem", borderBottom: i < artList.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ width: 44, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: a.kind === "model" ? C.gold : a.kind === "map" ? C.blue : C.teal }}>{a.kind}</span>
                  <span style={{ flex: 1, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{a.label}</span>
                  <button onClick={() => moveArt(i, -1)} disabled={i === 0} style={{ background: "none", border: "none", color: i === 0 ? C.border : C.textMuted, cursor: i === 0 ? "default" : "pointer", fontSize: T.code.fontSize }}>▲</button>
                  <button onClick={() => moveArt(i, 1)} disabled={i === artList.length - 1} style={{ background: "none", border: "none", color: i === artList.length - 1 ? C.border : C.textMuted, cursor: i === artList.length - 1 ? "default" : "pointer", fontSize: T.code.fontSize }}>▼</button>
                </div>
              ))}
            </div>
          </div>
        )}
```

(`useState`/`useEffect` are already imported in `ReportingModule.jsx`. Confirm `getPlotHistory`/`getMapHistory` are imported — they are, line 25.)

- [ ] **Step 4: lint + build**

Run: `npm run lint:undef` then `npm run build` — both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/ReportingModule.jsx
git commit -m "feat(report): global artifact-order panel drives unified-script visual/model order"
```

Browser-validate (Franco): in Report, reorder the saved-artifacts list; generate the R/Python/Stata script; confirm plots and maps appear in the chosen order with the correct per-dataset `df_<name>` binding, and that the model section binds to its source dataset.

---

## Task 10: Update CLAUDE.md structure + ClaudePlan status

**Files:**
- Modify: `CLAUDE.md` (file-structure section — add `artifactOrder.js`)
- Modify: `ClaudePlan.md` (index row status)

- [ ] **Step 1: Add artifactOrder.js to the CLAUDE.md Persistence list**

Under `services/Persistence/` in CLAUDE.md, add a line:

```
│   ├── artifactOrder.js          ← project-scoped global order across saved plots/maps/models (getArtifactOrder/saveArtifactOrder + makeArtifactId/parseArtifactId/orderArtifacts)
```

- [ ] **Step 2: Flip the ClaudePlan index row to DONE (verify)**

In `ClaudePlan.md`, change the 2026-06-16 row status from `OPEN` to `IMPLEMENTATION COMPLETE — browser validation pending Franco`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md ClaudePlan.md
git commit -m "docs: register artifactOrder.js + mark unified-artifact-registry implementation complete"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** Part 1 → Task 3. Part 2 (project-scope plots) → Tasks 5-7; models datasetId → Tasks 2,4. Part 3 rename → Tasks 4,5,8; click-to-switch → Tasks 4 (model), 5-7 (plot). Part 4 ordering → Tasks 1,9. Translation/aggregation already existed — Task 9 reuses the existing `buildGgplot`/`buildMatplotlibPlot`/`buildStataPlot`/`buildLeafletR`/`buildFoliumPy` calls, only re-ordering them.
- **Type consistency:** namespaced ids via `makeArtifactId(kind, id)` everywhere (`plot:`/`map:`/`model:`); `datasetId` tag name identical across trimResult, model results, and plot entries; `histPid` is the consistent project-scope variable in PlotBuilder + ExplorerModule.
- **Out of scope (unchanged):** ModelingTab-embedded PlotBuilder history, Stata Leaflet output, the spatial geo-plot tab's own history (only the Leaflet map tab gets reorder per the user's "maps" ask — extend later if needed).
