# DuckDB Fase 5 — DiD (2×2 + TWFE) + Event Study Sufficient-Statistics Push-Down

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push DiD 2×2, TWFE DiD, and Event Study into DuckDB-Wasm for n ≥ 50k. **No new engines required** — these three estimators reduce to OLS or TWFE on a design matrix augmented with synthetic SQL-generated columns (`treat × post`, event-time dummies). Fase 5 is mostly about **emitting the correct `dummySQL` payload** and routing through the existing Fase 1 (OLS) and Fase 4 (TWFE) SQL paths.

**Architecture rationale:**

- **DiD 2×2** (`runDiDSyn`-style: `y ~ post + treat + post×treat [+ controls]`) → OLS with one synthetic `CASE WHEN post=1 AND treat=1 THEN 1 ELSE 0 END` regressor. Falls onto **Fase 1 OLS SQL path** unchanged. SE: classical / HC0–HC3 (Fase 1) + clustered-by-entity (Fase 2).
- **TWFE DiD** (`y ~ treat_post | id + year`) → TWFE with one synthetic `treat_post` regressor. Falls onto **Fase 4 TWFE SQL path** unchanged. SE: classical / HC0 / HC1 (Fase 4 scope).
- **Event Study** (`y ~ Σ_k 1[t − t_treat = k] | id + year`, k ∈ {−K_pre, …, −1, +1, …, +K_post}) → TWFE with `K_pre + K_post` synthetic event-time dummies (the reference period k = −1 or k = 0 is omitted). Falls onto **Fase 4 TWFE SQL path** with `xColsExpanded` consisting entirely of CASE-WHEN dummies. The `K_THRESHOLD` check rejects horizons that explode k.

**Key insight:** the Fase 1 `expandFactors` mechanism already accepts a `dummySQL` map and substitutes CASE-WHEN expressions for named columns. Fase 5 piggybacks on it — we just generate the right map for each estimator.

**Tech Stack:** DuckDB-Wasm 0.10, JS matrix helpers from `LinearEngine.js`, validation against R `fixest::feols` (TWFE DiD + Event Study) and `lm` (DiD 2×2) + `sandwich::vcovHC` at 6 / 4 dp.

---

## File Structure

**Create:**
- `src/services/data/duckdbDiDSynthetic.js` — `buildDiD2x2Synthetic({postCol, treatCol, controls})` returns `{xColsExpanded, dummySQL}` for the OLS path. `buildEventStudySynthetic({timeCol, treatTimeCol, kPre, kPost, refK, treatCol})` returns the event-study `{xColsExpanded, dummySQL}` for the TWFE path.
- `src/services/data/__validation__/fase5RValidation.R` — generates `fase5_data.csv` + `fase5Benchmarks.json` for DiD 2×2, TWFE DiD, Event Study.
- `src/services/data/__validation__/fase5Validation.js` — `runFase5NumericalValidation()` exposed at `window.__validation.fase5`.

**Modify:**
- `src/services/data/dispatchConfig.js` — add `"DiD2x2"`, `"TWFEDiD"`, `"EventStudy"` to `SQL_SUPPORTED_ESTIMATORS`.
- `src/services/data/duckdbDispatch.js` — add panel-style operand guards for the three new estimators. DiD2x2 needs `postCol`, `treatCol`; TWFEDiD needs `treatCol`, `unitCol`, `timeCol`, `treatTimeCol`; Event Study needs the same plus `kPre`, `kPost`.
- `src/components/ModelingTab.jsx` — branches for the three estimators; each calls the matching `buildXxxSynthetic` helper, then delegates to the existing OLS (Fase 1) or TWFE (Fase 4) branch.

**Invariants preserved:**
- No new engine code. No new solver. The math runs through existing Fase 1 / Fase 4 paths.
- `EstimationResult` shape unchanged — consumers of `runDiD2x2` / `runTWFEDiD` / `runEventStudy` (the JS engines in `PanelEngine.js`) see the same fields.
- `expandFactors` is **not modified**. We construct `dummySQL` and `xColsExpanded` directly, by-passing factor expansion (no `factor(...)` regex involved).

---

## Task 1: Extend dispatcher

**Files:**
- Modify: `src/services/data/dispatchConfig.js`
- Modify: `src/services/data/duckdbDispatch.js`

- [ ] **Step 1: Add estimators to supported set**

```js
export const SQL_SUPPORTED_ESTIMATORS = new Set([
  "OLS", "2SLS", "WLS", "FE", "FD", "TWFE",
  "DiD2x2", "TWFEDiD", "EventStudy",
]);
```

- [ ] **Step 2: Extend `ctx` schema (JSDoc only, top of `duckdbDispatch.js`)**

```
//   postCol:       string | null  — DiD post indicator (required for DiD2x2)
//   treatCol:      string | null  — DiD treatment indicator (required for DiD2x2, TWFEDiD, EventStudy)
//   treatTimeCol:  string | null  — entity's treatment time (required for EventStudy and TWFEDiD with staggered timing)
//   kPre:          number | null  — event-study pre periods (required for EventStudy)
//   kPost:         number | null  — event-study post periods (required for EventStudy)
//   controls:      string[]       — optional control covariates (DiD2x2)
```

- [ ] **Step 3: Add operand guards**

After the existing panel guard block (`if (["FE", "FD", "TWFE"].includes(ctx.estimator)) { ... }`), add:

```js
  if (ctx.estimator === "DiD2x2") {
    if (!ctx.postCol || !ctx.treatCol) return false;
    if (!["classical", "HC0", "HC1", "HC2", "HC3"].includes(se)) return false;
    if (ctx.hasWeights) return false;
  }
  if (ctx.estimator === "TWFEDiD") {
    if (!ctx.treatCol || !ctx.unitCol || !ctx.timeCol) return false;
    // staggered → treatTimeCol; canonical 2×2 → can pass null and use treatCol×post as the interaction
    if (!["classical", "HC0", "HC1"].includes(se)) return false;
    if (ctx.hasWeights) return false;
  }
  if (ctx.estimator === "EventStudy") {
    if (!ctx.treatCol || !ctx.unitCol || !ctx.timeCol || !ctx.treatTimeCol) return false;
    if (typeof ctx.kPre !== "number" || typeof ctx.kPost !== "number") return false;
    if (ctx.kPre < 0 || ctx.kPost < 0) return false;
    // Total horizon dummies = kPre + kPost (reference period dropped). Must respect K_THRESHOLD.
    if ((ctx.kPre + ctx.kPost) > K_THRESHOLD) return false;
    if (!["classical", "HC0", "HC1"].includes(se)) return false;
    if (ctx.hasWeights) return false;
  }
```

- [ ] **Step 4: Verify in DevTools**

```js
shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: [],
  estimator: "DiD2x2", seType: "HC1",
  postCol: "post", treatCol: "treat",
})
// Expected: true

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: [],
  estimator: "EventStudy", seType: "classical",
  treatCol: "treat", unitCol: "id", timeCol: "year", treatTimeCol: "t_treat",
  kPre: 4, kPost: 4,
})
// Expected: true

shouldUseSQLPath({
  ...,
  estimator: "EventStudy", kPre: 60, kPost: 60,
})
// Expected: false (horizon exceeds K_THRESHOLD=100)
```

- [ ] **Step 5: Commit**

```bash
git add src/services/data/dispatchConfig.js src/services/data/duckdbDispatch.js
git commit -m "feat(modeling): Fase 5 — dispatcher recognizes DiD2x2 / TWFEDiD / EventStudy"
```

---

## Task 2: `duckdbDiDSynthetic.js` — emit `dummySQL` for each estimator

**Files:**
- Create: `src/services/data/duckdbDiDSynthetic.js`

The whole point: convert `(postCol, treatCol, kPre, kPost, ...)` into `{xColsExpanded, dummySQL}` that the existing Fase 1 / Fase 4 builders consume verbatim.

- [ ] **Step 1: Write the helpers**

```js
// ─── ECON STUDIO · src/services/data/duckdbDiDSynthetic.js ────────────────────
// Convert DiD / Event-Study configurations into the (xColsExpanded, dummySQL)
// payload consumed by buildOLSSuffStats / buildWithinSuffStats.
//
// No SQL execution. Pure string assembly + (for EventStudy) a small aux query
// to validate the event-time range is sane.

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }

/**
 * DiD 2×2: y ~ post + treat + post×treat [+ controls]
 *
 * Generates one synthetic regressor: post_treat = CASE WHEN post=1 AND treat=1 THEN 1 ELSE 0.
 * The two main effects (post, treat) and any controls remain as ordinary regressors.
 *
 * @returns {{ xColsExpanded: string[], dummySQL: Record<string,string>, attIdx: number, varNames: string[] }}
 */
export function buildDiD2x2Synthetic({ postCol, treatCol, controls = [] }) {
  if (!postCol || !treatCol) throw new Error("DiD2x2: postCol and treatCol required");
  const interName = "__did_post_x_treat";
  const dummySQL = {
    [interName]: `CASE WHEN ${esc(postCol)} = 1 AND ${esc(treatCol)} = 1 THEN 1 ELSE 0 END`,
  };
  // Order matches PanelEngine.run2x2DiD return shape: [post, treat, post×treat, ...controls]
  const xColsExpanded = [postCol, treatCol, interName, ...controls];
  const varNames = ["(Intercept)", "Post", "Treated", "Post × Treated (ATT)", ...controls];
  return { xColsExpanded, dummySQL, attIdx: 3, varNames };
}

/**
 * TWFE DiD: y ~ treat_post | id + year
 *
 * For canonical 2-period 2-group DiD, treat_post = treat × post.
 * For staggered timing, treat_post = 1[t >= treatTimeCol AND treated_ever=1].
 * We support both by branching on whether postCol or treatTimeCol is provided.
 *
 * @returns {{ xColsExpanded: string[], dummySQL: Record<string,string>, attIdx: number, varNames: string[] }}
 */
export function buildTWFEDiDSynthetic({ treatCol, postCol = null, treatTimeCol = null, timeCol = null }) {
  if (!treatCol) throw new Error("TWFEDiD: treatCol required");
  const interName = "__twfedid_treat_post";
  let interSQL;
  if (postCol) {
    interSQL = `CASE WHEN ${esc(treatCol)} = 1 AND ${esc(postCol)} = 1 THEN 1 ELSE 0 END`;
  } else if (treatTimeCol && timeCol) {
    // Staggered: treated_ever × (t >= treatTime). treatCol = 1 for ever-treated units.
    // For never-treated units treatTimeCol IS NULL, so the comparison returns NULL → 0 by COALESCE.
    interSQL = `CASE WHEN ${esc(treatCol)} = 1 AND ${esc(timeCol)} >= COALESCE(${esc(treatTimeCol)}, 1e18) THEN 1 ELSE 0 END`;
  } else {
    throw new Error("TWFEDiD: provide either postCol OR (treatTimeCol AND timeCol)");
  }
  const dummySQL = { [interName]: interSQL };
  // TWFE absorbs entity + time FE, so the only regressor is the interaction.
  return {
    xColsExpanded: [interName],
    dummySQL,
    attIdx: 1,   // [intercept (absorbed in TWFE return shape), treat_post]
    varNames: ["(Intercept)", "Treat × Post (ATT)"],
  };
}

/**
 * Event Study: y ~ Σ_k D_k | id + year
 *
 * D_k = 1[t − t_treat = k AND treated_ever = 1]   for k ∈ {-kPre, …, -1, +1, …, +kPost}
 *
 * The reference period (k = -1 by convention; pass refK to override) is omitted —
 * its coefficient is implicitly 0.
 *
 * Edge cases:
 *   - Never-treated units (treatTimeCol IS NULL) contribute D_k = 0 for all k.
 *     This is the "control" cohort in the standard event-study formulation.
 *   - End-points (t − t_treat < -kPre or > +kPost) get D_k = 0 for all k.
 *     Coefficients are local to the [-kPre, +kPost] window.
 *
 * @returns {{ xColsExpanded: string[], dummySQL: Record<string,string>, attIdx: null, varNames: string[], eventTimes: number[] }}
 */
export function buildEventStudySynthetic({ timeCol, treatTimeCol, treatCol, kPre, kPost, refK = -1 }) {
  if (!timeCol || !treatTimeCol || !treatCol) {
    throw new Error("EventStudy: timeCol, treatTimeCol, treatCol all required");
  }
  if (kPre < 0 || kPost < 0) throw new Error("EventStudy: kPre and kPost must be ≥ 0");

  const dummySQL = {};
  const xColsExpanded = [];
  const eventTimes = [];
  for (let k = -kPre; k <= kPost; k++) {
    if (k === refK) continue;
    eventTimes.push(k);
    const name = `__es_k_${k < 0 ? `m${-k}` : `p${k}`}`;
    // (t − t_treat = k) only for treated cohort
    dummySQL[name] = `CASE WHEN ${esc(treatCol)} = 1 AND (${esc(timeCol)} - ${esc(treatTimeCol)}) = ${k} THEN 1 ELSE 0 END`;
    xColsExpanded.push(name);
  }
  const varNames = ["(Intercept)", ...xColsExpanded.map(n => {
    const sign = n.includes("_m") ? "-" : "+";
    const num  = n.replace(/^__es_k_[mp]/, "");
    return `D[t ${sign} ${num}]`;
  })];

  return { xColsExpanded, dummySQL, attIdx: null, varNames, eventTimes };
}
```

- [ ] **Step 2: Unit-test the helpers in DevTools (string assertions, no SQL execution)**

```js
const m = await import("./services/data/duckdbDiDSynthetic.js");

const d1 = m.buildDiD2x2Synthetic({ postCol: "post", treatCol: "treat", controls: ["age"] });
console.assert(d1.xColsExpanded.length === 4);
console.assert(d1.dummySQL["__did_post_x_treat"].includes("CASE WHEN"));

const d2 = m.buildTWFEDiDSynthetic({ treatCol: "treat", postCol: "post" });
console.assert(d2.xColsExpanded.length === 1);

const d3 = m.buildEventStudySynthetic({
  timeCol: "year", treatTimeCol: "t0", treatCol: "treat",
  kPre: 3, kPost: 3, refK: -1,
});
console.assert(d3.xColsExpanded.length === 6);  // 3 pre (k=-3,-2) + 3 post (k=+1,+2,+3) — k=-1 dropped, total 5? Recount.
// Actually: k ∈ {-3,-2,-1,0,+1,+2,+3} minus refK=-1 → {-3,-2,0,+1,+2,+3} = 6 dummies ✓
```

- [ ] **Step 3: Commit**

```bash
git add src/services/data/duckdbDiDSynthetic.js
git commit -m "feat(data): Fase 5 — synthetic dummySQL helpers for DiD / EventStudy"
```

---

## Task 3: Wire DiD 2×2 / TWFE DiD / EventStudy branches into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add imports**

```js
import {
  buildDiD2x2Synthetic, buildTWFEDiDSynthetic, buildEventStudySynthetic,
} from "../services/data/duckdbDiDSynthetic.js";
```

- [ ] **Step 2: Extend `dispatchCtx`**

Find `dispatchCtx` construction. Add fields based on existing ModelingTab state (`didPost`, `didTreat`, `eventKpre`, etc — match whatever identifiers are already used in the JS path for these estimators):

```js
        postCol:       didPost || null,
        treatCol:      didTreat || null,
        treatTimeCol:  treatTimeCol || null,
        kPre:          typeof eventKpre === "number" ? eventKpre : null,
        kPost:         typeof eventKpost === "number" ? eventKpost : null,
        controls:      didControls || [],
```

- [ ] **Step 3: Add three branches inside the SQL try block**

After the existing FE/FD/TWFE branch, add:

```js
          if (model === "DiD2x2") {
            const { xColsExpanded, dummySQL, varNames } = buildDiD2x2Synthetic({
              postCol: didPost, treatCol: didTreat, controls: didControls || [],
            });
            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded })) {
              throw new Error("DiD2x2: post-synth k exceeds threshold — fallback to JS");
            }
            // Route through OLS Fase 1 — same code as the existing OLS branch, but with our dummySQL.
            const key = makeCacheKey(duckTable, yVar[0], xColsExpanded);
            let suff = suffStatsCacheRef.current.get(key);
            if (!suff || !validateSuffStatsEntry(suff, xColsExpanded)) {
              const m = await measure(() => buildOLSSuffStats(duckTable, yVar[0], xColsExpanded, { dummySQL }));
              suff = m.result;
              suffStatsCacheRef.current.set(key, suff);
              logEstimate({ path: "sql", phase: "olsSuffStats-DiD2x2", n: rowCount, k: xColsExpanded.length, msTotal: m.ms });
            }
            // ... rest of OLS HC meat + runOLSFromSuffStats flow (factor out into a shared helper if desired).
            const r_cls = runOLSFromSuffStats({ suff, meat: null, hcType: null });
            let r;
            if (seTypeNorm === "classical") {
              r = r_cls;
            } else {
              // HC0–HC3 paths from Fase 1 — call computeHCMeat or computeHCMeatWithLeverage as appropriate
              const meatArgs = { tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL, beta: r_cls.beta };
              let meat;
              if (["HC0", "HC1"].includes(seTypeNorm)) {
                meat = (await computeHCMeat({ ...meatArgs, hcType: seTypeNorm })).meat;
              } else {
                meat = (await computeHCMeatWithLeverage({ ...meatArgs, Ainv: r_cls.Ainv, hcType: seTypeNorm })).meat;
              }
              const engineHcType = seTypeNorm === "HC1" ? "HC1" : null;
              r = runOLSFromSuffStats({ suff, meat, hcType: engineHcType });
            }
            // Rename variables to DiD2x2 convention before wrap
            r.varNames = varNames;
            const res = wrapResult("DiD2x2", r, { yVar: yVar[0], xVars: [didPost, didTreat], didPost, didTreat, attIdx: 3 });
            return { result: res, panelFE: null, panelFD: null };
          }

          if (model === "TWFEDiD") {
            const { xColsExpanded, dummySQL, varNames } = buildTWFEDiDSynthetic({
              treatCol: didTreat, postCol: didPost, treatTimeCol, timeCol: panelTime,
            });
            // Route through TWFE Fase 4 — reuse the existing TWFE branch logic with our dummySQL.
            // (Effectively: inline copy of the TWFE branch from Fase 4 Task 6 Step 3, with
            // xColsExpanded/dummySQL coming from our synthetic helper instead of expandFactors.)
            if (!await isBalancedPanel({ tableName: duckTable, unitCol: panelUnit, timeCol: panelTime })) {
              throw new Error("TWFEDiD: unbalanced panel — fallback to JS");
            }
            const key = makeCacheKey(duckTable, yVar[0], xColsExpanded, null, null, "TWFE", panelUnit, panelTime);
            let suff = suffStatsCacheRef.current.get(key);
            if (!suff || !validateSuffStatsEntry(suff, xColsExpanded, null, null, "TWFE")) {
              const m = await measure(() => buildWithinSuffStats({
                tableName: duckTable, yCol: yVar[0], xCols: xColsExpanded,
                unitCol: panelUnit, timeCol: panelTime, mode: "TWFE", dummySQL,
              }));
              suff = m.result;
              suffStatsCacheRef.current.set(key, suff);
            }
            const r_cls = runTWFEFromSuffStats({ suff, meat: null, hcType: null });
            let r;
            if (seTypeNorm === "classical") {
              r = r_cls;
            } else {
              const { matInv } = await import("../math/LinearEngine.js");
              const Ainv = matInv(suff.XtX_dm);
              const betaFull = Ainv.map(row => row.reduce((s, w, j) => s + w * suff.XtY_dm[j], 0));
              const mm = await computeWithinHCMeat({
                tableName: duckTable, yCol: yVar[0], xCols: xColsExpanded,
                unitCol: panelUnit, timeCol: panelTime, mode: "TWFE", dummySQL,
                beta: betaFull, withinSQLOverride: suff.withinSQL,
              });
              const engineHcType = seTypeNorm === "HC1" ? "HC1" : null;
              r = runTWFEFromSuffStats({ suff, meat: mm.meat, hcType: engineHcType });
            }
            r.varNames = varNames.slice(1);   // TWFE strips intercept
            const res = wrapResult("TWFEDiD", r, { yVar: yVar[0], xVars: [didTreat], attIdx: 0 });
            return { result: res, panelFE: null, panelFD: null };
          }

          if (model === "EventStudy") {
            const { xColsExpanded, dummySQL, varNames, eventTimes } = buildEventStudySynthetic({
              timeCol: panelTime, treatTimeCol, treatCol: didTreat,
              kPre: eventKpre, kPost: eventKpost, refK: eventRefK ?? -1,
            });
            if (!await isBalancedPanel({ tableName: duckTable, unitCol: panelUnit, timeCol: panelTime })) {
              throw new Error("EventStudy: unbalanced panel — fallback to JS");
            }
            // Same as TWFEDiD branch above, but with EventStudy xColsExpanded + post-processing
            // to expose eventTimes on the result for ModelPlots.EventStudyPlot.
            // (Implementation analogous — copy-paste TWFEDiD branch above, replace dummySQL/varNames.)
            // After computing r, attach: r._eventTimes = eventTimes;
            // ...
            // [Fill in by analogy with TWFEDiD branch — same builder + solver + meat pattern]
            const res = wrapResult("EventStudy", r, { yVar: yVar[0], eventTimes, attIdx: null });
            return { result: res, panelFE: null, panelFD: null };
          }
```

- [ ] **Step 4: Manually test**

| Estimator   | SE         | Validate                                                  |
|-------------|------------|-----------------------------------------------------------|
| DiD2x2      | classical  | β + SE match `run2x2DiD` within 1e-8 / 1e-6              |
| DiD2x2      | HC2        | β + SE match Fase 1 OLS HC2 on the augmented design       |
| TWFEDiD     | classical  | β + SE match `runDiD` (or `runTWFE` with treat_post col)  |
| TWFEDiD     | HC1        | "                                                         |
| EventStudy  | classical  | β coefficients match `runEventStudy` on same panel        |
| EventStudy  | unbalanced | falls back to JS silently                                 |

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 5 — DiD2x2 / TWFEDiD / EventStudy SQL fast paths"
```

---

## Task 4: R validation script

**Files:**
- Create: `src/services/data/__validation__/fase5RValidation.R`

```r
suppressPackageStartupMessages({
  library(fixest); library(sandwich); library(lmtest); library(jsonlite)
})
set.seed(20260521)
N <- 100; T <- 20
n <- N * T
id <- rep(1:N, each = T); year <- rep(1:T, times = N)

# Stagger treatment: half treated at t=10, half never treated
treated_ever <- as.integer(id <= N/2)
t_treat <- ifelse(treated_ever == 1, 10, NA)
post <- as.integer(year >= 10 & treated_ever == 1)
treat_post <- treated_ever * post

alpha_i <- rnorm(N)[id]; lambda_t <- rnorm(T)[year]
y <- alpha_i + lambda_t + 0.5 * treat_post + rnorm(n)

df <- data.frame(id, year, treated_ever, t_treat, post, treat_post, y)
write.csv(df, "src/services/data/__validation__/fase5_data.csv", row.names = FALSE)

# DiD 2×2 (collapsed: only t ∈ {9, 10})
df_22 <- df[df$year %in% c(9, 10), ]
fit_22 <- lm(y ~ post + treated_ever + I(post * treated_ever), data = df_22)
b_22  <- coef(fit_22); se_22_cls <- sqrt(diag(vcov(fit_22)))
se_22_HC1 <- sqrt(diag(vcovHC(fit_22, type = "HC1")))

# TWFE DiD (full panel)
fit_twfe <- feols(y ~ treat_post | id + year, data = df)
b_twfe <- coef(fit_twfe)
se_twfe_cls <- sqrt(diag(vcov(fit_twfe, type = "iid")))
se_twfe_HC1 <- sqrt(diag(vcov(fit_twfe, type = "HC1")))

# Event Study
df$k <- ifelse(treated_ever == 1, year - t_treat, NA)
df$k[is.na(df$k)] <- -999   # never-treated sentinel
fit_es <- feols(y ~ i(k, ref = -1) | id + year, data = df[df$k != -999 | TRUE, ])
b_es <- coef(fit_es)
se_es_cls <- sqrt(diag(vcov(fit_es, type = "iid")))

bench <- list(
  DiD2x2 = list(beta = unname(b_22), se_classical = unname(se_22_cls), se_HC1 = unname(se_22_HC1)),
  TWFEDiD = list(beta = unname(b_twfe), se_classical = unname(se_twfe_cls), se_HC1 = unname(se_twfe_HC1)),
  EventStudy = list(beta = unname(b_es), se_classical = unname(se_es_cls), eventTimes = as.integer(names(b_es)))
)
write_json(bench, "src/services/data/__validation__/fase5Benchmarks.json", auto_unbox = TRUE, digits = 10)
```

- [ ] **Step 1: Run it**: `Rscript src/services/data/__validation__/fase5RValidation.R`
- [ ] **Step 2: Commit**: `git commit -m "test(data): Fase 5 — R golden values for DiD / EventStudy"`

---

## Task 5: Browser validation harness

**Files:**
- Create: `src/services/data/__validation__/fase5Validation.js`

Standard pattern (see Fase 4 Task 8). Loads `fase5_data.csv`, calls each synthetic helper + corresponding suff-stats builder + solver, compares against `fase5Benchmarks.json`. Exposed at `window.__validation.fase5`.

- [ ] Write harness, import, run, commit.

---

## Task 6: Update CLAUDE.md + design doc

- [ ] **Step 1:** Bump design-doc status line to include `Fase 5 (DiD + EventStudy) DONE (YYYY-MM-DD)`.
- [ ] **Step 2:** Append Fase 5 status block under `### Fase 5` in the spec.
- [ ] **Step 3:** Append Fase 5 sentence to CLAUDE.md item 2a.
- [ ] **Step 4:** Commit `docs: Fase 5 — DiD and EventStudy paths complete`.

---

## Self-review checklist

- **No new engine code.** ✅ — Fase 5 reuses Fase 1 `runOLSFromSuffStats` and Fase 4 `runTWFEFromSuffStats`.
- **`dummySQL` injection points already exist** in `buildOLSSuffStats` (Fase 1) and `buildWithinSuffStats` (Fase 4 Task 2 Step 1, `colExpr` handles `dummySQL` lookup). ✅
- **Reference period:** EventStudy drops `k = refK` (default −1) — matches the standard fixest::feols `i(k, ref = -1)` convention. ✅
- **Never-treated handling:** `CASE WHEN treat = 1 AND ...` returns 0 for never-treated, so they act as the control cohort with all event-time dummies = 0. ✅
- **Variable-name hedge:** Task 3 Step 2 acknowledges identifiers like `didPost`, `treatTimeCol`, `eventKpre` may differ in the current ModelingTab. Codex matches the existing JS-branch names rather than inventing.
- **Deferred:** clustered/HAC for DiD/TWFEDiD/EventStudy (depends on Fase 4b). Documented.
