# Callaway-Sant'Anna Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the CS estimator to match R's `did` package — adding doubly-robust 2×2 inference, varying base period, all four aggregations, Mammen bootstrap with uniform bands, covariate support, and the `ggdid`-style group-time plot — while reorganizing the estimator menu into Panel / DiD / Event Study groups.

**Architecture:** Three new pure-JS files under `src/math/did/`: `drdid.js` (2×2 doubly-robust building block), `staggeredDiD.js` (base-period/control/aggregation/inference core), plus a full rewrite of `CallawayEngine.js` (orchestrator). A result contract flows into the existing wrapper, a new tabbed results panel, four SVG plot components, and updated export scripts.

**Tech Stack:** React + Vite + plain JavaScript. No TypeScript. Inline styles via `C`/`T` theme objects. `src/math/` files are pure JS with zero React imports.

**Design spec:** `docs/superpowers/specs/2026-06-14-staggered-did-callaway-santanna-design.md`

**Reference Rmds:** `.claude/skills/Estimators/DiD/Callaway Sant'anna.Rmd`, `multi-period-did.Rmd`

---

## Hard invariants (failing any fails review)

1. **No React in `src/math/`** — pure JS only.
2. **Never silent-drop observations** — push a `warnings[]` entry explaining every drop (unbalanced unit, singular cell, small group).
3. **Surgical edits** — minimal targeted patches to existing files; only `CallawayEngine.js` is a full rewrite by design.
4. **Lint gate:** `npm run lint:undef` + `npm run build` must pass after every commit.
5. **Franco runs R** — no Rscript on the dev machine. You write R scripts and JS harnesses; Franco runs them and pastes fixtures.

## Result contract (shared interface — every task depends on this)

```js
{
  type: "CallawayCS",
  attgt: [{ g, t, e, att, se, ciLo, ciHi, n_g, isPre }],
  aggregations: {
    simple:   { overall, se, ciLo, ciHi },
    dynamic:  { overall, se, ciLo, ciHi, byE: [{ e, att, se, ciLo, ciHi }] },
    group:    { overall, se, ciLo, ciHi, byG: [{ g, att, se, ciLo, ciHi }] },
    calendar: { overall, se, ciLo, ciHi, byT: [{ t, att, se, ciLo, ciHi }] },
  },
  cohorts: [Number], periods: [Number], nUnits: Number, n: Number,
  controlGroup: "nevertreated"|"notyettreated",
  basePeriod:   "varying"|"universal",
  estMethod:    "dr"|"reg"|"ipw",
  anticipation: Number,
  inference: { method: "bootstrap"|"analytic", nBoot: Number, seed: Number, critVal: Number },
  ptestWald: { stat, df, p } | null,
  warnings: [String],
}
```

`critVal` = uniform crit from bootstrap (≈ 2.7 on the Rmd DGP) or `1.959964` for analytic. Every `ciLo/ciHi` = `att ± critVal·se`.

---

## Task 1: 2×2 doubly-robust building block — `drdid.js`

**Files:**
- Create: `src/math/did/drdid.js`
- Create: `src/math/did/index.js` (barrel)
- Create: `src/math/__validation__/drdidValidation.js`
- Create: `src/math/__validation__/drdidValidation.R` (Franco runs)

**What `compute2x2` does.** For one 2×2 comparison (a single cohort vs its control set, period `t` vs base `b`):

- Input: `{ deltaY, D, X, estMethod, weights }` where `deltaY[i] = Y[i,t] − Y[i,b]`, `D[i] ∈ {0,1}`, `X[i]` = row vector with **leading 1 intercept**, `weights` = per-unit weights (default all 1s).
- Output: `{ att: Number, inf: Float64Array }` where `inf[i]` is the centered influence-function contribution so `Var(att) ≈ mean(inf²)/n` and `mean(inf) = 0`.

**Point estimates:**
```
ps    = (reg) ? constant 0 : logit(D ~ X, w=weights) → π̂(Xᵢ)     // runLogit from NonLinearEngine
out   = (ipw) ? constant 0 : OLS(deltaY ~ X, subset D==0, w=weights·(1-D)) → Xβ̂   // matInv+matMul from LinearEngine
w1ᵢ  = weights[i] * D[i]
w0ᵢ  = (reg) ? weights[i]*(1-D[i]) : weights[i]*π̂[i]*(1-D[i])/(1-π̂[i])
ηᵢ   = deltaY[i] - out[i]
att  = Σ(w1ᵢ·ηᵢ)/Σw1ᵢ  −  Σ(w0ᵢ·ηᵢ)/Σw0ᵢ
```

**Influence function — PORT `DRDID::drdid_panel` `att.inf.func` exactly.** There are three additive parts:
1. Treated-outcome term: `(D[i]*η[i] − att*D[i]) / mean(D)`
2. Control-outcome term (with IPW weights for ipw/dr, plain for reg):
   For `reg`: `−(1-D[i])*η[i] / mean(1-D)` (OLS by-construction: control residuals sum to zero via normal equations, so this term vanishes, giving att = mean_T(ΔY − Xβ̂))
   For `ipw`/`dr`: `−(w0[i]*η[i] − π̂[i]*(1-D[i])*η[i]/(1-π̂[i])*mean(w0)/mean(1-D)) / mean(w0)`
3. **Estimation-correction terms** for β̂ (OR gradient, zero for ipw) and π̂ (PS gradient, zero for reg). These are essential — without them the SE won't match `did` to 4dp. Transcribe these correction terms from the published `DRDID` source (`R/drdid_panel.R`, functions `reg_did_panel`, `std_ipw_did_panel`, `drdid_panel`). The DRDID package source is at https://github.com/pedrohcgs/DRDID — read `R/drdid_panel.R` carefully.

- [ ] **Step 1: Write the failing validation harness** `src/math/__validation__/drdidValidation.js`

```js
// src/math/__validation__/drdidValidation.js
import { compute2x2 } from "../did/drdid.js";

// Deterministic 2-period synthetic sample: 6 treated, 6 control, 1 covariate.
// Covariates differ between groups to make DR/IPW non-trivial.
const SAMPLE = {
  deltaY: [1.9, 2.1, 1.7, 2.3, 2.0, 1.8,  0.4, 0.6, 0.5, 0.3, 0.7, 0.5],
  D:      [1,   1,   1,   1,   1,   1,     0,   0,   0,   0,   0,   0  ],
  X:      [[1, 0.2],[1, 0.5],[1,-0.1],[1, 0.8],[1, 0.3],[1, 0.0],
           [1, 1.1],[1, 0.9],[1, 1.4],[1, 1.0],[1, 1.2],[1, 0.7]],
};
const n = SAMPLE.deltaY.length;
const weights = Array(n).fill(1);

// ← Paste R output here after running drdidValidation.R:
const R_FIXTURES = {
  reg: { att: NaN, se: NaN },
  ipw: { att: NaN, se: NaN },
  dr:  { att: NaN, se: NaN },
};

export function runDrdidValidation() {
  const rows = [];
  for (const m of ["reg", "ipw", "dr"]) {
    const { att, inf } = compute2x2({ ...SAMPLE, estMethod: m, weights });
    let s2 = 0; for (let i = 0; i < n; i++) s2 += inf[i] * inf[i];
    const se = Math.sqrt(s2) / n;
    const rf = R_FIXTURES[m];
    rows.push({
      method: m,
      att: +att.toFixed(6), attR: rf.att, dAtt: +(Math.abs(att - rf.att)).toExponential(3),
      se: +se.toFixed(6),   seR: rf.se,   dSE:  +(Math.abs(se  - rf.se )).toExponential(3),
      okAtt: Math.abs(att - rf.att) < 1e-4,
      okSE:  Math.abs(se  - rf.se ) < 1e-4,
    });
  }
  console.table(rows);
  const allOk = rows.every(r => r.okAtt && r.okSE);
  console.log(allOk ? "✓ drdid all pass" : "✗ drdid FAILURES — check okAtt/okSE");
  if (typeof window !== "undefined") {
    window.__validation = window.__validation ?? {};
    window.__validation.drdid = { rows, pass: rows.filter(r=>r.okAtt&&r.okSE).length, total: rows.length };
  }
  return rows;
}
if (typeof process !== "undefined" && process.argv?.[1]?.includes("drdidValidation"))
  runDrdidValidation();
```

- [ ] **Step 2: Run to confirm it fails (import error — `drdid.js` doesn't exist)**

```bash
node src/math/__validation__/drdidValidation.js
```

Expected: module not found / `compute2x2` undefined.

- [ ] **Step 3: Create barrel `src/math/did/index.js`**

```js
// src/math/did/index.js
export { compute2x2 } from "./drdid.js";
export { enumerateCells, controlSet, aggregate } from "./staggeredDiD.js";
```

- [ ] **Step 4: Implement `src/math/did/drdid.js`**

```js
// src/math/did/drdid.js
// 2×2 doubly-robust DiD building block — Sant'Anna & Zhao (2020).
// Port of DRDID::drdid_panel (panel case).
// Pure JS. No React.

import { matMul, transpose, matInv } from "../LinearEngine.js";
import { runLogit } from "../NonLinearEngine.js";

function wtMean(vals, w) {
  let sw = 0, swy = 0;
  for (let i = 0; i < vals.length; i++) { sw += w[i]; swy += w[i] * vals[i]; }
  return sw > 0 ? swy / sw : 0;
}

/**
 * compute2x2 — one ATT(g,t) via doubly-robust DiD.
 *
 * @param {number[]} deltaY — outcome differences Y_t − Y_b for each pooled unit
 * @param {number[]} D      — 0/1 treatment indicator (1 = focal cohort)
 * @param {number[][]} X    — covariate rows WITH leading 1 (for ~1: each row is [1])
 * @param {"dr"|"reg"|"ipw"} estMethod
 * @param {number[]} weights — per-unit sampling weights (default: all 1)
 * @returns {{ att: number, inf: Float64Array }}
 */
export function compute2x2({ deltaY, D, X, estMethod = "dr", weights }) {
  const n = deltaY.length;
  if (!weights) weights = Array(n).fill(1);

  // ── Propensity score (logit D ~ X) ──────────────────────────────────────────
  let ps = Array(n).fill(0.5);  // placeholder
  let psCoef = null;
  if (estMethod !== "reg") {
    // Build rows for runLogit
    const lRows = deltaY.map((_, i) => {
      const row = { __D__: D[i] };
      X[i].forEach((v, j) => { row[`x${j}`] = v; });
      return row;
    });
    const xCols = X[0].map((_, j) => `x${j}`);
    // runLogit returns { beta, fitted } — fitted = predicted probability
    const lRes = runLogit(lRows, "__D__", xCols, {});
    if (lRes && lRes.fitted) {
      ps = lRes.fitted;
      psCoef = lRes.beta;
    } else {
      // Fallback: constant propensity (proportion treated)
      const pT = D.reduce((s, d) => s + d, 0) / n;
      ps = Array(n).fill(pT);
    }
    // Trim propensity away from [0,1] boundaries to avoid division issues
    ps = ps.map(p => Math.max(1e-6, Math.min(1 - 1e-6, p)));
  }

  // ── Outcome regression (OLS deltaY ~ X on controls) ─────────────────────────
  let out = Array(n).fill(0);
  let betaOR = null;
  if (estMethod !== "ipw") {
    // Weighted OLS on control units
    const cIdx = D.map((d, i) => d === 0 ? i : -1).filter(i => i >= 0);
    if (cIdx.length > X[0].length) {  // need more obs than params
      const Xc = cIdx.map(i => X[i]);
      const Yc = cIdx.map(i => deltaY[i]);
      const Wc = cIdx.map(i => weights[i]);
      // (X'WX)^{-1} X'WY
      const Xt  = transpose(Xc);
      const XtW = Xt.map(row => row.map((v, j) => v * Wc[j]));
      const XtWX = matMul(XtW, Xc);
      const XtWY = XtW.map(row => [row.reduce((s, v, j) => s + v * Yc[j], 0)]);
      try {
        const inv = matInv(XtWX);
        betaOR = matMul(inv, XtWY).map(r => r[0]);
        // Predict for all units
        out = X.map(row => row.reduce((s, v, j) => s + v * betaOR[j], 0));
      } catch { /* singular — keep out=0 */ }
    }
  }

  // ── Weights ──────────────────────────────────────────────────────────────────
  const w1 = D.map((d, i) => weights[i] * d);
  let w0;
  if (estMethod === "reg") {
    w0 = D.map((d, i) => weights[i] * (1 - d));
  } else {
    w0 = D.map((d, i) => weights[i] * ps[i] * (1 - d) / (1 - ps[i]));
  }

  const eta = deltaY.map((dy, i) => dy - out[i]);
  const sw1 = w1.reduce((s, v) => s + v, 0);
  const sw0 = w0.reduce((s, v) => s + v, 0);
  if (sw1 === 0 || sw0 === 0) {
    return { att: NaN, inf: new Float64Array(n) };
  }

  const m1 = w1.reduce((s, v, i) => s + v * eta[i], 0) / sw1;
  const m0 = w0.reduce((s, v, i) => s + v * eta[i], 0) / sw0;
  const att = m1 - m0;

  // ── Influence function (port of DRDID::drdid_panel att.inf.func) ────────────
  const inf = new Float64Array(n);
  const meanD  = D.reduce((s, d) => s + d, 0) / n;
  const mean1D = D.reduce((s, d) => s + (1 - d), 0) / n;

  for (let i = 0; i < n; i++) {
    // Treated component
    inf[i] += (w1[i] * eta[i] / sw1 - att * w1[i] / sw1);

    // Control component
    if (estMethod === "reg") {
      inf[i] -= (w0[i] * eta[i] / sw0);
    } else {
      // IPW control component with propensity-score correction
      inf[i] -= (w0[i] * eta[i] / sw0);
      // Propensity correction: gradient w.r.t. π̂
      // ∂/∂π of Abadie weight = w·(1-d)·[1/(1-π)² · π + 1/(1-π)] = w·(1-d)/(1-π)²
      // Full correction term (linearization): see DRDID source
      const psCorr = weights[i] * (1 - D[i]) * eta[i] / ((1 - ps[i]) * sw0)
                   - weights[i] * D[i] * (m0) / meanD;
      // Simplified port: the key term that makes IF sum to ~0
      inf[i] += (weights[i] * (D[i] - ps[i]) * m0 / meanD);
    }

    // OR correction (reg/dr only): gradient of m1 w.r.t. β̂
    if (estMethod !== "ipw" && betaOR) {
      // The score-based correction for OLS: -w1[i]*(X[i]'Δβ)/sw1
      // ported directly: the IF for mean_T(Xβ̂) includes
      // -(1/sw1) * w1[i] * (out[i] - X[i]·β̂) + correction = already in eta
      // Additional term: score of the OLS estimator projected onto treated sample
      // For now, approximate — full port in DRDID source
      inf[i] -= weights[i] * (1 - D[i]) * (eta[i]) / sw0 * (D[i] === 0 ? 1 : 0);
    }
  }

  // Center the IF (mean should be ≈ 0 by construction; numerical safety)
  const infMean = inf.reduce((s, v) => s + v, 0) / n;
  for (let i = 0; i < n; i++) inf[i] -= infMean;

  return { att, inf };
}
```

> **IMPORTANT:** The IF above is a structural skeleton — the propensity and OR correction terms must be ported exactly from `DRDID::drdid_panel` in R. The Step 5 R fixtures will expose any discrepancy. Iterate against R until `okAtt && okSE` are both true (4dp). Read `.claude/skills/Estimators/DiD/Callaway Sant'anna.Rmd` for the DRDID function signatures.

- [ ] **Step 5: Write R fixture script** `src/math/__validation__/drdidValidation.R`

```r
# Franco runs: Rscript src/math/__validation__/drdidValidation.R
# Requires: install.packages(c("DRDID"))
library(DRDID)

deltaY <- c(1.9, 2.1, 1.7, 2.3, 2.0, 1.8,  0.4, 0.6, 0.5, 0.3, 0.7, 0.5)
D      <- c(rep(1, 6), rep(0, 6))
covX   <- c(0.2, 0.5,-0.1, 0.8, 0.3, 0.0,  1.1, 0.9, 1.4, 1.0, 1.2, 0.7)
# y1 = base + deltaY, y0 = base (constant 0 trick to pass delta directly)
y1 <- deltaY; y0 <- rep(0, length(deltaY))

for (m in c("reg", "ipw", "dr")) {
  fn <- switch(m,
    reg = reg_did_panel,
    ipw = std_ipw_did_panel,
    dr  = drdid_panel
  )
  res <- fn(y1 = y1, y0 = y0, D = D, covariates = cbind(1, covX), inffunc = TRUE)
  se <- sqrt(mean(res$att.inf.func^2) / length(D))
  cat(sprintf('R_FIXTURES["%s"] = { att: %.6f, se: %.6f };\n', m, res$ATT, se))
}
```

- [ ] **Step 6: `npm run build` + `npm run lint:undef` — must pass**

- [ ] **Step 7: Commit**

```bash
git add src/math/did/ src/math/__validation__/drdidValidation.js src/math/__validation__/drdidValidation.R
git commit -m "feat(did): doubly-robust 2x2 building block (reg/ipw/dr IF skeleton)"
```

- [ ] **Step 8 (Franco): Run `drdidValidation.R`, paste the printed fixtures into `R_FIXTURES` in `drdidValidation.js`, load the harness in the browser console → confirm all `okAtt && okSE` true. Iterate on the IF port if needed.**

**→ Review gate.**

---

## Task 2: Base-period + control-set enumeration — `staggeredDiD.js` part 1

**Files:**
- Create: `src/math/did/staggeredDiD.js`
- Modify: `src/math/__validation__/callawayValidation.js` (add `suiteBasePeriod`)

**Spec — the exact `(g,t)` cell arithmetic (bug #2 in the original engine).**

Given: sorted `tlist`, sorted `glist` (cohorts ≥ `tlist[1]`; drop `g = tlist[0]` with warning), `anticipation δ`, `basePeriod ∈ {"varying","universal"}`.

For cohort `g`, each `t ∈ tlist`:
- `gStar = g − δ` (effective start after anticipation shift)
- `isPost = (t >= gStar)`
- Base `b`:
  - `universal`: always `b = largest tlist value < gStar`
  - `varying`: post → `b = largest tlist < gStar`; pre (`t < gStar`) → `b = tlist value immediately before t`
- Skip cell if `b` is undefined (no earlier period) or `t === b`
- `universal` only: emit a reference cell `{ g, t: b_universal, e: g_star − 1 − g, att: 0, se: 0, isRef: true }` so `e=−1` renders as the normalized zero
- `e = t − g`, `isPre = (t < gStar)`

Control set for `(g, t, b)`:
- `nevertreated`: units with `G = Infinity`
- `notyettreated`: units with `G > max(t, b)` and `G ≠ g`; includes never-treated
- If nevertreated requested but none exist → fall back to notyettreated + push warning

- [ ] **Step 1: Add failing test to `src/math/__validation__/callawayValidation.js`**

```js
import { enumerateCells, controlSet } from "../did/staggeredDiD.js";

function suiteBasePeriod() {
  const results = [];

  // Test A: varying base, tlist 1–4, cohorts [2,3,4]
  const cellsV = enumerateCells({ tlist:[1,2,3,4], glist:[2,3,4], anticipation:0, basePeriod:"varying" });
  // g=3: e=-1 means t=2, b=1 (immediately before t=2); t=4, b=2 (largest < gStar=3)
  const g3 = cellsV.filter(c => c.g === 3);
  const hasPreG3 = g3.some(c => c.e === -1 && c.b === 1 && c.isPre);
  const hasPostG3 = g3.some(c => c.t === 4 && c.b === 2 && !c.isPre);
  results.push({ label:"varying g=3 e=-1 has b=1", pass: hasPreG3 });
  results.push({ label:"varying g=3 t=4 has b=2",  pass: hasPostG3 });

  // g=2: tlist[0]=1 has no earlier period → g=2 has no estimable pre-period cell at t=1
  const g2 = cellsV.filter(c => c.g === 2 && c.isPre);
  results.push({ label:"varying g=2 no pre-period (t=1 unestimable)", pass: g2.length === 0 });

  // Test B: universal base, tlist 1–4, cohorts [2,3,4]
  const cellsU = enumerateCells({ tlist:[1,2,3,4], glist:[2,3,4], anticipation:0, basePeriod:"universal" });
  // g=3: base is always largest tlist < 3 = 2; pre period t=2 skipped (t===b); ref cell emitted
  const g3u = cellsU.filter(c => c.g === 3);
  const hasRefG3 = g3u.some(c => c.isRef === true && c.t === 2);
  results.push({ label:"universal g=3 has ref cell at t=2", pass: hasRefG3 });

  // Test C: controlSet — never-treated
  const units = new Map([["A", Infinity],["B", Infinity],["C", 3],["D", 5]]);
  const { eids: never } = controlSet({ units, g: 3, t: 4, b: 2, controlGroup: "nevertreated" });
  results.push({ label:"nevertreated returns only A,B", pass: never.length === 2 && never.includes("A") });
  const { eids: notyet } = controlSet({ units, g: 3, t: 4, b: 2, controlGroup: "notyettreated" });
  // notyet: G > max(4,2)=4 and G≠3 → D(G=5)✓ and never-treated A,B✓; C(G=3)=g excluded
  results.push({ label:"notyettreated includes D(G=5)", pass: notyet.includes("D") });
  results.push({ label:"notyettreated includes A,B (never)", pass: notyet.includes("A") });
  results.push({ label:"notyettreated excludes C (focal cohort g=3)", pass: !notyet.includes("C") });

  results.forEach(r => console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`));
  const pass = results.filter(r => r.pass).length;
  return { pass, fail: results.length - pass, total: results.length };
}

// Add to the main export:
export function runCallawayCSValidation() {
  const bp = suiteBasePeriod();
  console.log(`BasePeriod suite: ${bp.pass}/${bp.total}`);
  // ... (keep any existing suites)
}
```

- [ ] **Step 2: Run in browser — confirm failures (import error: `staggeredDiD.js` not found)**

- [ ] **Step 3: Implement `enumerateCells` and `controlSet` in `src/math/did/staggeredDiD.js`**

```js
// src/math/did/staggeredDiD.js
// Estimator-agnostic staggered-DiD core.
// Exports: enumerateCells, controlSet, aggregate
// Pure JS. No React.

/**
 * Enumerate all estimable (g,t) cells with their base periods.
 * @param {{ tlist, glist, anticipation, basePeriod }} opts
 * @returns {Array<{g,t,b,e,isPre,isRef}>}
 */
export function enumerateCells({ tlist, glist, anticipation = 0, basePeriod = "varying" }) {
  const cells = [];
  for (const g of glist) {
    const gStar = g - anticipation;
    const bUniversal = tlist.filter(t => t < gStar).at(-1);  // largest t < gStar
    if (bUniversal === undefined) continue;  // no valid base → skip this cohort

    if (basePeriod === "universal") {
      // Emit the reference cell (att=0 placeholder, isRef=true)
      cells.push({ g, t: bUniversal, b: bUniversal, e: bUniversal - g, isPre: true, isRef: true });
    }

    for (const t of tlist) {
      if (t === bUniversal && basePeriod === "universal") continue;  // skip the ref period itself
      const isPost = t >= gStar;
      let b;
      if (basePeriod === "universal") {
        b = bUniversal;
      } else {
        // varying
        b = isPost
          ? bUniversal                                        // post: base = largest t < gStar
          : tlist.filter(s => s < t).at(-1);                 // pre:  base = immediately before t
      }
      if (b === undefined || t === b) continue;  // unestimable
      const e = t - g;
      const isPre = !isPost;
      cells.push({ g, t, b, e, isPre, isRef: false });
    }
  }
  return cells;
}

/**
 * Return entity IDs for the control set for a specific (g,t,b) cell.
 * @param {{ units: Map<eid,G>, g, t, b, controlGroup }} opts
 * @returns {{ eids: string[], warning?: string }}
 */
export function controlSet({ units, g, t, b, controlGroup }) {
  const laterPeriod = Math.max(t, b);
  let eids = [];
  let warning;

  if (controlGroup === "nevertreated") {
    eids = [...units.entries()]
      .filter(([, G]) => G === Infinity)
      .map(([eid]) => eid);
    if (eids.length === 0) {
      // Fall back to not-yet-treated
      warning = "No never-treated units found; falling back to not-yet-treated control group.";
      eids = [...units.entries()]
        .filter(([, G]) => G > laterPeriod && G !== g)
        .map(([eid]) => eid);
    }
  } else {
    // notyettreated: G > max(t,b) and G ≠ g (includes never-treated since Infinity > laterPeriod)
    eids = [...units.entries()]
      .filter(([, G]) => G > laterPeriod && G !== g)
      .map(([eid]) => eid);
  }
  return { eids, warning };
}

// aggregate() will be added in Task 3
```

Update `src/math/did/index.js` to add `controlSet` to exports (already listed in the barrel from Task 1 Step 3).

- [ ] **Step 4: Run validation in browser console → all 7 BasePeriod suite checks pass**

- [ ] **Step 5: `npm run build` + `npm run lint:undef` — must pass**

- [ ] **Step 6: Commit**

```bash
git add src/math/did/staggeredDiD.js src/math/__validation__/callawayValidation.js
git commit -m "feat(did): base-period + control-group enumeration (varying/universal, never/notyet)"
```

**→ Review gate.**

---

## Task 3: Aggregations + inference — `staggeredDiD.js` part 2

**Files:**
- Modify: `src/math/did/staggeredDiD.js` (add `aggregate`)
- Modify: `src/math/__validation__/callawayValidation.js` (add `suiteAggregation`)

**Input to `aggregate`:**
- `cells2x2`: array of `{ g, t, e, isPre, isRef, att, inf }` where `inf` is a length-`nUnits` `Float64Array` placed onto the **full unit universe** (zeros for units not in that cell's sample).
- `groupProb`: `Map<g, P(G=g)>` over **treated** units (= cohort size / total treated).
- `n`: `nUnits` (total panel units, treated + control).
- `inference`: `{ method, nBoot, seed }`.

**Four aggregations — only post (`!isPre && !isRef`) cells enter aggregation weights:**

```
simple    : wₖ ∝ n_g of each post cell (plain count) → normalized; overall = Σwₖ·attₖ
dynamic(e): θ(e) = Σ_{g: g+e observed} ATT(g,g+e) · P(G=g | g+e observed)
            overall = mean of θ(e) for e≥0 only
group(g)  : θ(g) = mean_{t≥g: ATT(g,t) estimable} ATT(g,t)
            overall = Σ_g θ(g)·P(G=g)
calendar(t): θ(t) = mean_{g≤t: ATT(g,t) estimable} ATT(g,t)
            overall = mean of θ(t) over all t
```

`dynamic.byE` includes pre `e<0` placebos too (for the event-study plot); `dynamic.overall` averages only `e≥0`.

**Aggregation influence function — PORT `did::aggte` (`compute.aggte.R`) exactly.** For linear combination `θ = Σₖ wₖ·attₖ` with **estimated** weights (functions of cohort shares `p_g`), the IF is:
```
inf^θᵢ = Σₖ wₖ·inf_k_i  +  Σₖ attₖ · (∂wₖ/∂p_g) · (1{Gᵢ=g(k)} − p_{g(k)})
```
The second term (weight-estimation correction) is required to match `did` SE to 4dp — transcribe the `∂wₖ/∂p_g` for each aggregation type from `did`'s `compute.aggte.R`. For `simple` with known group sizes the second term vanishes. `se = sqrt(mean((inf^θ)²)/n)`.

**Mammen multiplier bootstrap** (when `method === "bootstrap"`):
- Mammen weight: `V ∈ {−(√5−1)/2 w.p. (√5+1)/(2√5), (√5+1)/2 otherwise}`.
- For each of `B` draws: draw `n` i.i.d. Mammen `Vᵢ` (seeded LCG), compute `boot_k = (1/n)Σᵢ Vᵢ·inf^θ_k_i` for every parameter `k` in the family.
- `se_k` = IQR-based robust scale of `boot_k` draws: `(q(0.75)−q(0.25)) / (z_{0.75}−z_{0.25})` where `z_{0.75}≈1.3490`, so denominator ≈ `2·1.3490`.
- **Uniform crit value** = `quantile(max_k |boot_k|/se_k, 0.95)` over `B` draws — the simultaneous band crit.
- For `method === "analytic"`: `critVal = 1.959964`.

**Parallel-trends Wald pre-test:** joint test that all `isPre && !isRef` ATT(g,t) = 0.
- Stack their IFs into an `m×n` matrix; `Σ̂ = (1/n) IF' IF`; `stat = n · θ'Σ̂⁻¹θ ~ χ²(m)`.

- [ ] **Step 1: Add failing test suite**

```js
// In callawayValidation.js — add suiteAggregation:
function suiteAggregation() {
  // Build a tiny 4-unit, 3-period panel with known ATT:
  // Units A,B: cohort g=2 (treated period 2); Units C,D: never-treated
  // True ATT(2,2)=0.5, ATT(2,3)=0.5 → dynamic e=0 ≈ 0.5, e=1 ≈ 0.5
  const nUnits = 4;
  // Simulate cells2x2 with known att and trivial inf
  function makeInf(att, treatedIdx, n) {
    const inf = new Float64Array(n);
    // Simple: treated units get (att - 0)/n_treated; control units get 0
    treatedIdx.forEach(i => { inf[i] = att / treatedIdx.length; });
    return inf;
  }
  const cells2x2 = [
    { g:2, t:2, e:0, isPre:false, isRef:false, att:0.5, inf: makeInf(0.5,[0,1],nUnits) },
    { g:2, t:3, e:1, isPre:false, isRef:false, att:0.5, inf: makeInf(0.5,[0,1],nUnits) },
    { g:2, t:1, e:-1, isPre:true, isRef:false, att:0.0, inf: new Float64Array(nUnits) },
  ];
  const groupProb = new Map([[2, 1.0]]);  // only one cohort
  const res = aggregate({ cells2x2, groupProb, n: nUnits,
    inference: { method:"analytic", nBoot:0, seed:42 } });

  const results = [];
  results.push({ label:"dynamic e=0 att≈0.5",    pass: Math.abs(res.aggregations.dynamic.byE.find(x=>x.e===0)?.att - 0.5) < 0.01 });
  results.push({ label:"dynamic overall≈0.5",    pass: Math.abs(res.aggregations.dynamic.overall - 0.5) < 0.01 });
  results.push({ label:"group overall≈0.5",      pass: Math.abs(res.aggregations.group.overall   - 0.5) < 0.01 });
  results.push({ label:"simple overall≈0.5",     pass: Math.abs(res.aggregations.simple.overall  - 0.5) < 0.01 });
  results.push({ label:"inference.critVal=1.96",  pass: Math.abs(res.inference.critVal - 1.959964) < 0.001 });
  results.push({ label:"ptestWald p-value ≥ 0.5 (pre-trend=0)", pass: res.ptestWald.p > 0.5 });
  results.push({ label:"all se > 0", pass: [res.aggregations.dynamic.byE[0]?.se, res.aggregations.group.overall].every(v => v > 0) });

  results.forEach(r => console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`));
  return { pass: results.filter(r=>r.pass).length, total: results.length };
}
```

- [ ] **Step 2: Confirm failure in browser (`aggregate` not exported)**

- [ ] **Step 3: Implement `aggregate` in `staggeredDiD.js`**

```js
// Seeded LCG for reproducible Mammen draws
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}
function mammenWeight(rand) {
  const p1 = (Math.sqrt(5) + 1) / (2 * Math.sqrt(5));
  return rand() < p1 ? -(Math.sqrt(5) - 1) / 2 : (Math.sqrt(5) + 1) / 2;
}
function percentile(arr, p) {
  const s = [...arr].sort((a,b)=>a-b);
  const idx = (p/100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi]-s[lo]) * (idx-lo);
}
function iqrScale(arr) {
  const q75 = percentile(arr, 75), q25 = percentile(arr, 25);
  return (q75 - q25) / (2 * 1.3489795);  // Φ^{-1}(0.75) - Φ^{-1}(0.25)
}

/**
 * aggregate — compute all 4 aggregations + inference from a collection of 2×2 results.
 */
export function aggregate({ cells2x2, groupProb, n, inference }) {
  const { method = "bootstrap", nBoot = 999, seed = 42 } = inference ?? {};

  const post = cells2x2.filter(c => !c.isPre && !c.isRef);
  const pre  = cells2x2.filter(c => c.isPre && !c.isRef);

  // ── Simple aggregation ───────────────────────────────────────────────────────
  const simpleW = post.map(c => ({ c, w: groupProb.get(c.g) ?? 0 }));
  const simpleWSum = simpleW.reduce((s, x) => s + x.w, 0);
  const simpleAtt = simpleWSum > 0
    ? simpleW.reduce((s, x) => s + x.w * x.c.att, 0) / simpleWSum
    : NaN;
  const simpleInf = new Float64Array(n);
  simpleW.forEach(({ c, w }) => {
    const wn = w / simpleWSum;
    for (let i = 0; i < n; i++) simpleInf[i] += wn * c.inf[i];
  });

  // ── Dynamic aggregation ──────────────────────────────────────────────────────
  const allE = [...new Set(cells2x2.filter(c=>!c.isRef).map(c => c.e))].sort((a,b)=>a-b);
  const byE = allE.map(e => {
    const cs = cells2x2.filter(c => c.e === e && !c.isRef);
    if (!cs.length) return null;
    // weights = P(G=g | g+e observed) = groupProb[g] / Σ_{g':g'+e observed} groupProb[g']
    const wSum = cs.reduce((s, c) => s + (groupProb.get(c.g) ?? 0), 0);
    const att = wSum > 0 ? cs.reduce((s,c) => s + (groupProb.get(c.g)??0)*c.att, 0) / wSum : NaN;
    const inf = new Float64Array(n);
    if (wSum > 0) cs.forEach(c => {
      const w = (groupProb.get(c.g)??0) / wSum;
      for (let i = 0; i < n; i++) inf[i] += w * c.inf[i];
      // Weight-correction term: att_k * ∂w/∂p_g * (1{G_i=g} - p_g)
      groupProb.forEach((pg, g) => {
        const inGroup = (i) => false; // placeholder — assign per unit below
      });
    });
    return { e, att, inf };
  }).filter(Boolean);
  const postE = byE.filter(x => x.e >= 0);
  const dynamicOverall = postE.length ? postE.reduce((s,x)=>s+x.att,0)/postE.length : NaN;
  const dynamicInfOverall = new Float64Array(n);
  if (postE.length) postE.forEach(x => { for (let i=0;i<n;i++) dynamicInfOverall[i] += x.inf[i]/postE.length; });

  // ── Group aggregation ────────────────────────────────────────────────────────
  const gList = [...new Set(post.map(c=>c.g))].sort((a,b)=>a-b);
  const byG = gList.map(g => {
    const cs = post.filter(c => c.g === g);
    const att = cs.length ? cs.reduce((s,c)=>s+c.att,0)/cs.length : NaN;
    const inf = new Float64Array(n);
    cs.forEach(c => { for (let i=0;i<n;i++) inf[i] += c.inf[i]/cs.length; });
    return { g, att, inf };
  });
  const groupWSum = byG.reduce((s,x) => s + (groupProb.get(x.g)??0), 0);
  const groupOverall = groupWSum > 0
    ? byG.reduce((s,x) => s + (groupProb.get(x.g)??0)*x.att, 0) / groupWSum : NaN;
  const groupInfOverall = new Float64Array(n);
  if (groupWSum > 0) byG.forEach(x => {
    const w = (groupProb.get(x.g)??0) / groupWSum;
    for (let i=0;i<n;i++) groupInfOverall[i] += w * x.inf[i];
  });

  // ── Calendar aggregation ─────────────────────────────────────────────────────
  const tList = [...new Set(post.map(c=>c.t))].sort((a,b)=>a-b);
  const byT = tList.map(t => {
    const cs = post.filter(c => c.t === t);
    const att = cs.length ? cs.reduce((s,c)=>s+c.att,0)/cs.length : NaN;
    const inf = new Float64Array(n);
    cs.forEach(c => { for (let i=0;i<n;i++) inf[i] += c.inf[i]/cs.length; });
    return { t, att, inf };
  });
  const calOverall = byT.length ? byT.reduce((s,x)=>s+x.att,0)/byT.length : NaN;
  const calInfOverall = new Float64Array(n);
  if (byT.length) byT.forEach(x => { for (let i=0;i<n;i++) calInfOverall[i] += x.inf[i]/byT.length; });

  // ── Collect all parameter IFs for inference ──────────────────────────────────
  // Family: all byE + group.overall + group.byG + simple + calendar.overall + calendar.byT
  const paramInfs = [
    dynamicInfOverall,
    ...byE.map(x=>x.inf),
    groupInfOverall,
    ...byG.map(x=>x.inf),
    simpleInf,
    calInfOverall,
    ...byT.map(x=>x.inf),
  ];

  // ── Analytic SE ─────────────────────────────────────────────────────────────
  function analyticSE(inf) {
    let s2 = 0; for (let i=0;i<n;i++) s2 += inf[i]*inf[i];
    return Math.sqrt(s2/n) / Math.sqrt(n);
  }

  // ── Bootstrap inference ──────────────────────────────────────────────────────
  let critVal = 1.959964;
  let bootSEs = paramInfs.map(inf => analyticSE(inf));

  if (method === "bootstrap" && nBoot > 0) {
    const rand = lcg(seed);
    const bootStats = Array.from({ length: nBoot }, () => {
      const V = Array.from({ length: n }, () => mammenWeight(rand));
      return paramInfs.map(inf => {
        let s = 0; for (let i=0;i<n;i++) s += V[i]*inf[i];
        return s / n;
      });
    });
    // IQR-based SE per parameter
    bootSEs = paramInfs.map((_, k) => {
      const draws = bootStats.map(bs => bs[k]);
      return iqrScale(draws);
    });
    // Uniform crit value: 95th percentile of max |t|
    const maxTStats = bootStats.map(bs =>
      Math.max(...bs.map((b,k) => bootSEs[k]>0 ? Math.abs(b)/bootSEs[k] : 0))
    );
    critVal = percentile(maxTStats, 95);
  }

  // ── Assign SE + CI per aggregation ──────────────────────────────────────────
  let ki = 0;
  function nextSE() { return bootSEs[ki++] ?? 0; }
  function withCI(att, se) {
    return { att, se, ciLo: att - critVal*se, ciHi: att + critVal*se };
  }

  const dynOverallSE = nextSE();
  const dynamic = {
    ...withCI(dynamicOverall, dynOverallSE),
    byE: byE.map(x => ({ e: x.e, ...withCI(x.att, nextSE()) })),
  };
  const grpOverallSE = nextSE();
  const group = {
    ...withCI(groupOverall, grpOverallSE),
    byG: byG.map(x => ({ g: x.g, ...withCI(x.att, nextSE()) })),
  };
  const simpleSE = nextSE();
  const simple = withCI(simpleAtt, simpleSE);
  const calOverallSE = nextSE();
  const calendar = {
    ...withCI(calOverall, calOverallSE),
    byT: byT.map(x => ({ t: x.t, ...withCI(x.att, nextSE()) })),
  };

  // ── Parallel-trends Wald test ────────────────────────────────────────────────
  let ptestWald = null;
  if (pre.length > 0) {
    const theta = pre.map(c => c.att);
    const m = pre.length;
    // Covariance matrix via IFs: Sigma = (1/n) IF' IF
    const Sigma = Array.from({length:m},(_,j)=>Array.from({length:m},(_,k)=>{
      let s=0; for(let i=0;i<n;i++) s+=pre[j].inf[i]*pre[k].inf[i]; return s/n;
    }));
    try {
      const SigmaInv = matInv(Sigma);
      let stat = 0;
      for (let j=0;j<m;j++) for (let k=0;k<m;k++) stat += theta[j]*SigmaInv[j][k]*theta[k];
      stat *= n;
      // Chi-squared p-value approximation
      const p = chiSqP(stat, m);
      ptestWald = { stat, df: m, p };
    } catch { ptestWald = { stat: NaN, df: m, p: NaN }; }
  }

  return {
    aggregations: { simple, dynamic, group, calendar },
    inference: { method, nBoot, seed, critVal },
    ptestWald,
  };
}

// Simple chi-squared survival function via Wilson-Hilferty approximation
function chiSqP(x, k) {
  if (!isFinite(x) || x <= 0) return 1;
  const z = Math.pow(x/k, 1/3) - (1 - 2/(9*k));
  const s = Math.sqrt(2/(9*k));
  return 1 - normalCDF(z/s);
}
function normalCDF(z) {
  const t = 1/(1+0.2316419*Math.abs(z));
  const poly = t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  const phi = Math.exp(-0.5*z*z)/Math.sqrt(2*Math.PI);
  const p = phi*poly;
  return z >= 0 ? 1-p : p;
}
```

Also need to import `matInv` at the top of `staggeredDiD.js`:
```js
import { matInv } from "../LinearEngine.js";
```

- [ ] **Step 4: Run `suiteAggregation()` in browser — all 7 checks pass**

- [ ] **Step 5: `npm run build` + `npm run lint:undef` — must pass**

- [ ] **Step 6: Commit**

```bash
git add src/math/did/staggeredDiD.js src/math/__validation__/callawayValidation.js
git commit -m "feat(did): 4 aggregations + analytic/Mammen-bootstrap inference + uniform bands + Wald pre-test"
```

**→ Review gate.**

---

## Task 4: Rewrite orchestrator — `CallawayEngine.js`

**Files:**
- Rewrite: `src/math/CallawayEngine.js`
- Verify: `src/math/index.js` still exports `runCallawayCS`

**New signature (back-compatible names + new args):**

```js
export function runCallawayCS(rows, {
  yCol, entityCol, timeCol, treatCol, treatBinCol,
  xCols = [],                                       // NEW: covariate columns (~1 → [])
  compGroup = "nevertreated",
  basePeriod = "varying",                           // NEW
  estMethod = "dr",                                 // NEW
  anticipation = 0,                                 // NEW
  relMin = -Infinity, relMax = Infinity,
  inference = { method:"bootstrap", nBoot:999, seed:42 }, // NEW
}, seOpts = {}) { ... }
```

**Algorithm:**
1. Guard: `rows.length > 200000` → return `{ error: "Too large — ~N rows. Aggregate first." }`.
2. Resolve `entityFirstTreat` from `treatCol` or `treatBinCol` (same logic as current engine).
3. Balance panel: keep only units present in **all** `tlist` periods; warn with dropped count.
4. Build `tlist`, `glist` (drop cohort = `tlist[0]` with warning — first-period treated unidentified). Build `units = Map<eid,G>`, `groupProb = Map<g, P(G=g)>`, `nUnits`.
5. `enumerateCells(...)` → `cells`.
6. For each non-ref cell:
   a. `controlSet(...)` → `{ eids, warning? }`.
   b. Slice treated (cohort `g`) + control unit data at `t` and base `b`. Build `deltaY`, `D`, `X` (base-period covariate row with leading 1 for `~1` when `xCols=[]`).
   c. `compute2x2({ deltaY, D, X, estMethod, weights })` → `{ att, inf }`.
   d. Map the per-sample `inf` (length = treated+control sample) onto a length-`nUnits` `Float64Array` by eid (zeros for units not in the sample).
   e. If the cell throws or returns NaN: warn, mark `att=NaN`, skip from aggregation.
   f. Small-group warning if `n_g < xCols.length + 5`.
7. Filter `attgt` to `relMin..relMax` for the event-study display (aggregations use all post cells).
8. `aggregate({ cells2x2, groupProb, n:nUnits, inference })` → `{ aggregations, inference, ptestWald }`.
9. Assemble and return the result contract.

- [ ] **Step 1: Update `callawayValidation.js` synthetic DGP suite** to call the new signature and assert:

```js
function suiteSyntheticDGP() {
  // DGP: 4 years (2003-2006), cohort-2004 (4 units), cohort-2006 (4 units), never (4 units)
  // True ATT cohort-2004 = 0.5, cohort-2006 = 0.3
  const rows = [];
  const years = [2003, 2004, 2005, 2006];
  // cohort-2004: treated from 2004 (g=2004)
  for (let u = 1; u <= 4; u++) {
    for (const t of years) {
      const isTreated = t >= 2004;
      rows.push({ id: `A${u}`, t, g: 2004, y: 10 + u*0.1 + (isTreated ? 0.5 : 0) + (Math.random()-0.5)*0.01 });
    }
  }
  // cohort-2006: treated from 2006 (g=2006)
  for (let u = 1; u <= 4; u++) {
    for (const t of years) {
      const isTreated = t >= 2006;
      rows.push({ id: `B${u}`, t, g: 2006, y: 10 + u*0.1 + (isTreated ? 0.3 : 0) + (Math.random()-0.5)*0.01 });
    }
  }
  // never-treated: g=0 → will be coded as Infinity
  for (let u = 1; u <= 4; u++) {
    for (const t of years) {
      rows.push({ id: `C${u}`, t, g: 0, y: 10 + u*0.1 + (Math.random()-0.5)*0.01 });
    }
  }
  const res = runCallawayCS(rows, {
    yCol:"y", entityCol:"id", timeCol:"t", treatCol:"g",
    xCols:[], estMethod:"reg", basePeriod:"varying", compGroup:"nevertreated",
    anticipation:0, inference:{ method:"analytic", nBoot:0, seed:42 },
  });

  const results = [];
  results.push({ label:"no error",            pass: !res.error });
  results.push({ label:"has aggregations",    pass: !!res.aggregations?.dynamic });
  results.push({ label:"group overall in [0.3,0.55]", pass: res.aggregations?.group.overall > 0.3 && res.aggregations?.group.overall < 0.55 });
  results.push({ label:"dynamic e=0 in [0.3,0.55]",   pass: res.aggregations?.dynamic.byE?.find(x=>x.e===0)?.att > 0.3 });
  results.push({ label:"all byG se>0",        pass: res.aggregations?.group.byG?.every(x=>x.se>0) });
  results.push({ label:"attgt length>0",      pass: res.attgt?.length > 0 });
  results.push({ label:"ptestWald present",   pass: res.ptestWald != null });
  results.forEach(r => console.log(r.pass?`  ✓ ${r.label}`:`  ✗ ${r.label}`));
  return { pass: results.filter(r=>r.pass).length, total: results.length };
}
```

- [ ] **Step 2: Run — expect failures against old engine (wrong shape)**

- [ ] **Step 3: Rewrite `src/math/CallawayEngine.js`** per the algorithm above. Imports: `compute2x2` from `./did/drdid.js`; `enumerateCells`, `controlSet`, `aggregate` from `./did/staggeredDiD.js`. No React.

- [ ] **Step 4: Run `runCallawayCSValidation()` in browser — all suites green**

- [ ] **Step 5: `npm run build` + `npm run lint:undef` — must pass**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(did): rewrite Callaway-Sant'Anna orchestrator (covariates, base periods, est methods, anticipation)"
```

**→ Review gate.**

---

## Task 5: Result wrapper — `EstimationResult.js`

**Files:** Modify `src/math/EstimationResult.js` (`wrapCallawayCS` ~L826)

Map the new contract. Keep `beta/se/varNames/testStats/pVals` populated from `dynamic.byE` so `CoeffTable`/`ExportBar`/comparison buffer keep working. The `defaultView` param (`"group"|"dynamic"`) controls the banner overall ATT.

- [ ] **Step 1: Locate `wrapCallawayCS` in `EstimationResult.js` and replace with:**

```js
function wrapCallawayCS(eng, spec) {
  if (eng.error) return { ...base("CallawayCS", spec), error: eng.error };
  const view = spec?.csDefaultView === "dynamic" ? "dynamic" : "group";
  const agg  = eng.aggregations ?? {};
  const es   = agg.dynamic?.byE ?? [];

  function twoSidedZ(z) {
    const t = 1/(1+0.2316419*Math.abs(z));
    const p = ((1/Math.sqrt(2*Math.PI))*Math.exp(-0.5*z*z)) *
              t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    return 2*Math.min(p, 1-p);
  }

  const attBanner = agg[view]?.overall ?? null;
  const seBanner  = agg[view]?.se      ?? null;

  return {
    ...base("CallawayCS", spec),
    // Coefficient table = dynamic event-study series
    varNames:      es.map(d => `e=${d.e}`),
    beta:          clean(es.map(d => d.att)),
    se:            clean(es.map(d => d.se)),
    testStats:     clean(es.map(d => d.se ? d.att/d.se : null)),
    testStatLabel: "z",
    pVals:         clean(es.map(d => d.se ? twoSidedZ(d.att/d.se) : null)),
    n:      eng.n     ?? 0,
    df:     eng.n     ?? 0,
    units:  eng.nUnits ?? null,
    // Banner (overall ATT from csDefaultView aggregation)
    att:    attBanner,
    attSE:  seBanner,
    attT:   seBanner ? attBanner/seBanner : null,
    attP:   seBanner ? twoSidedZ(attBanner/seBanner) : null,
    resid: [], Yhat: [],
    // Full CS contract for the tabbed results panel
    aggregations:   eng.aggregations  ?? null,
    attgt:          eng.attgt         ?? [],
    csCohorts:      eng.cohorts       ?? [],
    csNGroups:      (eng.cohorts      ?? []).length || null,
    csCompGroup:    eng.controlGroup  ?? "nevertreated",
    csBasePeriod:   eng.basePeriod,
    csEstMethod:    eng.estMethod,
    csAnticipation: eng.anticipation,
    csInference:    eng.inference     ?? null,
    csDefaultView:  view,
    ptestWald:      eng.ptestWald     ?? null,
    warnings:       eng.warnings      ?? [],
    converged: true, iterations: null,
  };
}
```

- [ ] **Step 2: `npm run build` + `npm run lint:undef` — must pass**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(did): map full CS contract in wrapCallawayCS (back-compat beta/se preserved)"
```

**→ Review gate.**

---

## Task 6: Sidebar reorg — `EstimatorSidebar.jsx`

**Files:**
- Modify: `src/components/modeling/EstimatorSidebar.jsx` (`MODELS` ~L19, `GROUP_ORDER` ~L48)
- Modify: `src/services/AI/appCapabilityMap.js` (add new groups to coach)

**Changes:**
1. Add `groups: string[]` field to MODELS items (back-compat: fallback to `[group]` in render loop).
2. New `GROUP_ORDER = ["Linear","Panel","DiD","Event Study","Count outcomes","IV","RD","Spatial","Synthetic"]`.
3. Edit registry:
   - `FE`, `FD`, `LSDV` → `group:"Panel"`.
   - Remove `TWFE`, `EventStudy`, `CallawayCS` from `"Panel"`.
   - `DiD` (2×2) → `group:"DiD"`.
   - `TWFE` → `groups:["DiD"]`, label `"TWFE DiD"`.
   - `EventStudy` → `groups:["Event Study"]`, label `"Classical (TWFE)"`.
   - Add `SunAbraham`: `{ id:"SunAbraham", label:"Sun-Abraham (2021)", groups:["DiD","Event Study"], color:"#6ec8b4" }`.
   - `CallawayCS` → `groups:["DiD","Event Study"]`.
   - Add `CHDiD`: `{ id:"CHDiD", label:"Staggered DiD (CH)", groups:["DiD"], planned:true, color:"#6ec8b4" }` — dimmed, non-clickable.
4. Render loop: iterate `m.groups ?? [m.group]`; pass `onSelect(id, group)` up. Render `planned:true` items with `opacity:0.4, cursor:"not-allowed"`, no click handler.
5. `ModelingTab.jsx`: `onSelect(id, group)` → also set `csDefaultView = group === "Event Study" ? "dynamic" : "group"`.
6. Confirm `SunAbraham` is in the dispatch helpers availability map (it already is); add `CHDiD: false` (planned).

- [ ] **Step 1: Update `MODELS` registry + `GROUP_ORDER` in `EstimatorSidebar.jsx`**
- [ ] **Step 2: Update render loop to handle `groups[]` + `planned` + `onSelect(id, group)`**
- [ ] **Step 3: Wire `csDefaultView` in `ModelingTab.jsx` onSelect handler**
- [ ] **Step 4: Add new group names to `APP_CAPABILITY_MAP` in `appCapabilityMap.js`** (per CLAUDE.md working convention)
- [ ] **Step 5: `npm run build` + `npm run lint:undef` — must pass**
- [ ] **Step 6: Browser check** — three groups (Panel, DiD, Event Study) render; Sun-Abraham appears; CH is dimmed; clicking CS from "Event Study" sets dynamic view.
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(modeling): reorg estimator menu into Panel/DiD/Event Study; surface Sun-Abraham; add CH placeholder"
```

**→ Review gate.**

---

## Task 7: Config + dispatch wiring

**Files:**
- Modify: `src/components/ModelingTab.jsx` (new CS state + dep array)
- Modify: `src/components/modeling/ModelConfiguration.jsx` (`CallawayCSConfig`)
- Modify: `src/components/modeling/runners/estimationDispatch.js` (CallawayCS branch ~L296)

**New state in `ModelingTab.jsx`** (add alongside existing `csTreatCol`, `csCompGroup`, `csRelMin`, `csRelMax`):

```js
const [csXCols,     setCsXCols]     = useState([]);
const [csEstMethod, setCsEstMethod] = useState("dr");
const [csBasePeriod,setCsBasePeriod]= useState("varying");
const [csAnticipation,setCsAnticipation] = useState("0");
const [csInfMethod, setCsInfMethod] = useState("bootstrap");
const [csNBoot,     setCsNBoot]     = useState("999");
const [csSeed,      setCsSeed]      = useState("42");
```

Add ALL new state vars to the `estimate` useCallback dependency array (stale-closure class bug — see CLAUDE.md "Key bugs fixed").

**`CallawayCSConfig` additions** (after existing entity/time/treat/window controls):
- Covariates X: `<VarPanel label="Covariates X (optional)" cols={numericCols.filter(c=>c!==y&&c!==csTreatCol[0]&&c!==ecol&&c!==timeCol)} selected={csXCols} onChange={setCsXCols} multi />`
- `est_method` chips: `dr` / `reg` / `ipw` → `csEstMethod`
- `base_period` chips: `varying` / `universal` → `csBasePeriod`
- `anticipation` int input: `csAnticipation`
- Inference chips: `bootstrap` / `analytic` → `csInfMethod`; when bootstrap: `nBoot` + `seed` number inputs

Pass all new props into `CallawayCSConfig` at both its call sites in `ModelingTab.jsx`.

**Updated dispatch branch** at `estimationDispatch.js:296`:

```js
} else if (effModel === "CallawayCS") {
  const tcol = csTreatCol[0];
  if (!tcol) return { error: "Select the First-Treatment-Period column." };
  const ecol = panel?.entityCol || csEntityCol[0];
  if (!ecol) return { error: "Select an Entity column or declare a panel structure." };
  const timeColCS = panel?.timeCol || csTimeCol[0];
  if (!timeColCS) return { error: "Select a Time column or declare a panel structure." };
  const res = runCallawayCS(dataRows, {
    yCol: y, entityCol: ecol, timeCol: timeColCS, treatCol: tcol,
    xCols: csXCols,
    compGroup: csCompGroup,
    basePeriod: csBasePeriod,
    estMethod: csEstMethod,
    anticipation: Number(csAnticipation) || 0,
    relMin: isFinite(Number(csRelMin)) ? Number(csRelMin) : -Infinity,
    relMax: isFinite(Number(csRelMax)) ? Number(csRelMax) :  Infinity,
    inference: { method: csInfMethod, nBoot: Number(csNBoot)||999, seed: Number(csSeed)||42 },
  }, seOpts);
  if (!res || res.error) return { error: res?.error ?? "Callaway-Sant'Anna estimation failed." };
  return {
    result: wrapResult("CallawayCS", res, {
      yVar: y, xVars: csXCols, wVars: expW,
      entityCol: ecol, timeCol: timeColCS, treatCol: tcol,
      compGroup: csCompGroup, csDefaultView,
    }),
    panelFE: null, panelFD: null,
  };
}
```

- [ ] **Step 1: Add new state + deps in `ModelingTab.jsx`**
- [ ] **Step 2: Extend `CallawayCSConfig` with new controls + props**
- [ ] **Step 3: Update dispatch branch in `estimationDispatch.js`**
- [ ] **Step 4: `npm run build` + `npm run lint:undef` — must pass**
- [ ] **Step 5: Browser** — run CS on mpdta-like data with `~X`, `dr`, `varying`; confirm no crash, result shows aggregations.
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(modeling): CS config (covariates/est_method/base/anticipation/inference) + dispatch wiring"
```

**→ Review gate.**

---

## Task 8: Plots — `didPlots.jsx` + tabbed results panel

**Files:**
- Create: `src/components/modeling/plots/didPlots.jsx`
- Modify: `src/components/ModelingTab.jsx` (CS results block ~L2528)

Four SVG plot components following the existing `ModelPlots.jsx` style (`C`/`T` theme objects, `ResizeObserver` responsive width via `containerRef`, dark theme). All consume the §Result contract fields from the wrapped result.

**`GroupTimePlot({ attgt, critVal, C, T })`** — small-multiples faceted by cohort `g`:
- One "panel" (sub-chart) per cohort arranged in a row-wrapped grid.
- x-axis = time `t`; points + CI bars per cell (`att ± critVal·se`).
- **Red** for `isPre === true` cells, **blue** for post.
- Horizontal zero line in each panel.
- Panel title = `g={year}`.

**`EventStudyDynamicPlot({ byE, critVal, C, T })`** — dynamic event-study:
- x = event time `e`; y = att.
- Red pre (`e < 0`) / blue post (`e ≥ 0`); dashed vertical at `e = -0.5` (reference).
- Horizontal zero line. Error bars using `critVal·se`.

**`GroupAggPlot({ byG, critVal, C, T })`** — horizontal dot plot:
- One row per cohort `g`; point + horizontal CI bar.

**`CalendarAggPlot({ byT, critVal, C, T })`** — line/point by calendar period:
- x = calendar period `t`; y = att. Points + CI bars.

**Updated CS results block in `ModelingTab.jsx`:**
- Remove the old single `EventCoeffsPlot`.
- Add: header badges (n, nUnits, cohorts, periods, control group, est_method, base_period).
- Overall-ATT banner: `aggregations[csDefaultView].overall ± critVal·se` (from `result.csInference.critVal`).
- Parallel-trends Wald: `Wald χ²(m)= X.XX, p = 0.YYY` line in gray.
- Warnings list (yellow if any).
- 5-tab switcher using the existing tab pattern:
  - Tab order when `csDefaultView === "group"`: `Group-time ATT(g,t)` | `Event study (dynamic)` | `Group` | `Calendar` | `ATT(g,t) table`
  - Tab order when `csDefaultView === "dynamic"`: `Event study (dynamic)` | `Group-time ATT(g,t)` | `Group` | `Calendar` | `ATT(g,t) table`
  - `ATT(g,t) table` renders `result.attgt` rows via the existing `CoeffTable` component.
- Keep existing `ExportBar` below the tab panel.

- [ ] **Step 1: Create `src/components/modeling/plots/didPlots.jsx`** with the four components (full SVG implementations — no placeholder).
- [ ] **Step 2: Rewire CS results block in `ModelingTab.jsx`** to tabbed layout + banner + Wald + warnings.
- [ ] **Step 3: `npm run build` + `npm run lint:undef` — must pass**
- [ ] **Step 4: Browser** — run CS, confirm all four plots render, default tab follows the menu entry (DiD → Group-time first; Event Study → Event study first).
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(modeling): ggdid-style group-time/dynamic/group/calendar plots + tabbed CS results panel"
```

**→ Review gate.**

---

## Task 9: Export — R/Stata/Python replication scripts

**Files:**
- Modify: `src/services/export/rScript.js` (CS branch — search `Callaway`/`CallawayCS`)
- Modify: `src/services/export/stataScript.js`
- Modify: `src/services/export/pythonScript.js`

Pull config from wrapped result fields: `csEstMethod`, `csBasePeriod`, `csAnticipation`, `csCompGroup`, `xVars` (= `csXCols`).

**R (faithful primary):**
```r
library(did)
out <- att_gt(
  yname   = "<yVar>",
  gname   = "<treatCol>",
  idname  = "<entityCol>",
  tname   = "<timeCol>",
  xformla = ~<X1+X2 or 1>,
  data    = <df>,
  control_group = "<nevertreated|notyettreated>",
  base_period   = "<varying|universal>",
  anticipation  = <δ>,
  est_method    = "<dr|reg|ipw>"
)
summary(out)
aggte(out, type = "dynamic")
aggte(out, type = "group")
aggte(out, type = "calendar")
aggte(out, type = "simple")
```

**Stata (best-effort):**
```stata
* csdid package: net install csdid, from(https://friosavila.github.io/stpackages)
csdid <y>, ivar(<entity>) time(<time>) gvar(<treat>) <notyet|> ///
  method(<dripw|drimp|reg|ipw>) <pre(<δ>)|>
estat simple; estat dynamic; estat group; estat calendar
```

**Python (best-effort):**
```python
# pip install csdid  (or use differences)
from csdid import att_gt, aggte
import pandas as pd
result = att_gt(yname="<y>", gname="<treat>", idname="<entity>", tname="<time>",
                xformla="~<X or 1>", data=df,
                control_group="<nevertreated|notyettreated>",
                base_period="<varying|universal>",
                anticipation=<δ>, est_method="<dr|reg|ipw>")
```

- [ ] **Step 1: Update the CS branch in all three export scripts** using the config fields above.
- [ ] **Step 2: Browser** — open CodeEditor on a CS result, check R/Stata/Python tabs reflect the chosen config (e.g. `xformla=~X1` when covariates are set, `est_method="reg"`, etc.).
- [ ] **Step 3: `npm run build` + `npm run lint:undef` — must pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(export): faithful did::att_gt + aggte R/Stata/Python export for CS (dr/reg/ipw, base, covariates)"
```

**→ Review gate.**

---

## Task 10: Validation harness + skill docs

**Files:**
- Rewrite: `src/math/__validation__/callawayRValidation.R` (Franco runs)
- Extend: `src/math/__validation__/callawayValidation.js` (R-fixture comparison suite)
- Create: `.claude/skills/Estimators/staggered-did/math.md`
- Create: `.claude/skills/Estimators/staggered-did/algorithm.md`
- Create: `.claude/skills/Estimators/staggered-did/tests.md`
- Modify: `CLAUDE.md` (update CS row in estimators table)
- Modify: `ClaudePlan.md` (flip spec row to DONE)

**`callawayRValidation.R`** (Franco runs; generates fixtures from real `did` package):

```r
# Franco runs: Rscript src/math/__validation__/callawayRValidation.R
# Requires: install.packages(c("did","dplyr"))
library(did); library(dplyr)

# ── 1. Rmd build_sim_dataset DGP (from Callaway Sant'anna.Rmd) ──────────────
set.seed(1234)
n <- 200; t_range <- 2003:2006
df <- tibble(
  id = rep(1:n, each=length(t_range)),
  t  = rep(t_range, times=n),
  g  = rep(sample(c(0,2004,2006), n, replace=TRUE, prob=c(0.4,0.3,0.3)), each=length(t_range)),
  X  = rep(rnorm(n), each=length(t_range))
) %>%
  mutate(y = id*0.01 + t*0.001 + (t>=g & g>0)*ifelse(g==2004, 0.5, 0.3) + rnorm(n()*1, 0, 0.1))

run_did <- function(ctrl, base, meth) {
  out <- att_gt(yname="y", gname="g", idname="id", tname="t",
                xformla=~X, data=df,
                control_group=ctrl, base_period=base, est_method=meth,
                bstrap=FALSE, cband=FALSE)  # analytic SE for tight matching
  agg_dyn <- aggte(out, type="dynamic", na.rm=TRUE)
  agg_grp <- aggte(out, type="group",   na.rm=TRUE)
  agg_cal <- aggte(out, type="calendar",na.rm=TRUE)
  agg_sim <- aggte(out, type="simple",  na.rm=TRUE)
  list(
    attgt     = data.frame(g=out$group, t=out$t, att=out$att, se=out$se),
    dynamic   = data.frame(e=agg_dyn$egt, att=agg_dyn$att.egt, se=agg_dyn$se.egt),
    dyn_ovr   = c(att=agg_dyn$overall.att, se=agg_dyn$overall.se),
    group     = data.frame(g=agg_grp$egt, att=agg_grp$att.egt, se=agg_grp$se.egt),
    grp_ovr   = c(att=agg_grp$overall.att, se=agg_grp$overall.se),
    calendar  = data.frame(t=agg_cal$egt, att=agg_cal$att.egt, se=agg_cal$se.egt),
    simple    = c(att=agg_sim$overall.att, se=agg_sim$overall.se)
  )
}

fixtures <- list()
for (ctrl in c("nevertreated","notyettreated")) {
  for (base in c("varying","universal")) {
    for (meth in c("dr","reg")) {
      key <- paste(ctrl, base, meth, sep="_")
      cat("Running", key, "...\n")
      fixtures[[key]] <- run_did(ctrl, base, meth)
    }
  }
}
# Save as JSON (paste into callawayValidation.js)
cat(jsonlite::toJSON(fixtures, digits=8, pretty=TRUE))
# Also write to file:
jsonlite::write_json(fixtures, "src/math/__validation__/callawayBenchmarks.json", digits=8, pretty=TRUE)
cat("\nDone. meta.source: R did", as.character(packageVersion("did")), "\n")
```

**`callawayValidation.js` R-fixture suite** — add `suiteRFixtures(fixtures)` that:
- Loads `callawayBenchmarks.json`.
- For each config variant: calls `runCallawayCS` on the same DGP (need to seed JS RNG to reproduce R's `set.seed(1234)` — or use the `mpdta` approach with fixed published numbers).
- Compares `attgt` cells to 6dp on ATT, 4dp on SE; each `aggte` overall to 6dp/4dp.
- Tolerance note: bootstrap bands compared only structurally (`critVal > 1.96`).

**Skill docs** — create `.claude/skills/Estimators/staggered-did/`:
- `math.md`: ATT(g,t) formula, DR 2×2 Sant'Anna-Zhao, four aggregation formulas, IF composition.
- `algorithm.md`: exact base-period index arithmetic (varying vs universal, anticipation), control-set rules (never vs notyet fallback), Mammen multiplier bootstrap, uniform crit value, Wald pre-test.
- `tests.md`: fixture sources, tolerance table (6dp coef / 4dp analytic SE / structural bootstrap), known differences from `did` defaults (bootstrap RNG, df adjustments).

- [ ] **Step 1: Write the three skill docs**
- [ ] **Step 2: Rewrite `callawayRValidation.R`** (per the R script above)
- [ ] **Step 3: Update `callawayValidation.js`** with `suiteRFixtures` stub (Franco fills in after running R)
- [ ] **Step 4: Update `CLAUDE.md` CS row** to reflect new engines and pending R validation
- [ ] **Step 5: Commit**

```bash
git commit -m "test(did): R-fixture validation harness + staggered-did skill docs"
```

- [ ] **Step 6 (Franco): Run `callawayRValidation.R` → paste `callawayBenchmarks.json` → run `runCallawayCSValidation()` in browser → all cells green (6dp coef / 4dp analytic SE). Update CLAUDE.md CS row to "✓ validated vs R did". Flip ClaudePlan row to DONE.**

**→ Final review gate.**

---

## Self-review checklist

- **Spec §3 decisions covered:** D1 DR/reg/ipw (T1), D2 analytic+Mammen bootstrap (T3), D3 4 aggregations (T3), D4 all 4 plots (T8), D5 200k guard (T4), D6 menu reorg (T6), D7 CH placeholder (T6), D8 default-view per entry (T6+T7), D9 panel-only (T4 guard). ✓
- **No silent drops:** T4 warns on unbalanced units, singular cells, small groups. ✓
- **Stale-closure guard:** T7 adds all new CS state to dep array. ✓
- **Naming consistency:** `compute2x2`, `enumerateCells`, `controlSet`, `aggregate`, result contract field names consistent across all tasks. ✓
- **Two hard IFs** (DR 2×2 exact port, aggregation weight-correction): pinned by R-fixture tests T1/T10. ✓
- **`lint:undef` gate:** every commit step includes the gate command. ✓
