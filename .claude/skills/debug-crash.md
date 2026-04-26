---
name: Debug Crash
description: Diagnose and fix black screen, white screen, silent crashes, and React render failures in EconSolver. Use this skill immediately when the user reports a blank screen, the app stops rendering, a tab goes white, the UI freezes, or estimation silently fails without an error message.
---

## Debug Crash — EconSolver

### Known crash patterns (check in this order)

**1. React hooks in conditionals — BLACK SCREEN**
Symptom: Specific estimator tab goes black; others work fine.
Root cause: `useState`/`useEffect`/`useCallback` inside an `if`, ternary, or IIFE.
Where to look: `ModelingTab.jsx`, `ModelComparison.jsx`, result sub-components (`GMMResults`, `LIMLResults`, etc.)
Fix: Move hook to component top level unconditionally. Use the returned value conditionally.
```js
// ILLEGAL — caused 2SLS black screen
if (condition) { const [x, setX] = useState(0); }
// CORRECT
const [x, setX] = useState(0);
if (condition) { /* use x */ }
```

**2. wrapResult() returning incomplete shape — BLANK RESULTS PANEL**
Symptom: Estimation "succeeds" (no error toast) but results panel is blank or partially rendered.
Root cause: Engine output field not mapped in the `wrapXxx()` function, leaving canonical fields undefined.
Where to look: `src/math/EstimationResult.js` → the specific `wrapXxx()` for the failing estimator.
Check: `console.log(result)` after `setResult()` in estimate(). All must be non-null: `varNames[]`, `beta[]`, `se[]`, `testStats[]`, `pVals[]`, `resid[]`, `Yhat[]`.
Fix: Add null-coalescing in wrapper: `varNames: out.coefNames ?? out.varNames ?? []`.

**3. estimate() unhandled exception — FROZEN SPINNER / NO RESULT**
Symptom: Click "Estimate" → spinner never stops, or UI freezes.
Root cause: Exception thrown inside the try block but `setRunning(false)` not reached.
Where to look: `ModelingTab.jsx` lines ~990–1090. The outer catch calls `setErr` + `setRunning(false)`, but early `return` paths must also call `setRunning(false)`.
Fix: Wrap in `try/catch/finally` — put `setRunning(false)` in `finally`, not just in catch.

**4. Project state bleed — WRONG DATA / BLANK ON PROJECT SWITCH**
Symptom: Switching projects loads stale data or DataStudio renders empty.
Root cause: `pid` undefined or not used as React key.
Where to look: `App.jsx` → pid prop generation. `DataStudio.jsx` line ~370.
Rules:
- `pid` must always be a non-empty string before passing to `<DataStudio key={pid}>`.
- Secondary datasets in sessionStorage are keyed as `"econ_studio_secondary_ds_" + pid` — if pid is undefined, all projects share the same slot.
- `primaryId = pid || genId()` in DataStudio is a safety net, not the canonical solution.

**5. Registry/runner desync — PIPELINE STEP SILENT FAILURE**
Symptom: A wrangling step appears in the pipeline but applying it does nothing or throws.
Root cause: Step added to `registry.js` STEP_REGISTRY but missing from `runner.js` applyStep switch.
Fix: Both files must be patched in the same commit. Every STEP_REGISTRY key needs a matching runner.js case.

**6. SheetJS CDN failure — EXCEL UPLOAD CRASH**
Symptom: XLSX/XLS upload silently returns null; no parse error shown.
Root cause: CDN unreachable or URL changed.
Where to look: `DataStudio.jsx` line ~102, `services/data/parsers/excel.js`.
Check: DevTools Network tab on file upload. CDN must be exactly: `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs`

**7. IndexedDB failure — APP OPENS BLANK**
Symptom: Project opens with no data, no error.
Where to look: `services/persistence/indexedDB.js` → `loadPipeline`, `saveRawData`, `migrateFromLocalStorage`.
Check: DevTools → Application → IndexedDB → verify data exists for this pid.

**8. LocalAI import error — WRANGLING TAB CRASH**
Symptom: Dictionary/Clean/DataQuality sections crash on open.
Root cause: `services/ai/LocalAI.js` exports (`normalizeStrings`, `detectPII`, `inferMissingStrategy`, `scoreOutliers`, `suggestColumnType`) imported from wrong path.
Rule: LocalAI.js is NOT re-exported from `services/privacy/index.js` — those are separate implementations with different signatures.

**9. PII dual-system confusion — WRONG DATA SENT TO AI**
Two PII systems exist. Never mix them:
- `services/privacy/piiDetector.js` → `detectPII(headers, sampleRows)` → `{ sensitivity, reasons }` per column. For egress filtering before AI calls.
- `services/ai/LocalAI.js` → `detectPII(rows, headers)` → `PIIFlag[]`. For wrangling UI hints only.

**10. Stata parser crash — .dta UPLOAD FREEZE**
Where to look: `DataStudio.jsx` line ~147 — `import("./services/data/parsers/stata.js")`. Dynamic import failure shows as silent null return.
Check: Network tab for `stata.js` chunk load failure.

### Debug workflow

1. `get_minimal_context(task="crash in <area>")` — always first.
2. DevTools Console → find the **first** red error, not cascading ones.
3. Classify: estimator-specific? project-specific? dataset-specific? file-format-specific?
4. `query_graph pattern="callers_of" node="<crashed function>"`.
5. `detect_changes` — if crash is recent.

### Fix conventions
- Hooks in conditionals → top level, use value conditionally.
- Frozen spinner → `finally { setRunning(false); }`.
- Shape mismatch → null-safe reads in render + fix wrapXxx() wrapper.
- Surgical `str_replace` only.

### Token efficiency
- Modeling crash → don't read `WranglingModule.jsx`.
- Wrangling crash → don't read `ModelingTab.jsx`.
- Plot crash only → read `ModelPlots.jsx` or `ResidualPlots.jsx`, not the full orchestrator.
- Target: root cause in ≤ 4 tool calls.
