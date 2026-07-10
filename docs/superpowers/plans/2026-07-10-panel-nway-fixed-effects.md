# N-Way Panel Fixed Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users declare an arbitrary list of fixed-effect columns (not just a hardcoded entity + time pair) for FE, TWFE, LSDV, and Event Study, including a crossed/interacted FE group (e.g. `state × year`), matching what `fixest::feols(y ~ x | f1 + f2 + f3)` / Stata `reghdfe` support.

**Architecture:** Generalize the panel declaration from `{entityCol, timeCol}` to `{feCols: string[], entityCol, timeCol}` (entity/time kept as `feCols[0]`/`feCols[1]` for backward compatibility with every existing consumer). Add a new shared demeaning module (`PanelWithinEngine.js`) implementing weighted alternating-projection demeaning for D ≥ 1 FE dimensions — the same Gaure(2013)/Correia(2017) method already proven in `NonLinearEngine.js`'s `runPoissonFEMulti` (`demeanW`, lines 827-855), generalized to the unweighted OLS case. Rewrite `PanelEngine.js`'s FE/FD/TWFE/EventStudy/LSDV to call into it with `feCols: string[]` instead of positional `unitCol, timeCol`. FE interactions materialize a composite key column (`f1×f2` value-pair string) that becomes one more entry in `feCols` — no new math, just a new column.

**Tech Stack:** Plain JS (`src/math/`, `src/core/`), React (`src/components/`), DuckDB-Wasm SQL (`src/services/data/`). No new dependencies.

---

## Important context for whoever executes this plan

You have **zero prior context** on this codebase. Read this section fully before touching any file.

- **Non-destructive pipeline invariant**: nothing in this plan touches `rawData` or `runner.js`. FE interaction columns are computed **inside the estimator call**, never written back to the dataset.
- **Zero React in math files**: `src/math/*.js` and `src/core/*.js` must never import React or JSX.
- **SE type is always explicit**: every engine function takes `seOpts` — never infer SE type internally.
- **Math validation invariant** (CLAUDE.md): any change to `src/math/*.js` must be validated against R to 6 decimal places on coefficients, 4 on SE, before being called "done". Task 8 covers this — **do not skip it**, and do not mark this feature complete in `ClaudePlan.md` until Franco has run the R fixtures.
- **Backward compatibility is mandatory**: dozens of existing call sites across `ModelingTab.jsx`, `ModelConfiguration.jsx`, `src/components/modeling/runners/estimationDispatch.js`, `PanelResults.jsx`, and `src/services/export/*.js` read `panel.entityCol` / `panel.timeCol` directly. This plan does NOT rewrite all of them — it makes the new `feCols` list the source of truth while keeping `entityCol`/`timeCol` as computed aliases (`feCols[0]`/`feCols[1]`) so every untouched call site keeps working exactly as before. Only the FE/TWFE/LSDV/EventStudy estimation call sites (Task 5) are rewired to pass `feCols` instead of the pair.
- **Existing engine functions must not break**: `runFE`, `runFD`, `runTWFEDiD`, `runEventStudy`, `runLSDV` keep their current exported names and 2-arg (`unitCol, timeCol`) signatures as thin wrappers — internally they now delegate to the new `*Multi` functions with `feCols = [unitCol, timeCol].filter(Boolean)`. This means every existing caller that isn't touched by this plan keeps working unmodified.

---

## Task 1: Generalized within-transform engine (`PanelWithinEngine.js`)

**Files:**
- Create: `src/math/PanelWithinEngine.js`
- Test: `src/math/__validation__/panelWithinEngineValidation.js`

This is the core primitive: demean an arbitrary set of numeric columns by D ≥ 1 fixed-effect groupings, using unweighted alternating projections (the OLS special case of `demeanW` in `NonLinearEngine.js:827-855`, which uses IRLS weights — here every weight is 1).

- [ ] **Step 1: Write the engine file**

```js
// ─── ECON STUDIO · src/math/PanelWithinEngine.js ──────────────────────────────
// Generalized N-way fixed-effect demeaning (Gaure 2013 / Correia 2017 method of
// alternating projections). Same algorithm as NonLinearEngine.js's runPoissonFEMulti
// demeanW() helper, specialized to the unweighted OLS case (W ≡ 1) and exposed as
// a standalone, reusable primitive for PanelEngine.js.
//
// For D=1 this is the classical single-pass "within" transform (subtract group
// means). For D≥2 it iterates: demean by dim 0, then dim 1, ... back to dim 0,
// until every dimension's residual group-means fall below `tol` (Gaure 2013
// proves this converges to the exact projection onto the joint FE column space,
// so a plain OLS on the residual is exact FWL — no FE dummies ever materialized).

/**
 * @param {object[]} rows - filtered rows (all feCols + all valueCols present, numeric valueCols)
 * @param {string[]} feCols - fixed-effect column names, length ≥ 1 (already includes any
 *   materialized interaction columns — see feInteraction.js)
 * @param {string[]} valueCols - numeric columns to demean (y and all x's together, so the
 *   same group means / FWL logic in a single pass)
 * @param {object} [opts]
 * @param {number} [opts.tol=1e-10] - convergence tolerance on max abs group mean
 * @param {number} [opts.maxIter=5000] - max alternating passes for D≥2
 * @returns {{ demeaned: object[], nLevels: number[], grandMeans: Record<string, number> }}
 *   demeaned rows carry `__dm_<col>` for every valueCol, RE-CENTERED at the grand mean
 *   (so an OLS with intercept on the demeaned columns recovers the correct β, matching
 *   the existing PanelEngine.js convention of "subtract group mean, add back grand mean").
 */
export function demeanByFE(rows, feCols, valueCols, opts = {}) {
  const { tol = 1e-10, maxIter = 5000 } = opts;
  const D = feCols.length;
  const n = rows.length;
  if (D < 1) throw new Error("demeanByFE requires at least one fixed-effect column.");

  // Grand means — used to re-center after demeaning (preserves the OLS intercept,
  // matching PanelEngine.js's existing `d[col] = r[col] - unitMean + grandMean` convention).
  const grandMeans = {};
  valueCols.forEach(c => {
    grandMeans[c] = rows.reduce((s, r) => s + r[c], 0) / n;
  });

  // Map each FE dimension's levels to a dense integer index (0..L-1).
  const levelIdx = [];
  const nLevels = [];
  for (let d = 0; d < D; d++) {
    const map = new Map();
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const lv = rows[i][feCols[d]];
      let li = map.get(lv);
      if (li === undefined) { li = map.size; map.set(lv, li); }
      idx[i] = li;
    }
    levelIdx.push(idx);
    nLevels.push(map.size);
  }

  // Working matrix: n × m, m = valueCols.length. Start from raw values.
  const m = valueCols.length;
  const M = rows.map(r => valueCols.map(c => r[c]));

  const passOnce = () => {
    let maxMean = 0;
    for (let d = 0; d < D; d++) {
      const idx = levelIdx[d], L = nLevels[d];
      const csum = new Float64Array(L);
      const xsum = Array.from({ length: L }, () => new Float64Array(m));
      for (let i = 0; i < n; i++) {
        const li = idx[i];
        csum[li] += 1;
        const row = M[i];
        for (let j = 0; j < m; j++) xsum[li][j] += row[j];
      }
      for (let i = 0; i < n; i++) {
        const li = idx[i], cnt = csum[li];
        const row = M[i];
        for (let j = 0; j < m; j++) {
          const mean = xsum[li][j] / cnt;
          if (Math.abs(mean) > maxMean) maxMean = Math.abs(mean);
          row[j] -= mean;
        }
      }
    }
    return maxMean;
  };

  if (D === 1) passOnce();
  else {
    for (let it = 0; it < maxIter; it++) if (passOnce() < tol) break;
  }

  const demeaned = rows.map((r, i) => {
    const d = { ...r };
    valueCols.forEach((c, j) => { d[`__dm_${c}`] = M[i][j] + grandMeans[c]; });
    return d;
  });

  return { demeaned, nLevels, grandMeans };
}

/**
 * Degrees of freedom used by the FE fit: n - kReg - (sum of FE level counts
 * across dimensions, each minus 1 to avoid double-counting the intercept
 * absorbed by the first dimension) - 1 for the intercept itself.
 *
 * NOTE: this is the standard *additive* (non-collinear) FE dof count used by
 * fixest/reghdfe for FE structures with no exact nesting between dimensions.
 * If two FE dimensions are perfectly nested (e.g. "country" and "country×year"
 * both present), this OVERCOUNTS absorbed parameters and understates df. This
 * codebase does not yet implement fixest's rank-based FE dof correction — flag
 * this explicitly to Franco during Task 8's R validation: run at least one
 * fixture with two independent (non-nested) FE dims and one with a nested pair,
 * and confirm whether the simple formula below matches fixest's `nobs - fitstat`
 * degrees of freedom for both cases.
 */
export function feDegreesOfFreedom(n, kReg, nLevels) {
  const absorbed = nLevels.reduce((s, L, d) => s + (d === 0 ? L - 1 : L - 1), 0) + 1; // +1 grand intercept
  return n - kReg - absorbed;
}
```

- [ ] **Step 2: Write the validation harness (structural, not yet R-compared)**

```js
// src/math/__validation__/panelWithinEngineValidation.js
// Structural checks for demeanByFE — run with: node src/math/__validation__/panelWithinEngineValidation.js
import { demeanByFE, feDegreesOfFreedom } from "../PanelWithinEngine.js";

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`  ok — ${msg}`); }

// Fixture: 3 units × 4 periods, balanced, y = 2 + unit_effect + time_effect + noise
const rows = [];
const unitFx = { A: 0, B: 5, C: -3 };
const timeFx = { 1: 0, 2: 1, 3: 2, 4: 3 };
for (const u of ["A", "B", "C"]) {
  for (const t of [1, 2, 3, 4]) {
    rows.push({ unit: u, time: t, y: 2 + unitFx[u] + timeFx[t], x: t + (u === "A" ? 0 : u === "B" ? 1 : 2) });
  }
}

console.log("Test 1: D=1 (unit only) — after demeaning, __dm_y should have zero within-unit variance in the FE-only part");
const r1 = demeanByFE(rows, ["unit"], ["y", "x"]);
const grand = r1.grandMeans.y;
assert(Math.abs(grand - rows.reduce((s, r) => s + r.y, 0) / rows.length) < 1e-9, "grand mean matches raw mean");

console.log("Test 2: D=2 (unit + time) converges — group means of the demeaned column within each dim ≈ 0 (up to re-centering)");
const r2 = demeanByFE(rows, ["unit", "time"], ["y", "x"]);
for (const u of ["A", "B", "C"]) {
  const sub = r2.demeaned.filter(r => r.unit === u);
  const mean = sub.reduce((s, r) => s + r.__dm_y, 0) / sub.length;
  assert(Math.abs(mean - r2.grandMeans.y) < 1e-6, `unit ${u} demeaned group mean ≈ grand mean`);
}

console.log("Test 3: feDegreesOfFreedom matches n - kReg - (nUnits-1) - (nTimes-1) - 1 for the 2-way case");
const df = feDegreesOfFreedom(12, 1, [3, 4]);
assert(df === 12 - 1 - 2 - 3 - 1, `df = ${df} matches hand calc`);

console.log("\nAll structural checks passed. R comparison still required (Task 8) before calling this validated.");
```

- [ ] **Step 3: Run the validation harness**

Run: `node src/math/__validation__/panelWithinEngineValidation.js`
Expected: all three `ok —` lines print, no `FAIL:` thrown.

- [ ] **Step 4: Commit**

```bash
git add src/math/PanelWithinEngine.js src/math/__validation__/panelWithinEngineValidation.js
git commit -m "Add generalized N-way FE demeaning engine (PanelWithinEngine.js)"
```

---

## Task 2: FE interaction column materialization

**Files:**
- Create: `src/core/generate/feInteraction.js`

A "crossed" FE group (e.g. `state × year`) is just one more entry in `feCols` whose value is the pairwise combination of the two source columns' values. Materializing it is a pure, local computation — never written back to `rawData`.

- [ ] **Step 1: Write the helper**

```js
// ─── ECON STUDIO · src/core/generate/feInteraction.js ─────────────────────────
// Materializes a composite fixed-effect group from 2+ source columns, e.g.
// state × year → one combined FE dimension with a distinct level per
// (state, year) pair. Used only inside estimator calls — never written to
// rawData or injected as a pipeline step (spatial-filter-style local scope).

/**
 * @param {object[]} rows
 * @param {string[]} sourceCols - 2+ column names to cross
 * @param {string} [outCol] - name for the materialized column; defaults to
 *   sourceCols joined with "×"
 * @returns {{ rows: object[], outCol: string }} new rows array (shallow-copied
 *   objects) with `outCol` added; original rows/columns untouched
 */
export function materializeFEInteraction(rows, sourceCols, outCol) {
  if (sourceCols.length < 2) throw new Error("materializeFEInteraction requires at least 2 source columns.");
  const name = outCol || sourceCols.join("×");
  const withInteraction = rows.map(r => ({
    ...r,
    [name]: sourceCols.map(c => String(r[c] ?? " NA")).join(""),
  }));
  return { rows: withInteraction, outCol: name };
}
```

- [ ] **Step 2: Write a quick structural check**

```js
// Run inline with node --input-type=module:
// import { materializeFEInteraction } from "./src/core/generate/feInteraction.js";
// const { rows, outCol } = materializeFEInteraction(
//   [{ state: "CA", year: 2020 }, { state: "CA", year: 2021 }, { state: "NY", year: 2020 }],
//   ["state", "year"]
// );
// console.log(outCol, rows.map(r => r[outCol]));
// Expected: 3 distinct level strings, CA-2020 and CA-2021 are DIFFERENT levels (not collapsed to "CA").
```

Run this snippet with `node --input-type=module -e "..."` and confirm the three printed level strings are pairwise distinct.

- [ ] **Step 3: Commit**

```bash
git add src/core/generate/feInteraction.js
git commit -m "Add FE interaction column materialization helper"
```

---

## Task 3: Generalize panel declaration shape (`PanelTab.jsx` + `validator.js`)

**Files:**
- Modify: `src/pipeline/validator.js` (`validatePanel`, currently line 23: `export function validatePanel(rows, ec, tc)`)
- Modify: `src/components/wrangling/PanelTab.jsx` (currently single entity/time button-pickers, lines 30, 46, 54-61)

The panel object gains a `feCols: string[]` array. `entityCol`/`timeCol` remain as `feCols[0]`/`feCols[1]` so every existing consumer (`ModelingTab.jsx`, `estimationDispatch.js`, etc., per the architecture note above) keeps working without modification.

- [ ] **Step 1: Extend `validatePanel` to accept an optional `feCols` list, defaulting to `[ec, tc]`**

In `src/pipeline/validator.js`, find `export function validatePanel(rows, ec, tc)` and change its signature to accept a third optional arg without breaking the two existing required params:

```js
// BEFORE (line 23):
export function validatePanel(rows, ec, tc) {

// AFTER:
export function validatePanel(rows, ec, tc, extraFeCols = []) {
  // extraFeCols: additional FE dimensions beyond entity/time (e.g. ["industry"]
  // or a materialized interaction column name). Diagnostics (balance/attrition/
  // heatmap) still key on (ec, tc) only — extra dims don't have a 2D heatmap
  // representation, so they're validated separately below.
```

At the end of the existing function body (before its final `return {...}`), add level-count diagnostics for the extra columns:

```js
  const extraLevelCounts = extraFeCols.map(col => ({
    col,
    levels: new Set(rows.map(r => r[col]).filter(v => v != null)).size,
  }));
```

and add `extraLevelCounts` to the returned object (append to the existing return statement's object literal, do not remove any existing field).

- [ ] **Step 2: Add a multi-select "extra FE dimensions" picker in `PanelTab.jsx`**

The existing UI (lines 53-62) renders two hardcoded columns ("Entity ID (i)", "Time ID (t)") as single-select button groups. Add a third section directly after that `<div>` block (after line 62's closing `)}`) for additional FE dimensions, reusing the multi-select toggle pattern already used elsewhere in this file (`toggle(col, setter, vals)`, line 44):

```jsx
      <div style={{marginBottom:"1.2rem"}}>
        <Lbl color={C.teal}>Additional FE dimensions (optional)</Lbl>
        <div style={{fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 6}}>
          Absorbed as extra fixed effects in FE/TWFE/LSDV (e.g. industry, region). Not part of the entity×time panel index used for balance diagnostics.
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {headers.filter(h => h !== ec && h !== tc).map(h =>
            colBtn(h, extraFe.includes(h), C.teal, () => toggle(h, setExtraFe, extraFe))
          )}
        </div>
      </div>
      <div style={{marginBottom:"1.2rem"}}>
        <Lbl color={C.gold}>FE interaction (optional)</Lbl>
        <div style={{fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 6}}>
          Cross two columns into one combined fixed effect (e.g. state × year). Pick exactly two.
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {headers.map(h =>
            colBtn(h, interactionCols.includes(h), C.gold, () => {
              if (interactionCols.includes(h)) setInteractionCols(interactionCols.filter(c => c !== h));
              else if (interactionCols.length < 2) setInteractionCols([...interactionCols, h]);
            })
          )}
        </div>
        {interactionCols.length === 2 && (
          <div style={{fontSize: T.caption.fontSize, color: C.gold, marginTop: 4}}>
            Will absorb {interactionCols.join(" × ")} as one combined FE group.
          </div>
        )}
      </div>
```

Add the corresponding state right after the existing `useState` calls (line 30-34):

```jsx
  const [extraFe, setExtraFe] = useState(panel?.feCols?.slice(2) ?? []);
  const [interactionCols, setInteractionCols] = useState(panel?.interactionCols ?? []);
```

- [ ] **Step 3: Commit the declared panel shape from `PanelTab.jsx`**

Find where `PanelTab.jsx` currently calls `setPanel` — search this file for `setPanel(` (it's called wherever the entity/time selection is committed; if there is no explicit "Declare Panel" button and `setPanel` is called reactively via a `useEffect` on `[ec, tc]`, locate that effect). Replace the committed object so it includes `feCols` and `interactionCols`, computed as:

```js
const feCols = [ec, tc, ...extraFe].filter(Boolean);
setPanel({ entityCol: ec, timeCol: tc, feCols, interactionCols, validation: v });
```

`entityCol`/`timeCol` are kept verbatim so nothing downstream breaks; `feCols` is the new authoritative list consumed by Task 5's rewired estimation calls.

- [ ] **Step 4: Manually verify**

Since this is a UI change, there is no automated test here — run `npm run build` to confirm no syntax errors, and note in your task summary that Franco needs to browser-verify: open Clean → Panel tab, declare entity+time, toggle 1-2 extra FE columns, pick 2 columns for an interaction, and confirm the panel diagnostics section still renders (it must be unaffected since `validatePanel`'s first 3 params are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/validator.js src/components/wrangling/PanelTab.jsx
git commit -m "Generalize panel declaration to feCols[] + optional FE interaction"
```

---

## Task 4: Generalize `PanelEngine.js` (FE, FD, TWFE-DiD, EventStudy, LSDV)

**Files:**
- Modify: `src/math/PanelEngine.js`

Add new `*Multi` functions that take `feCols: string[]` and use `demeanByFE`/`feDegreesOfFreedom` from Task 1. Keep the existing exported names (`runFE`, `runFD`, `runTWFEDiD`, `runEventStudy`, `runLSDV`) as thin backward-compatible wrappers.

- [ ] **Step 1: Add the import**

At the top of `src/math/PanelEngine.js` (after the existing imports, line 9):

```js
import { demeanByFE, feDegreesOfFreedom } from "./PanelWithinEngine.js";
```

- [ ] **Step 2: Add `runFEMulti` and rewrite `runFE` as a wrapper**

Replace the body of `runFE` (lines 35-130) with a new generalized function plus a thin wrapper. The new function takes `feCols` instead of `unitCol, timeCol`:

```js
// ─── FIXED EFFECTS (WITHIN), N-WAY ───────────────────────────────────────────
// feCols: array of FE column names, length ≥ 1 (e.g. ["state"] or ["state","year"]
// or ["state","year","industry"] or an interaction-materialized column name).
export function runFEMulti(rows, yCol, xCols, feCols, seOpts = {}) {
  const D = feCols.length;
  if (D < 1) return { error: "Fixed Effects estimation requires at least one FE column." };

  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    feCols.every(c => r[c] != null) &&
    xCols.every(x => typeof r[x] === "number" && isFinite(r[x]))
  );
  const nLevelsCheck = feCols.map(c => new Set(valid.map(r => r[c])).size);
  if (valid.length < xCols.length + 3 || nLevelsCheck[0] < 2)
    return { error: "Insufficient observations or units for Fixed Effects estimation." };

  const allCols = [yCol, ...xCols];
  const { demeaned, nLevels } = demeanByFE(valid, feCols, allCols);

  const dmY = `__dm_${yCol}`;
  const dmX = xCols.map(c => `__dm_${c}`);
  const res = runOLS(demeaned, dmY, dmX);
  if (!res) return { error: "Within-group OLS failed — singular matrix after demeaning." };

  const df_fe = feDegreesOfFreedom(valid.length, xCols.length, nLevels);
  if (df_fe <= 0)
    return { error: "Degrees of freedom ≤ 0 after demeaning — add more observations, fewer FE dimensions, or reduce regressors." };

  const s2_fe = res.SSR / df_fe;
  const Xmat  = demeaned.map(r => [1, ...dmX.map(x => r[x])]);
  const Xt    = transpose(Xmat);
  const XtXinv = matInv(matMul(Xt, Xmat));
  const rawSE  = XtXinv
    ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe)))
    : res.se;
  const robustSe = XtXinv ? computeRobustSE(seOpts, XtXinv, Xmat, res.resid, valid.length, xCols.length + 1, demeaned) : null;
  const corrSE = (robustSe ?? rawSE).map(v => (isFinite(v) ? v : NaN));
  const corrT  = res.beta.map((b, i) => (isFinite(corrSE[i]) ? b / corrSE[i] : NaN));
  const corrP  = corrT.map(t => (isFinite(t) ? pValue(t, df_fe) : NaN));

  const dmYvals = demeaned.map(r => r[dmY]);
  const dmYmean = dmYvals.reduce((a, b) => a + b, 0) / dmYvals.length;
  const SST_w   = dmYvals.reduce((s, v) => s + (v - dmYmean) ** 2, 0);
  const R2_within = 1 - res.SSR / SST_w;

  return {
    beta:     res.beta.slice(1),
    se:       corrSE.slice(1),
    tStats:   corrT.slice(1),
    pVals:    corrP.slice(1),
    varNames: xCols,
    R2_within,
    n:    valid.length,
    feCols,
    nLevels,          // level count per FE dimension, in feCols order
    df:   df_fe,
    SSR:  res.SSR,
    s2:   s2_fe,
    resid: res.resid,
    Yhat:  res.Yhat,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
  };
}

// Backward-compatible 2-arg wrapper — every existing caller keeps working.
export function runFE(rows, yCol, xCols, unitCol, timeCol, seOpts = {}) {
  const feCols = [unitCol, timeCol].filter(Boolean);
  const out = runFEMulti(rows, yCol, xCols, feCols.length ? [feCols[0]] : [], seOpts);
  // Legacy shape compatibility: old runFE returned R2_between, units, alphas —
  // keep those fields for any caller reading them (ModelPlots.jsx, ModelingTab.jsx
  // FE result display). Recompute the two cheap ones; alphas/R2_between are
  // display-only extras, not used by SE/inference, so approximate via unitCol only.
  if (out.error) return out;
  const units = [...new Set(rows.map(r => r[unitCol]))].filter(u => u != null);
  return { ...out, units: units.length };
}
```

**IMPORTANT — before finalizing this step**, grep the codebase for every read of `result.alphas` and `result.R2_between` on an FE result (search `ModelPlots.jsx`, `ModelingTab.jsx`, `DiagnosticsPanel.jsx` for `.alphas` and `.R2_between`). If either is actually read and rendered, port the exact computation from the current `runFE` (this plan's diff, lines showing `alphas` and `bRes`/`R2_between` in the "before" version above) into the wrapper rather than dropping it silently — this plan intentionally does not guess whether the UI depends on those fields, so verify before deleting them.

- [ ] **Step 3: Apply the identical pattern to `runFD`, `runTWFEDiD`, `runEventStudy`, `runLSDV`**

Each of these functions currently calls `prepPanel(rows, yCol, xCols, unitCol, timeCol)` and then does its own single-unitCol/timeCol demeaning inline. For each one:
1. Add a `*Multi` version taking `feCols: string[]` in place of `unitCol, timeCol`, using `demeanByFE(valid, feCols, allCols)` for the demeaning step (for `TWFE` specifically, `feCols` is naturally `[unitCol, timeCol]` — this is the "generic two-way FE OLS" case, so `runTWFEDiD`'s multi form should accept `feCols` covering the full requested list, not just 2).
2. Keep the old name as a wrapper calling the new one with `feCols = [unitCol, timeCol].filter(Boolean)`.
3. Recompute each function's own `df` using `feDegreesOfFreedom` instead of its current hand-written formula (e.g. `runTWFEDiD`'s within `PanelSuffStatsEngine.js` counterpart uses `df = n − G − k_reg` for FE and `n − G − T + 1 − k_reg` for TWFE per CLAUDE.md's Fase 4/4b notes — `feDegreesOfFreedom` must reduce to exactly those formulas for D=1 and D=2 respectively; add an assertion comment showing the reduction).

Do this one function at a time, running `node --check src/math/PanelEngine.js` after each edit (syntax only — full correctness is Task 8's job).

- [ ] **Step 4: Run the existing structural harness to confirm nothing broke**

Run: `node src/math/__validation__/engineValidation.js` (or the specific FE/TWFE benchmark subset if the harness supports filtering — check the harness's CLI args first with `node src/math/__validation__/engineValidation.js --help` if such a flag exists, otherwise run the full harness).
Expected: FE/TWFE/DiD/EventStudy/LSDV cells that were passing before this change still show the same coefficients/SE (D=1/D=2 cases must be numerically identical to pre-change output, since `demeanByFE` with D=1 or D=2 is mathematically the same operation as the old hand-written demeaning — just generalized code).

- [ ] **Step 5: Commit**

```bash
git add src/math/PanelEngine.js
git commit -m "Generalize PanelEngine.js FE/FD/TWFE/EventStudy/LSDV to N-way feCols[]"
```

---

## Task 5: Wire the UI — multi-column FE picker replacing the entity/time-only display

**Files:**
- Modify: `src/components/modeling/ModelConfiguration.jsx` (`LSDVConfig`, lines 378-389, plus wherever FE/TWFE/EventStudy configuration is rendered)
- Modify: `src/components/ModelingTab.jsx` (panel context construction, lines 947-951 and 1478-1481 per the exploration report)
- Modify: `src/components/modeling/runners/estimationDispatch.js` (lines 56, 65, 87, 149, 156 per the exploration report — each currently does `ec = panel.entityCol, tc = panel.timeCol`)

- [ ] **Step 1: Add a shared `FEColumnPicker` component to `ModelConfiguration.jsx`**

```jsx
// Multi-select FE dimension picker. Defaults to panel.feCols (from PanelTab
// declaration) but lets the user narrow/reorder for THIS estimation only —
// does not mutate the stored panel declaration.
function FEColumnPicker({ panel, selectedFeCols, setSelectedFeCols, headers, C, T }) {
  if (!panel?.feCols?.length) return null;
  const toggle = col => setSelectedFeCols(
    selectedFeCols.includes(col) ? selectedFeCols.filter(c => c !== col) : [...selectedFeCols, col]
  );
  return (
    <Section title="Fixed Effects" color={C.teal}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {panel.feCols.map(col => (
          <Chip key={col} label={col} selected={selectedFeCols.includes(col)} onClick={() => toggle(col)} color={C.teal} />
        ))}
      </div>
    </Section>
  );
}
export { FEColumnPicker };
```

- [ ] **Step 2: Add `selectedFeCols` state in `ModelingTab.jsx`**

Near the existing panel-related state (search for where `lsdvTimeFE` is declared, per the exploration report's line 819 memo dep list), add:

```js
const [selectedFeCols, setSelectedFeCols] = useState(null); // null = use panel.feCols as-is
const effectiveFeCols = selectedFeCols ?? panel?.feCols ?? [panel?.entityCol, panel?.timeCol].filter(Boolean);
```

Add `selectedFeCols` to the big `estimate` `useCallback` dependency array (the one CLAUDE.md's "Key bugs fixed" section warns about — SC/EventStudy/LSDV state going stale in that array; do not repeat that bug here).

- [ ] **Step 3: Thread `effectiveFeCols` through the dispatch context**

Replace the two cited call sites:

```js
// ModelingTab.jsx ~line 947-951 — BEFORE:
unitCol: panel?.entityCol ?? null, timeCol: panel?.timeCol ?? null,

// AFTER:
unitCol: panel?.entityCol ?? null, timeCol: panel?.timeCol ?? null,
feCols: effectiveFeCols,
```

```js
// ModelingTab.jsx ~line 1478-1481 (SQL fast path) — BEFORE:
const unitCol = panel?.entityCol; const timeCol = panel?.timeCol;

// AFTER — SQL fast path stays 2-dimension only for now (see Task 6); guard so
// it's skipped whenever more than 2 FE dims are requested, falling back to the
// JS path automatically:
const unitCol = panel?.entityCol; const timeCol = panel?.timeCol;
if (effectiveFeCols.length > 2) {
  // fall through to JS path — do not attempt the 2-dim-only SQL fast path
}
```

- [ ] **Step 4: Update `estimationDispatch.js`'s 5 call sites**

At each of the cited lines (56, 65, 87, 149, 156), replace:

```js
// BEFORE (pattern repeated at each site):
const ec = panel.entityCol, tc = panel.timeCol;
// ... runFE(rows, y, x, ec, tc, seOpts)

// AFTER:
const feCols = context.feCols?.length ? context.feCols : [panel.entityCol, panel.timeCol].filter(Boolean);
// ... runFEMulti(rows, y, x, feCols, seOpts)   // (or runFDMulti / runTWFEDiDMulti / runEventStudyMulti / runLSDVMulti — match whichever estimator that call site handles)
```

Import the `*Multi` functions from `PanelEngine.js` at the top of `estimationDispatch.js` alongside the existing `runFE`/`runFD`/etc. imports.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: `✓ built` with no errors. Run `npm run lint:undef` too — expected `ok — no undefined-identifier violations`.

- [ ] **Step 6: Commit**

```bash
git add src/components/modeling/ModelConfiguration.jsx src/components/ModelingTab.jsx src/components/modeling/runners/estimationDispatch.js
git commit -m "Wire N-way FE column picker into FE/TWFE/LSDV/EventStudy dispatch"
```

---

## Task 6: DuckDB SQL fast-path — 2-dimension cap with explicit fallback

**Files:**
- Modify: `src/services/data/duckdbWithin.js` (no signature change needed — it already only supports `unitCol` + optional `timeCol`)

**Decision (documented, not silently made):** generalizing the SQL suff-stats path to arbitrary N-way FE would require either (a) a bounded-iteration alternating-projection driver issuing repeated SQL aggregation round-trips from JS, or (b) a recursive-CTE rewrite of `buildWithinSuffStats`. Both are substantial standalone efforts with their own correctness risk. This task keeps the SQL fast path capped at its current 2-dimension support (`unitCol` + `timeCol` only) and makes the cap explicit and safe: any estimation requesting more than 2 FE columns (via `effectiveFeCols` from Task 5) must fall back to the JS engine from Task 4, never silently drop the extra FE columns.

- [ ] **Step 1: Add a guard comment and confirm the fallback path is exercised**

In `src/services/data/duckdbWithin.js`, at the top of `buildWithinSuffStats` (line 42), add:

```js
// CAP: this SQL path only demeans by unitCol + optional timeCol (2 dimensions
// max). Callers requesting 3+ FE dimensions (see PanelWithinEngine.js /
// PanelEngine.js's *Multi functions) MUST route to the JS engine instead —
// see ModelingTab.jsx's `effectiveFeCols.length > 2` guard (Task 6 of
// docs/superpowers/plans/2026-07-10-panel-nway-fixed-effects.md). Silently
// truncating to 2 dims here would produce a result that doesn't match what
// the user configured.
```

- [ ] **Step 2: Confirm (by reading, not editing) that `ModelingTab.jsx`'s dispatch logic from Task 5 Step 3 actually prevents `buildWithinSuffStats` from ever being called with 3+ requested FE dims**

Trace the call path from the `effectiveFeCols.length > 2` guard added in Task 5 to wherever `buildWithinSuffStats`/`duckdbDispatch.shouldUseSQLPath` is invoked, and confirm the guard is upstream of that call (not downstream, where it'd be too late). If it is downstream, move the check earlier — the SQL path must never be attempted at all when 3+ FE dims are requested, not attempted-then-truncated.

- [ ] **Step 3: Manual smoke test note**

No automated test for this step (it's a routing guard, not new math). Note in your task summary that Franco should browser-verify: declare a panel with 3 FE dimensions in `PanelTab.jsx`, run TWFE on a dataset large enough to normally trigger the SQL fast path (≥50k rows per `shouldUseSQLPath`'s threshold, per CLAUDE.md's Fase 0+1+2 section), and confirm it still estimates correctly (via the JS fallback) rather than erroring or silently using only 2 of the 3 FE columns.

- [ ] **Step 4: Commit**

```bash
git add src/services/data/duckdbWithin.js
git commit -m "Cap DuckDB SQL within-transform path at 2 FE dims; route 3+ to JS engine"
```

---

## Task 7: Replication script export — emit N fixed effects

**Files:**
- Modify: `src/services/export/rScript.js` (FE/TWFE model export — search for where `fixest::feols(y ~ x | entityCol + timeCol` or similar is built)
- Modify: `src/services/export/pythonScript.js` (linearmodels `PanelOLS` / statsmodels absorb export)
- Modify: `src/services/export/stataScript.js` (`reghdfe` export)

- [ ] **Step 1: R export — `fixest::feols`**

Find the FE/TWFE model-building code in `rScript.js` (search for `feols(` in this file). It currently builds the `|` fixed-effects clause from `spec.entityCol`/`spec.timeCol` (2 dims max). Change it to join `spec.feCols` (falling back to `[spec.entityCol, spec.timeCol].filter(Boolean)` for old saved specs that predate this feature):

```js
// BEFORE (conceptually):
const feClause = [spec.entityCol, spec.timeCol].filter(Boolean).join(" + ");

// AFTER:
const feCols = spec.feCols?.length ? spec.feCols : [spec.entityCol, spec.timeCol].filter(Boolean);
const feClause = feCols.join(" + ");
```

Result: `fixest::feols(y ~ x1 + x2 | state + year + industry, data = df)` for a 3-way case.

- [ ] **Step 2: Python export — `linearmodels.PanelOLS`**

Find the equivalent Python builder in `pythonScript.js`. `linearmodels.PanelOLS` natively supports only entity + time effects (`entity_effects=True, time_effects=True`) — it does NOT support an arbitrary 3rd FE dimension the way `fixest`/`reghdfe` do. For `feCols.length > 2`, emit a comment explaining the limitation and fall back to manual dummy-variable absorption via `statsmodels`:

```python
# linearmodels.PanelOLS only supports entity + time effects natively.
# For a 3rd+ FE dimension, absorb via one-hot dummies through statsmodels instead:
import statsmodels.formula.api as smf
model = smf.ols("y ~ x1 + x2 + C(state) + C(year) + C(industry) - 1", data=df).fit()
```

Wire this branch in the export builder: `if (feCols.length <= 2) { /* existing PanelOLS path */ } else { /* emit the statsmodels C(...) dummy path above, with feCols mapped into C(...) terms */ }`.

- [ ] **Step 3: Stata export — `reghdfe`**

Find the Stata FE export in `stataScript.js` (search for `xtreg` or `areg` — the existing export likely uses one of these single/dual-FE commands). `reghdfe` (a well-known, near-universal Stata package) natively supports N-way absorption: `reghdfe y x1 x2, absorb(state year industry)`. Since `reghdfe` isn't a Stata built-in, add an `install.packages`-equivalent comment (Stata calls it `ssc install reghdfe`):

```stata
* ssc install reghdfe  // if not installed — required for 3+-way FE absorption
reghdfe y x1 x2, absorb(state year industry) vce(cluster state)
```

For the `feCols.length <= 2` case, keep the existing `xtreg`/`areg` export unchanged (don't force a new dependency on users who only need entity+time FE, matching the codebase's general "smallest necessary blast radius" convention).

- [ ] **Step 4: Manual verification**

No automated test (script-string builders). Generate one R, one Python, one Stata replication script for a 3-FE-dimension TWFE model via the app UI and visually confirm the `|`/`C(...)`/`absorb(...)` clauses list all 3 columns in the right order. Note this as a Franco browser-validation item.

- [ ] **Step 5: Commit**

```bash
git add src/services/export/rScript.js src/services/export/pythonScript.js src/services/export/stataScript.js
git commit -m "Export N-way FE absorption in R/Python/Stata replication scripts"
```

---

## Task 8: R validation (REQUIRED before calling this feature done)

**Files:**
- Create: `src/math/__validation__/panelNwayFeRValidation.R`
- Create: `src/math/__validation__/panelNwayFeBenchmarks.json` (generated by running the R script)
- Modify: `src/math/__validation__/engineValidation.js` (add the new benchmark comparison, following the existing pattern for FE/TWFE cells)

- [ ] **Step 1: Write the R fixture script**

```r
# src/math/__validation__/panelNwayFeRValidation.R
# Validates PanelEngine.js's runFEMulti / runTWFEDiDMulti against fixest for:
#   (a) 2 independent (non-nested) FE dims: state + industry
#   (b) 3 independent FE dims: state + industry + year
#   (c) a nested pair: state + (state × year) — tests the df-collinearity risk
#       flagged in PanelWithinEngine.js's feDegreesOfFreedom() comment
library(fixest)
library(jsonlite)

set.seed(42)
n_state <- 8; n_industry <- 5; n_year <- 6
df <- expand.grid(state = 1:n_state, industry = 1:n_industry, year = 1:n_year)
df$x1 <- rnorm(nrow(df))
df$x2 <- rnorm(nrow(df))
df$y  <- 2 + 0.5*df$x1 - 0.3*df$x2 + df$state*0.1 + df$industry*0.2 + df$year*0.05 + rnorm(nrow(df))

fit_2way <- feols(y ~ x1 + x2 | state + industry, data = df)
fit_3way <- feols(y ~ x1 + x2 | state + industry + year, data = df)
df$state_year <- interaction(df$state, df$year)
fit_nested <- feols(y ~ x1 + x2 | state + state_year, data = df)

extract <- function(fit) list(
  coef = as.numeric(coef(fit)), se = as.numeric(se(fit)),
  df = fit$nobs - fit$nparams, nobs = fit$nobs
)

benchmarks <- list(
  meta = list(source = "R fixest, generated by panelNwayFeRValidation.R"),
  two_way_independent = extract(fit_2way),
  three_way_independent = extract(fit_3way),
  nested_state_stateyear = extract(fit_nested)
)
write_json(benchmarks, "panelNwayFeBenchmarks.json", auto_unbox = TRUE, digits = 10)
write.csv(df, "panelNwayFeFixture.csv", row.names = FALSE)
```

- [ ] **Step 2: Ask Franco to run it** (no R on this machine, per project memory `feedback_validation_circular_benchmarks.md`)

Message to include in your handoff: "Please run `Rscript src/math/__validation__/panelNwayFeRValidation.R` from `src/math/__validation__/` and commit the two generated files (`panelNwayFeBenchmarks.json`, `panelNwayFeFixture.csv`)."

- [ ] **Step 3: Once the benchmark JSON exists, add the comparison to `engineValidation.js`**

Follow the exact pattern already used for the existing FE/TWFE benchmark cells in this file (same tolerance: 1e-6 on coefficients, 1e-5 on SE, per `src/math/__validation__/README.md`). Load `panelNwayFeFixture.csv`, run `runFEMulti(rows, "y", ["x1","x2"], ["state","industry"], {})` and compare against `panelNwayFeBenchmarks.two_way_independent`, then repeat for the 3-way and nested cases.

**Pay special attention to the nested case**: if `feDegreesOfFreedom`'s simple additive formula does NOT match `fit_nested$nobs - fit_nested$nparams`, do not paper over it — this confirms the documented risk in `PanelWithinEngine.js`'s `feDegreesOfFreedom` comment, and the fix (rank-based FE dof counting, matching fixest's actual algorithm) becomes a required follow-up task, not an optional one, since wrong df directly biases every SE and p-value for any user who declares nested/overlapping FE dimensions.

- [ ] **Step 4: Update `CLAUDE.md`'s estimator table**

Add a row (or amend the existing FE/TWFE rows) noting: "N-way FE (3+ dimensions) | PanelEngine.js (`runFEMulti` et al.) | ✓/✗ validated vs R fixest — [fill in based on Step 3's outcome, including whether the nested-FE df case passed or is a known gap]".

- [ ] **Step 5: Update `ClaudePlan.md`'s Spec & Plan Index**

Add a row for this plan file:

```
| 2026-07-10 | `plans/2026-07-10-panel-nway-fixed-effects.md` | IMPLEMENTATION COMPLETE — R validation pending Franco | [one-line summary once Task 8 lands] |
```

- [ ] **Step 6: Commit**

```bash
git add src/math/__validation__/panelNwayFeRValidation.R src/math/__validation__/panelNwayFeBenchmarks.json src/math/__validation__/panelNwayFeFixture.csv src/math/__validation__/engineValidation.js CLAUDE.md ClaudePlan.md
git commit -m "Add R validation for N-way FE (2/3-dim independent + nested cases)"
```

---

## Self-review notes (from the plan author, for whoever executes this)

- **Spec coverage**: Task 1-2 cover the engine primitives (demeaning + interaction), Task 3 covers panel declaration UI, Task 4 covers the estimator rewrite, Task 5 covers per-estimation UI wiring, Task 6 documents the SQL-path scope decision explicitly (per the brainstorm answer choosing "Full N-way FE" for the JS engine — the SQL path cap is a separate, explicitly-flagged pragmatic scope cut, not a silent omission), Task 7 covers replication export, Task 8 covers required R validation. FE interactions (the second brainstorm answer, "yes include it") are covered by Task 2 + Task 3 Step 2's UI + Task 3 Step 3's `feCols` assembly (an interaction-materialized column is just appended to `feCols` before it reaches `runFEMulti`).
- **Known gap surfaced, not hidden**: the FE degrees-of-freedom formula in `PanelWithinEngine.js` uses the simple additive count, which is provably wrong for nested/overlapping FE structures. Task 8 is designed to catch this against R and forces a follow-up rather than letting it ship silently wrong.
- **Backward compatibility**: every existing 2-arg call to `runFE`/`runFD`/`runTWFEDiD`/`runEventStudy`/`runLSDV` anywhere in the codebase that this plan does NOT touch keeps working unmodified, because those functions remain exported with their original signatures as wrappers.
