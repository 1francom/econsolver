# Staggered-DiD framework + Callaway-Sant'Anna — Implementation Plan (Codex prompt)

> **This document is a self-contained prompt for OpenAI Codex.** Paste it into Codex working in the repo `C:\Franco\econsolver` on branch `Main-`. It assumes zero prior context. Work task-by-task, commit after each task, and **stop after each numbered Task for Franco to review** (Franco validates in the browser and runs R; there is no R/Rscript on the dev machine, so you cannot run the R validation yourself — you write the R script and the JS harness, Franco runs them).

**Goal:** Rewrite Litux's Callaway-Sant'Anna estimator to match R's `did` package, building a reusable, estimator-agnostic staggered-DiD framework, and reorganize the DiD/Event-Study UI.

**Architecture:** Three new pure-JS math files under `src/math/did/` (`drdid.js` = 2×2 doubly-robust building block; `staggeredDiD.js` = base-period/control/aggregation/inference core; rewritten `CallawayEngine.js` = orchestrator). A canonical result contract flows into the wrapper, a tabbed results panel, four `ggdid`-style plot components, and faithful R/Stata/Python export.

**Tech stack:** React + Vite + plain JavaScript. No TypeScript. No external UI libraries. Inline styles via the `C`/`T` theme objects. Math files are pure JS with **no React imports**.

**Design spec (read first):** `docs/superpowers/specs/2026-06-14-staggered-did-callaway-santanna-design.md`

---

## 0. Orientation — read before writing code

**What Litux is:** a browser-based, client-side econometrics platform (alternative to R/Stata). Estimator math lives in `src/math/`; UI in `src/components/`.

**Hard invariants (violating any of these fails review):**
1. **No React in `src/math/`** — pure JS only.
2. **SE type is passed explicitly** — engines accept a `seType`, never hardcode it. (CS uses its own IF-based inference; this rule mainly means: don't hardcode assumptions.)
3. **Never silently drop observations** — return a `warnings[]` entry explaining any drop (small group, singular cell, unbalanced unit).
4. **Surgical edits** — modify existing files with minimal targeted patches, not rewrites (except `CallawayEngine.js`, which is a full rewrite by design).
5. **Lint gate:** after any change, `npm run lint:undef` and `npm run build` must pass. `lint:undef` catches out-of-scope identifiers (a recurring class of bug here).

**Commands:**
- Build: `npm run build`
- Undefined-identifier lint: `npm run lint:undef`
- There is no JS unit-test runner wired for browser modules; validation harnesses are run **in the browser console** via `window.__validation.*`, and the math is cross-checked against R by Franco. Each math file gets a Node-runnable self-check where feasible (guarded by `if (typeof process !== "undefined" && process.argv?.[1]?.includes("<file>"))`).

**Canonical math references (port faithfully):**
- Callaway & Sant'Anna (2021), *J. Econometrics* 225(2):200-230 — `ATT(g,t)`, aggregations §4.
- Sant'Anna & Zhao (2020), *J. Econometrics* — doubly-robust 2×2; implemented in R package `DRDID`, function `drdid_panel` (point estimate **and** `att.inf.func`).
- R package `did`: `att_gt` (loops DRDID over `(g,t)`), `aggte` (aggregations + influence-function-based SE + Mammen multiplier bootstrap with uniform bands).
- The two reference Rmd vignettes are in `.claude/skills/Estimators/DiD/` (`Callaway Sant'anna.Rmd`, `multi-period-did.Rmd`).

**Existing code you will reuse:**
- OLS: `src/math/LinearEngine.js` (matrix solve, `runOLS`/WLS).
- Logit (IRLS): `src/math/NonLinearEngine.js` `runLogit`.
- Result wrappers: `src/math/EstimationResult.js` (`wrapResult`, `wrapCallawayCS` at ~L826, `ESTIMATOR_META` at ~L107).
- Dispatch: `src/components/modeling/runners/estimationDispatch.js` (CallawayCS branch ~L296).
- Config UI: `src/components/modeling/ModelConfiguration.jsx` (`CallawayCSConfig` ~L424).
- Sidebar registry: `src/components/modeling/EstimatorSidebar.jsx` (`MODELS` ~L19, `GROUP_ORDER` ~L48).
- Results render: `src/components/ModelingTab.jsx` (CallawayCS block ~L2528; the CS-config state lives here — search `csTreatCol`, `csCompGroup`, `csRelMin`).
- Validation: `src/math/__validation__/callawayValidation.js`, `callawayRValidation.R`.

**The current engine's known bugs (this plan fixes all four):** (a) covariates ignored; (b) universal base period instead of `did`'s default varying; (c) hand-rolled influence function; (d) only the dynamic aggregation + no group-time plot.

---

## Result contract (the shared interface — every task depends on this)

`runCallawayCS(...)` returns:

```js
{
  type: "CallawayCS",
  attgt: [ { g, t, e, att, se, ciLo, ciHi, n_g, isPre } ],   // one per estimated (g,t) cell
  aggregations: {
    simple:   { overall, se, ciLo, ciHi },
    dynamic:  { overall, se, ciLo, ciHi, byE: [ { e, att, se, ciLo, ciHi } ] },
    group:    { overall, se, ciLo, ciHi, byG: [ { g, att, se, ciLo, ciHi } ] },
    calendar: { overall, se, ciLo, ciHi, byT: [ { t, att, se, ciLo, ciHi } ] },
  },
  cohorts: [Number], periods: [Number], nUnits: Number, n: Number,
  controlGroup: "nevertreated"|"notyettreated",
  basePeriod: "varying"|"universal",
  estMethod: "dr"|"reg"|"ipw",
  anticipation: Number,
  inference: { method: "bootstrap"|"analytic", nBoot: Number, seed: Number, critVal: Number },
  ptestWald: { stat, df, p } | null,
  warnings: [String],
  error: undefined,            // or a string on failure (existing convention)
}
```

`critVal` is the uniform critical value from the bootstrap (≈ 2.7 in the Rmd example) used for simultaneous bands; for `method:"analytic"` it is `1.959964`. `ciLo/ciHi` on every estimate use `est ± critVal·se`.

---

## Task 1: Math foundations — `drdid.js` 2×2 building block

**Files:**
- Create: `src/math/did/drdid.js`
- Create: `src/math/did/index.js` (barrel)
- Test: `src/math/__validation__/drdidValidation.js`
- Test (R, Franco runs): `src/math/__validation__/drdidValidation.R`

**What it computes.** For one 2×2 comparison (cohort vs control, period `t` vs base `b`):

`compute2x2({ deltaY, D, X, estMethod, weights })` where
- `deltaY` = array of `Y_t − Y_b` for the pooled treated+control sample,
- `D` = array 0/1 (1 = treated cohort, 0 = control),
- `X` = array of covariate row-vectors **including a leading 1 intercept** (for `~1`, each row is `[1]`),
- `estMethod ∈ {"dr","reg","ipw"}`,
- `weights` = per-unit sampling weights (default all 1).

Returns `{ att: Number, inf: Float64Array }` where `inf[i]` is the influence-function contribution of pooled-sample unit `i` such that `Var(att) = mean(inf²)/n` and `att ≈ mean(inf) + att` (centered IF; `mean(inf)=0`).

**Point-estimate formulas (Sant'Anna-Zhao panel):**
```
ps   = (estMethod==="reg") ? 0 : logit(D ~ X)  → π̂(Xᵢ)            // reuse runLogit
out  = (estMethod==="ipw") ? 0 : OLS(deltaY ~ X on D==0, w=weights·(1-D)) predicted for all  // Xβ̂
w1ᵢ  = weightsᵢ · Dᵢ
w0ᵢ  = (estMethod==="reg") ? weightsᵢ·(1-Dᵢ)            // reg: simple control mean
        : weightsᵢ · π̂ᵢ·(1-Dᵢ)/(1-π̂ᵢ)                   // ipw/dr: Abadie weight
ηᵢ   = deltaYᵢ − outᵢ            // (out=0 ⇒ ipw uses raw deltaY)
att  = Σ(w1ᵢ·ηᵢ)/Σw1ᵢ − Σ(w0ᵢ·ηᵢ)/Σw0ᵢ
```
- `reg` ⇒ `η = deltaY − Xβ̂`, weights w1=D, w0=(1−D); att = mean_T(η)−mean_C(η). (With OR, mean_C(η)=0 by OLS normal equations, so att = mean_T(deltaY − Xβ̂).)
- `ipw` ⇒ `out=0`, att = weighted mean diff with Abadie weights.
- `dr` ⇒ both; the locally efficient Sant'Anna-Zhao estimator.

**Influence function — PORT `DRDID::drdid_panel`'s `att.inf.func` EXACTLY.** Do not improvise. The DR IF has three additive parts: the treated term, the control term, and the **estimation-correction terms** for the OLS coefficients (β̂) and the logit coefficients (π̂). Transcribe from the published `DRDID` source (file `R/drdid_panel.R`). For `reg`, drop the propensity-correction term and set π̂ such that w0=(1−D); for `ipw`, drop the OR-correction term and set out=0. The unit test below pins all three methods to the R function to 4dp — if your IF is wrong, that test fails, which is the whole point.

- [ ] **Step 1: Write the failing JS harness** `src/math/__validation__/drdidValidation.js`

```js
import { compute2x2 } from "../did/drdid.js";

// Deterministic 2-period synthetic sample: 6 treated, 6 control, 1 covariate.
// Fixtures (att + se) come from DRDID::drdid_panel — see drdidValidation.R.
const SAMPLE = {
  deltaY: [1.9,2.1,1.7,2.3,2.0,1.8,  0.4,0.6,0.5,0.3,0.7,0.5],
  D:      [1,1,1,1,1,1,                0,0,0,0,0,0],
  X:      [[1,0.2],[1,0.5],[1,-0.1],[1,0.8],[1,0.3],[1,0.0],
           [1,1.1],[1,0.9],[1,1.4],[1,1.0],[1,1.2],[1,0.7]],
};
// PLACEHOLDER fixtures — replace with DRDID output (Step 6):
const R = { reg: { att: NaN, se: NaN }, ipw: { att: NaN, se: NaN }, dr: { att: NaN, se: NaN } };

export function runDrdidValidation() {
  const rows = [];
  for (const m of ["reg","ipw","dr"]) {
    const { att, inf } = compute2x2({ ...SAMPLE, estMethod: m, weights: SAMPLE.D.map(()=>1) });
    const n = inf.length;
    let s2 = 0; for (let i=0;i<n;i++) s2 += inf[i]*inf[i];
    const se = Math.sqrt(s2)/n;
    rows.push({ method:m, att:+att.toFixed(6), seJS:+se.toFixed(6),
                attR:R[m].att, seR:R[m].se,
                okAtt: Math.abs(att-R[m].att)<1e-4, okSE: Math.abs(se-R[m].se)<1e-4 });
  }
  console.table(rows);
  if (typeof window!=="undefined"){ window.__validation=window.__validation??{}; window.__validation.drdid=rows; }
  return rows;
}
if (typeof process!=="undefined" && process.argv?.[1]?.includes("drdidValidation")) runDrdidValidation();
```

- [ ] **Step 2: Run it, confirm it fails** — `node src/math/__validation__/drdidValidation.js` → fails (compute2x2 not defined / NaN fixtures).

- [ ] **Step 3: Implement `compute2x2`** in `src/math/did/drdid.js`. Reuse `runLogit` (NonLinearEngine) for the propensity and the existing OLS solver (LinearEngine — import the matrix-solve helper, or inline a small `(XᵀWX)⁻¹XᵀWy`). Implement point estimate per the formulas above and the IF per the ported `DRDID::drdid_panel`. No React imports. Export `compute2x2`. Add `export { compute2x2 } from "./drdid.js";` to `src/math/did/index.js`.

- [ ] **Step 4: Write the R fixture script** `src/math/__validation__/drdidValidation.R`:

```r
# Franco runs: Rscript src/math/__validation__/drdidValidation.R   (needs install.packages("DRDID"))
library(DRDID)
deltaY <- c(1.9,2.1,1.7,2.3,2.0,1.8, 0.4,0.6,0.5,0.3,0.7,0.5)
D      <- c(rep(1,6), rep(0,6))
covX   <- c(0.2,0.5,-0.1,0.8,0.3,0.0, 1.1,0.9,1.4,1.0,1.2,0.7)
Xm     <- cbind(1, covX)
for (m in c("reg","ipw","dr")) {
  fn <- switch(m, reg=reg_did_panel, ipw=std_ipw_did_panel, dr=drdid_panel)
  out <- fn(y1=deltaY+0, y0=rep(0,length(deltaY)), D=D, covariates=Xm, inffunc=TRUE)
  # NOTE: drdid_panel expects y1,y0 (levels). To feed deltaY directly, set y0=0,y1=deltaY.
  se <- sqrt(mean(out$att.inf.func^2)/length(D))
  cat(sprintf('%s: att=%.6f se=%.6f\n', m, out$ATT, se))
}
```
(Franco: if the `y1/y0` shim misbehaves, build a true 2-period frame and call `drdid_panel` normally; paste the printed `att`/`se` into `R` in `drdidValidation.js`.)

- [ ] **Step 5: Commit** — `git add src/math/did/ src/math/__validation__/drdid* && git commit -m "feat(did): doubly-robust 2x2 building block (reg/ipw/dr) + IF"`

- [ ] **Step 6 (Franco):** run `drdidValidation.R`, paste fixtures into `drdidValidation.js`, run `runDrdidValidation()` → all `okAtt`/`okSE` true. **Review gate.**

---

## Task 2: Base-period, control-group, and (g,t) enumeration — `staggeredDiD.js` part 1

**Files:**
- Create: `src/math/did/staggeredDiD.js`
- Test: extend `src/math/__validation__/callawayValidation.js` (add `suiteBasePeriod`)

**Spec — pin the exact arithmetic (this is bug #2).** Inputs: sorted unique times `tlist`, sorted cohorts `glist` (finite first-treat values that have ≥1 pre-period; cohorts equal to `tlist[0]` are dropped with a warning), anticipation `δ`, `basePeriod`, `controlGroup`.

For each cohort `g` and each comparison period `t ∈ tlist`:
- effective start `gStar = g − δ`.
- **post** iff `t ≥ gStar`.
- **base period `b`:**
  - `universal`: `b = largest tlist value < gStar`.
  - `varying`: post ⇒ `b = largest tlist value < gStar`; pre (`t < gStar`) ⇒ `b = tlist value immediately before t`.
- Skip the cell if `b` is undefined (no earlier period) or `t === b`.
- `universal` only: also emit the reference cell `t = (largest tlist < gStar)` as `{att:0, se:0, isRef:true}` so `e=−1` renders as the normalized 0.
- event time `e = t − g`; `isPre = t < gStar`.

**Control set for `(g,t)` (period pair `{t,b}`):**
- `nevertreated`: units with `G = ∞` (never treated).
- `notyettreated`: units with `G > max(t,b)` **and** `G ≠ g` (not yet treated by the later period, excluding the focal cohort). Include never-treated in this set.
- If `nevertreated` requested but none exist: fall back to `notyettreated` and push a warning.

Functions to export from `staggeredDiD.js` in this task:
- `enumerateCells({ tlist, glist, anticipation, basePeriod })` → `[{ g, t, b, e, isPre, isRef }]`
- `controlSet({ units, g, t, b, controlGroup })` → `{ eids:[...], warning?:String }` (units = `Map<eid, G>`)

- [ ] **Step 1: Failing test** — add to `callawayValidation.js`:

```js
import { enumerateCells } from "../did/staggeredDiD.js";
function suiteBasePeriod() {
  // tlist 1..4, cohorts 2,3,4 (the did sim). Varying base.
  const cells = enumerateCells({ tlist:[1,2,3,4], glist:[2,3,4], anticipation:0, basePeriod:"varying" });
  // For g=2: t=1 pre (b=undefined→skip? t=1 has no earlier → skip), t=3 post b=1, t=4 post b=1.
  //   e=-1 for g=2 is t=1 → no earlier period → NOT estimable, so g=2 has no e=-1 cell.
  // For g=3: t=2 pre b=1 (e=-1), t=1 pre → skip(no earlier), t=4 post b=2.
  const g3 = cells.filter(c=>c.g===3);
  const ok = g3.some(c=>c.e===-1 && c.b===1 && c.isPre) && g3.some(c=>c.t===4 && c.b===2 && !c.isPre);
  console.log(ok ? "  ✓ varying base g=3 ok" : "  ✗ varying base g=3 WRONG", g3);
  return { pass: ok?1:0, fail: ok?0:1 };
}
```

- [ ] **Step 2: Run, confirm fail** (`enumerateCells` undefined).
- [ ] **Step 3: Implement** `enumerateCells` + `controlSet` in `staggeredDiD.js` (pure JS).
- [ ] **Step 4: Run `runCallawayCSValidation()` in browser console**, confirm `suiteBasePeriod` passes.
- [ ] **Step 5: Commit** — `git commit -am "feat(did): base-period + control-group enumeration (varying/universal, never/notyet)"`. **Review gate.**

---

## Task 3: Aggregations + inference — `staggeredDiD.js` part 2

**Files:**
- Modify: `src/math/did/staggeredDiD.js`
- Test: extend `callawayValidation.js`

**Input.** A collection `cells2x2 = [{ g, t, e, isPre, isRef, att, inf }]` where `inf` is a length-`nUnits` Float64Array (the `(g,t)` IF mapped onto the **full unit universe**, zeros for unaffected units), already produced by the orchestrator (Task 4). `groupProb = Map<g, P(G=g)>` over **treated** units; `n = nUnits`.

**Aggregation point estimates (CS 2021 §4):**
```
simple    : weights wₖ ∝ n_g over post cells (t≥g);  overall = Σ wₖ·attₖ
dynamic(e): θ(e) = Σ_g 1{g+e observed}·ATT(g,g+e)·P(G=g | g+e observed);  overall = mean_{e≥0} θ(e)
group(g)  : θ_S(g) = mean_{t≥g} ATT(g,t);  overall = Σ_g θ_S(g)·P(G=g)
calendar  : θ_C(t) = mean_{g≤t} ATT(g,t);  overall = mean_t θ_C(t)
```
Only post cells (`!isPre`) enter aggregations. `dynamic.byE` includes pre `e<0` placebos too (estimated, for the event-study plot), but `dynamic.overall` averages only `e≥0`.

**Aggregation influence function — PORT `did::aggte` (`compute.aggte`).** For a linear combination `θ = Σₖ wₖ·attₖ` with **estimated** weights `wₖ` (functions of the cohort shares `p_g`), the IF is:
```
inf^θᵢ = Σₖ wₖ·infₖᵢ  +  Σₖ attₖ·(∂wₖ/∂p)·(1{Gᵢ=g(k)} − p_{g(k)})
```
The second term (weight-estimation correction) is required to match `did`'s SE to 4dp — do not omit it. Transcribe the exact `∂wₖ/∂p` expressions from `did`'s `compute.aggte.R` for each `type`. (For `simple` with fixed external weights the second term vanishes; for `dynamic`/`group`/`calendar` it does not.) `se = sqrt(mean(inf^θ²)/n)`.

**Inference:**
- `analytic`: `se` as above; `critVal = 1.959964`.
- `bootstrap` (default, Mammen): draw `B` (default 999) i.i.d. Mammen multipliers `Vᵢ ∈ {−(√5−1)/2 w.p. (√5+1)/(2√5), (√5+1)/2 else}` per **unit**, seeded (default 42, use a small deterministic PRNG — reuse the LCG pattern already in `callawayValidation.js`). For each draw and each parameter, `boot = (1/n)Σᵢ Vᵢ·inf^θᵢ`. SE = IQR-based robust scale `( q(0.75)−q(0.25) ) / (z_{0.75}−z_{0.25})` of the bootstrap draws (this is exactly what `did` uses — `mboot.R`). **Uniform crit value:** for a family of parameters, compute `max_k |bootₖ| / seₖ` per draw; `critVal = quantile_{0.95}` of that max statistic. Pointwise CI uses per-param `se`; simultaneous band uses `critVal·se`.

Export: `aggregate({ cells2x2, groupProb, n, inference })` → the `aggregations` + `inference` + per-cell `se/ciLo/ciHi` on the `attgt` cells, and `ptestWald` (joint Wald that all `isPre && !isRef` cells = 0, using their stacked IF covariance).

- [ ] **Step 1: Failing test** — synthetic DGP suite already in `callawayValidation.js` (`suiteSyntheticDGP`): assert `aggregations.dynamic.byE` has `e=0 ≈ 0.4`, `group.overall` finite, every `se>0`, and `inference.critVal ≥ 1.96`. Add those asserts.
- [ ] **Step 2: Run, confirm current code fails** (new fields absent).
- [ ] **Step 3: Implement** `aggregate(...)` with the four aggregations, the ported aggregation-IF, the Mammen bootstrap, uniform crit value, and the Wald pre-test.
- [ ] **Step 4: Run `runCallawayCSValidation()`**, confirm green.
- [ ] **Step 5: Commit** — `git commit -am "feat(did): 4 aggregations + analytic/Mammen-bootstrap inference + uniform bands + PT Wald"`. **Review gate.**

---

## Task 4: Rewrite the orchestrator — `CallawayEngine.js`

**Files:**
- Rewrite: `src/math/CallawayEngine.js`
- Verify: `src/math/index.js` still `export { runCallawayCS } from "./CallawayEngine.js";`

**Signature (keep back-compatible names, add new args):**
```js
export function runCallawayCS(rows, {
  yCol, entityCol, timeCol, treatCol, treatBinCol,
  xCols = [],                               // NEW: covariate columns (~1 ⇒ [])
  compGroup = "nevertreated",
  basePeriod = "varying",                   // NEW
  estMethod = "dr",                         // NEW
  anticipation = 0,                         // NEW
  relMin = -Infinity, relMax = Infinity,
  inference = { method: "bootstrap", nBoot: 999, seed: 42 },  // NEW
}, seOpts = {}) { ... }
```

**Algorithm:**
1. Resolve `entityFirstTreat` (reuse current logic for `treatCol`/`treatBinCol`; `0/null/""/Inf/NaN` ⇒ never).
2. Guard: if `rows.length > 200000` return `{ error: "Callaway-Sant'Anna runs in-browser on the full panel; ~"+rows.length+" rows is too large. Aggregate to a coarser unit/period first." }`.
3. Build balanced panel: keep units observed in **all** `tlist` periods; push a warning with the dropped count if any. Index `Y[eid][t]`, `X[eid][t]` (covariate row incl. intercept; base-period values are used at differencing time).
4. `tlist`, `glist` (drop first-period cohort with warning), `units = Map<eid,G>`, `nUnits`, `groupProb`.
5. `cells = enumerateCells(...)`. For each non-ref cell: build the treated+control 2×2 sample (treated = cohort `g` units with both `Y[t]`,`Y[b]`; control via `controlSet`), `deltaY`, `D`, `X` (base-period covariate values, with intercept), call `compute2x2`; map the returned per-sample `inf` onto a length-`nUnits` Float64Array by eid. If the cell can't be computed (too few, singular) ⇒ push warning, set `att=NaN`, skip from aggregation. Small-group warning if any group `< nCov + 5` (mirror the Rmd rule).
6. Filter `attgt` to `relMin..relMax` for display only (aggregations always use all post cells; the event-study `byE` respects the window).
7. `aggregate(...)`; assemble the result contract. Set `n` = total kept observations, `nUnits`, `cohorts=glist`, `periods=tlist`.

- [ ] **Step 1:** Update `suiteSyntheticDGP` in `callawayValidation.js` to call the new signature (`xCols:[]`, `estMethod:"reg"`, `basePeriod:"varying"`) and assert: cohort-2004 post `ATT≈0.5`, cohort-2006 post `≈0.3`, pre-trends `≈0`, `dynamic.byE e=0 ≈0.4`, `group.overall` in `[0.3,0.55]`, all `se>0`.
- [ ] **Step 2:** Run `runCallawayCSValidation()` — fails against old engine shape.
- [ ] **Step 3:** Rewrite `CallawayEngine.js` per the algorithm. Pure JS, no React.
- [ ] **Step 4:** Run `runCallawayCSValidation()` — all suites green. `npm run build` + `npm run lint:undef` clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(did): rewrite Callaway-Sant'Anna orchestrator (covariates, base periods, est methods, anticipation)"`. **Review gate.**

---

## Task 5: Wrapper — `EstimationResult.js`

**Files:** Modify `src/math/EstimationResult.js` (`wrapCallawayCS` ~L826).

Map the new contract; **keep `beta/se/varNames/testStats/pVals` populated** from the entry's default aggregation so `CoeffTable`/`ExportBar`/comparison buffer keep working. Add a `defaultView` param (`"group"|"dynamic"`, from the spec) controlling which aggregation fills `beta` and the banner.

- [ ] **Step 1:** Edit `wrapCallawayCS(eng, spec)`:

```js
function wrapCallawayCS(eng, spec) {
  const view = spec?.csDefaultView === "dynamic" ? "dynamic" : "group";
  const agg = eng.aggregations ?? {};
  // coefficient table = dynamic event-study series (most informative); banner uses `view` overall
  const es = agg.dynamic?.byE ?? [];
  return {
    ...base("CallawayCS", spec),
    varNames:  es.map(d => `e=${d.e}`),
    beta:      clean(es.map(d => d.att)),
    se:        clean(es.map(d => d.se)),
    testStats: clean(es.map(d => (d.se ? d.att / d.se : null))),
    testStatLabel: "z",
    pVals:     clean(es.map(d => twoSidedNormalP(d.se ? d.att/d.se : 0))),  // reuse existing normPVal helper if present
    n: eng.n ?? 0, df: eng.df ?? (eng.n ?? 0), units: eng.nUnits ?? null,
    att:   agg[view]?.overall ?? null,
    attSE: agg[view]?.se ?? null,
    attT:  agg[view]?.se ? agg[view].overall / agg[view].se : null,
    attP:  agg[view]?.se ? twoSidedNormalP(agg[view].overall / agg[view].se) : null,
    resid: [], Yhat: [],
    aggregations: eng.aggregations ?? null,
    attgt: eng.attgt ?? [],
    csCohorts: eng.cohorts ?? [], csNGroups: (eng.cohorts ?? []).length || null,
    csCompGroup: eng.controlGroup ?? "nevertreated",
    csBasePeriod: eng.basePeriod, csEstMethod: eng.estMethod, csAnticipation: eng.anticipation,
    csInference: eng.inference ?? null, csDefaultView: view,
    ptestWald: eng.ptestWald ?? null, warnings: eng.warnings ?? [],
    converged: true, iterations: null,
  };
}
```
(If `twoSidedNormalP` doesn't exist in this file, add a tiny local helper using the Abramowitz-Stegun approx already present in `CallawayEngine.js`, or import a shared one.)

- [ ] **Step 2:** `npm run build` + `lint:undef` clean.
- [ ] **Step 3: Commit** — `git commit -am "feat(did): map full CS contract in wrapCallawayCS (keep beta/se back-compat)"`. **Review gate.**

---

## Task 6: Sidebar reorg — `EstimatorSidebar.jsx`

**Files:** Modify `src/components/modeling/EstimatorSidebar.jsx` (`MODELS` ~L19, `GROUP_ORDER` ~L48); verify the render loop groups by `groups[]`.

**Changes:**
1. Add optional `groups: string[]` to MODELS items (fallback to `[group]`).
2. New `GROUP_ORDER = ["Linear","Panel","DiD","Event Study","Count outcomes","IV","RD","Spatial","Synthetic"]`.
3. Edit registry rows:
   - `FE`,`FD`,`LSDV` → `group:"Panel"` (unchanged).
   - Remove `TWFE`,`EventStudy`,`CallawayCS` from `"Panel"`.
   - `DiD` (2×2): `group:"DiD"`.
   - `TWFE`: `groups:["DiD"]`, label stays `"TWFE DiD"`.
   - `EventStudy`: `groups:["Event Study"]`, label `"Classical (TWFE)"`.
   - ADD `SunAbraham`: `{ id:"SunAbraham", label:"Sun-Abraham", groups:["DiD","Event Study"], desc:"Sun & Abraham (2021) interaction-weighted event study — panel required", color:"#6ec8b4" }` (engine already exists in dispatch/helpers).
   - `CallawayCS`: `groups:["DiD","Event Study"]`.
   - ADD `CHDiD` (planned/dimmed): `{ id:"CHDiD", label:"Staggered DiD (CH)", groups:["DiD"], desc:"de Chaisemartin & D'Haultfœuille — coming soon", color:"#6ec8b4", planned:true }`.
4. In the render loop, iterate `m.groups ?? [m.group]` so an estimator renders under each group; pass the clicked group up via `onSelect(id, group)`. Render `planned:true` items dimmed and non-clickable (mirror the existing disabled-state styling).
5. In `helpers.js`, confirm `SunAbraham:true` is in the availability map (it is). Add `CHDiD:false` (planned).

- [ ] **Step 1:** Apply the registry + GROUP_ORDER edits.
- [ ] **Step 2:** Thread `onSelect(id, group)` → ModelingTab stores `csDefaultView = group === "Event Study" ? "dynamic" : "group"` (Task 7 consumes it).
- [ ] **Step 3:** `npm run build` + `lint:undef`. Manually confirm in browser the three groups render, SunAb appears, CHDiD is dimmed.
- [ ] **Step 4:** Update `APP_CAPABILITY_MAP` in `src/services/AI/appCapabilityMap.js` so the coach knows the new groups (CLAUDE.md working convention).
- [ ] **Step 5: Commit** — `git commit -am "feat(modeling): reorg estimator menu into Panel/DiD/Event Study; surface Sun-Abraham; add CH placeholder"`. **Review gate.**

---

## Task 7: Config + dispatch wiring

**Files:** Modify `src/components/modeling/ModelConfiguration.jsx` (`CallawayCSConfig` ~L424), `src/components/ModelingTab.jsx` (CS state + `csDefaultView`), `src/components/modeling/runners/estimationDispatch.js` (CallawayCS branch ~L296).

**ModelingTab new state** (place next to `csTreatCol` etc.): `csXCols=[]`, `csEstMethod="dr"`, `csBasePeriod="varying"`, `csAnticipation="0"`, `csInfMethod="bootstrap"`, `csNBoot="999"`, `csSeed="42"`, `csDefaultView="group"`. Add all to the `estimate` useCallback dependency array (stale-closure bug class — see CLAUDE.md "Key bugs fixed").

**CallawayCSConfig** — add below the existing controls:
- Covariates X: a `VarPanel` (`multi`) over numeric cols excluding y/treat/entity/time, bound to `csXCols`.
- `est_method` chips: dr / reg / ipw → `csEstMethod`.
- `base_period` chips: varying / universal → `csBasePeriod`.
- `anticipation` number input → `csAnticipation`.
- Inference: chips bootstrap / analytic → `csInfMethod`; when bootstrap, show `nBoot` + `seed` number inputs.

**Dispatch** — extend the CallawayCS branch to pass the new args and `csDefaultView` into `wrapResult`:
```js
const res = runCallawayCS(dataRows, {
  yCol:y, entityCol:ecol, timeCol:timeColCS, treatCol:tcol,
  xCols: csXCols, compGroup: csCompGroup, basePeriod: csBasePeriod,
  estMethod: csEstMethod, anticipation: Number(csAnticipation)||0,
  relMin: ..., relMax: ...,
  inference: { method: csInfMethod, nBoot: Number(csNBoot)||999, seed: Number(csSeed)||42 },
}, seOpts);
if (!res || res.error) return { error: res?.error ?? "Callaway-Sant'Anna estimation failed." };
return { result: wrapResult("CallawayCS", res, {
  yVar:y, xVars:csXCols, wVars:expW, entityCol:ecol, timeCol:timeColCS, treatCol:tcol,
  compGroup:csCompGroup, csDefaultView }), panelFE:null, panelFD:null };
```
Pass the new props into `CallawayCSConfig` at both call sites (~L877 and ~L881).

- [ ] **Step 1:** Add state + deps in ModelingTab.
- [ ] **Step 2:** Extend `CallawayCSConfig` UI + props.
- [ ] **Step 3:** Extend dispatch branch.
- [ ] **Step 4:** `npm run build` + `lint:undef`. Browser: run CS with `~X`, dr, varying — confirm no crash and result returns.
- [ ] **Step 5: Commit** — `git commit -am "feat(modeling): CS config (covariates/est_method/base/anticipation/inference) + dispatch wiring"`. **Review gate.**

---

## Task 8: Plots — `didPlots.jsx`

**Files:** Create `src/components/modeling/plots/didPlots.jsx`; modify `ModelingTab.jsx` CS results block (~L2528).

Follow the **ggplot2-plot-design skill** conventions already used in this repo (SVG, theme colors `C.teal`/`C.red`/`C.blue`/`C.gold`, `T` typography, responsive via the existing plot pattern in `ModelPlots.jsx`). Export four components, all consuming the contract:

- `GroupTimePlot({ attgt, critVal })` — small-multiples faceted by cohort `g`; x = time `t`; point + CI bar per cell; **red** for `isPre`, **blue** for post; horizontal zero line; CI = `att ± critVal·se`. This is the `ggdid(att_gt)` plot Litux lacks.
- `EventStudyDynamicPlot({ byE, critVal })` — x = event time `e`; dashed reference at `e=−1`; red pre / blue post; ribbon or bars for the uniform band.
- `GroupAggPlot({ byG, critVal })` — horizontal: one row per cohort with point + band.
- `CalendarAggPlot({ byT, critVal })` — line/point by calendar period with band.

**ModelingTab CS block:** replace the single `EventCoeffsPlot` with: header badges (n, cohorts, periods, control, est_method, base), an Overall-ATT banner (from `aggregations[csDefaultView]`, with uniform band), a parallel-trends Wald line (`ptestWald`), a warnings list, and a 5-tab plot/table switcher (reuse the existing `PlotSelector` component) ordered per `csDefaultView` (DiD entry → Group-time first; Event-Study entry → Event study first): `Group-time ATT(g,t)`, `Event study`, `Group`, `Calendar`, `ATT(g,t) table` (a `CoeffTable` over `attgt`). Keep the existing `ExportBar`.

- [ ] **Step 1:** Create `didPlots.jsx` with the four components (full SVG implementations).
- [ ] **Step 2:** Rewire the CS results block to the tabbed layout + banner + Wald + warnings.
- [ ] **Step 3:** `npm run build` + `lint:undef`. Browser: confirm all four plots render and the default tab follows the menu entry.
- [ ] **Step 4: Commit** — `git commit -am "feat(modeling): ggdid-style group-time/dynamic/group/calendar plots + tabbed CS results"`. **Review gate.**

---

## Task 9: Export (replication fidelity)

**Files:** Modify `src/services/export/rScript.js`, `stataScript.js`, `pythonScript.js` (CS branches — search `Callaway`/`CallawayCS`).

R (faithful, primary):
```r
library(did)
out <- att_gt(yname="<y>", gname="<treat>", idname="<entity>", tname="<time>",
              xformla=~<X or 1>, data=<df>, control_group="<nevertreated|notyettreated>",
              base_period="<varying|universal>", anticipation=<δ>, est_method="<dr|reg|ipw>")
summary(out); aggte(out, type="dynamic"); aggte(out, type="group"); aggte(out, type="calendar"); aggte(out, type="simple")
```
Stata `csdid` and Python `csdid`/`differences` best-effort with the same args. Pull config from the wrapped result fields (`csEstMethod`, `csBasePeriod`, `csAnticipation`, `csCompGroup`, `xVars`).

- [ ] **Step 1:** Implement the three CS export branches.
- [ ] **Step 2:** Browser: open CodeEditor on a CS result, confirm R script reflects chosen args.
- [ ] **Step 3: Commit** — `git commit -am "feat(export): faithful did::att_gt + aggte R/Stata/Python export for CS"`. **Review gate.**

---

## Task 10: Validation harness + skill docs

**Files:**
- Rewrite `src/math/__validation__/callawayRValidation.R` (Franco runs).
- Update `src/math/__validation__/callawayValidation.js` (R-fixture suite).
- Create `.claude/skills/Estimators/staggered-did/math.md`, `algorithm.md`, `tests.md`.

`callawayRValidation.R`: generate fixtures from **both** the Rmd `build_sim_dataset(reset.sim())` DGP (set seed; `xformla=~X`) **and** `mpdta` (`xformla=~1`), across `est_method ∈ {dr,reg}` × `control ∈ {never,notyet}` × `base ∈ {varying,universal}`, printing `att_gt` cells + all four `aggte` types with `bstrap=FALSE, cband=FALSE` (deterministic, for tight SE matching) **and** the default bootstrap `critVal` for band checks. Stamp `meta.source = "R did <version>"` in the emitted JSON (avoid circular benchmarks). `callawayValidation.js`: load fixtures, compare engine to 6dp coef / 4dp SE (analytic), and assert `critVal>1.96` structurally.

`math.md` (the ATT(g,t), DR 2×2, aggregations, IF), `algorithm.md` (the exact base-period index arithmetic + control-set rules + bootstrap), `tests.md` (the fixtures + tolerances) — these satisfy the Estimators skill Step-0 requirement and the Estimators `CLAUDE.md` workflow.

- [ ] **Step 1:** Write the three skill docs.
- [ ] **Step 2:** Rewrite the R script + JS fixture suite.
- [ ] **Step 3: Commit** — `git commit -am "test(did): R-fixture validation harness + staggered-did skill docs"`.
- [ ] **Step 4 (Franco):** run `callawayRValidation.R`, paste fixtures, run `runCallawayCSValidation()` → all green to 6dp/4dp. Update `CLAUDE.md` estimator table CS row to "validated vs R did". Flip the ClaudePlan index row to DONE. **Final review gate.**

---

## Self-review checklist (done before handing over)
- **Spec coverage:** every §-item in the design spec maps to a task — DR/reg/ipw (T1), base/control (T2), 4 aggregations + bootstrap + Wald (T3), orchestrator + covariates + anticipation + 200k guard (T4), contract/back-compat (T5), UI reorg + SunAb + CH placeholder (T6), config/dispatch (T7), 4 plots + tabbed panel (T8), export (T9), validation + skill docs (T10). ✓
- **No silent drops:** T4 step 5 + T3 small-group rule push warnings. ✓
- **Stale-closure guard:** T7 step 1 adds all new state to the `estimate` dep array. ✓
- **Naming consistency:** `compute2x2`, `enumerateCells`, `controlSet`, `aggregate`, contract field names are used identically across T1-T8. ✓
- **The two hard IFs** (DR 2×2, aggregation weight-correction) are pinned by R-fixture tests (T1 step 6, T10 step 4), not improvised. ✓
