# DuckDB Fase 6 — IRLS (Logit / Probit / Poisson FE) Sufficient-Statistics Push-Down

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push **Logit**, **Probit**, and **Poisson FE** estimation into DuckDB-Wasm for n ≥ 50k via per-iteration sufficient statistics. The IRLS loop runs in **JS** (5–10 iterations typical), but each iteration's heavy work — building the weighted X'WX, X'WY, and the score / log-likelihood aggregates — runs as a single SQL pass with the current `β` bound as prepared params. Never materialize the full Arrow table in JS.

**Architecture rationale:**

- **IRLS for GLMs** (Logit / Probit / Poisson with canonical link except Probit):
  - Per iteration: `μ_i = g⁻¹(x_i'β)`; weights `w_i` and working response `z_i` are functions of `μ_i` and the link.
  - Update: `β_new = (X'WX)⁻¹ X'WZ` where `Z` is the working response. Equivalent to weighted least squares on `(X, z, w)`.
  - **Sufficient statistics per iter:** `(X'WX, X'WZ, log-likelihood-contribution-sum)` — all aggregated in SQL with `β` bound as prepared params.
- **Convergence:** check `max |β_new − β_old| < tol` (default 1e-8) or `max_iter = 50`. If non-convergent → flag `_converged: false` and return last β (matches existing JS behavior in `NonLinearEngine.js`).
- **SE:** classical / robust uses the final `(X'WX)⁻¹` evaluated at the converged β. HC0/HC1 robust SE for GLMs uses meat `Σ êᵢ² · w_i · x_i x_j` where `ê_i = (y_i − μ̂_i)` (the score residual, NOT the working residual). This is the canonical sandwich for ML — matches `sandwich::vcovHC` on a `glm` object.
- **Poisson FE:** treat entity FE as ordinary dummies absorbed into the regressor list if `N_entities` is small. Otherwise: switch to **conditional Poisson** via the Hausman-Hall-Griliches transformation — but **that's deferred to Fase 6b** because it needs a different SQL pattern. Fase 6 ships only **unconditional Poisson with entity dummies as factor() columns**, capped at `N_THRESHOLD` entities post-expansion.

**Threshold reconsideration:** `N_THRESHOLD = 50_000` may be too low for IRLS — each iter costs 1 SQL roundtrip (~50–100 ms), so 8 iters × 75 ms = 600 ms total, vs. JS path at n = 50k taking ~200 ms. The dispatcher should require `n ≥ 200_000` for IRLS estimators. Add `N_THRESHOLD_IRLS` to `dispatchConfig.js`.

**Tech Stack:** DuckDB-Wasm 0.10, JS matrix helpers from `LinearEngine.js`, IRLS loop logic from `NonLinearEngine.js`. Validation against R `glm(family = binomial("logit" | "probit"))` and `glm(family = poisson)` at 6 / 4 dp.

---

## File Structure

**Create:**
- `src/services/data/duckdbIRLS.js` — `buildIRLSSuffStats({tableName, yCol, xCols, family, link, beta, dummySQL})` returns `{n, XtWX, XtWZ, logLik, devianceContrib, maxAbsScore}`. One SQL pass per iteration.
- `src/services/data/duckdbIRLSRobustSE.js` — `computeIRLSHCMeat({tableName, yCol, xCols, family, link, beta, dummySQL})` returns `{meat, n}`. HC0/HC1 via `Σ êᵢ² · w_i² · x_i x_j` (Huber sandwich form for GLMs).
- `src/math/IRLSSuffStatsEngine.js` — `runIRLSFromSuffStats({tableName, yCol, xCols, family, link, dummySQL, maxIter, tol, seType})` orchestrates the loop: starts at β = 0 (or warm-start from passed `betaInit`), iterates `buildIRLSSuffStats` + matInv + update, converges or fails, returns `EstimationResult` with `β`, classical SE from `(X'WX)⁻¹`, log-likelihood, McFadden R², deviance, optionally robust SE.
- `src/services/data/__validation__/fase6RValidation.R` — generates `fase6_data.csv` + `fase6Benchmarks.json` using R `glm()` for binomial (logit, probit) and poisson.
- `src/services/data/__validation__/fase6Validation.js` — `runFase6NumericalValidation()` exposed at `window.__validation.fase6`.

**Modify:**
- `src/services/data/dispatchConfig.js` — add `"Logit"`, `"Probit"`, `"PoissonFE"` to `SQL_SUPPORTED_ESTIMATORS`; add `N_THRESHOLD_IRLS = 200_000`; add `IRLS_MAX_ITER = 50`, `IRLS_TOL = 1e-8`.
- `src/services/data/duckdbDispatch.js` — IRLS-specific gating: use `N_THRESHOLD_IRLS` instead of `N_THRESHOLD` for these estimators.
- `src/components/ModelingTab.jsx` — branches for Logit / Probit / PoissonFE.
- `src/math/index.js` — re-export `runIRLSFromSuffStats`.

**Invariants preserved:**
- `src/math/NonLinearEngine.js` untouched. JS path authoritative for n < N_THRESHOLD_IRLS, non-convergence, families not supported (gamma, gaussian-identity already handled by OLS).
- `EstimationResult` from IRLS path matches `runLogit` / `runProbit` / `runPoissonFE` return shape: `{beta, se, tStats, pVals, varNames, logLik, McFaddenR2, deviance, df, _converged, _iter}`.

---

## Task 1: Extend dispatcher

**Files:**
- Modify: `src/services/data/dispatchConfig.js`
- Modify: `src/services/data/duckdbDispatch.js`

- [ ] **Step 1: Constants in `dispatchConfig.js`**

```js
export const N_THRESHOLD       = 50_000;
export const N_THRESHOLD_IRLS  = 200_000;  // higher bar for IRLS — each iter is a roundtrip
export const K_THRESHOLD       = 100;
export const IRLS_MAX_ITER     = 50;
export const IRLS_TOL          = 1e-8;
export const RESIDUAL_SAMPLE_SIZE = 5_000;
export const CACHE_MAX_ENTRIES = 50;

export const SQL_SUPPORTED_ESTIMATORS = new Set([
  "OLS", "2SLS", "WLS", "FE", "FD", "TWFE",
  "DiD2x2", "TWFEDiD", "EventStudy",
  "Logit", "Probit", "PoissonFE",
]);
```

- [ ] **Step 2: IRLS-specific n threshold in dispatcher**

In `duckdbDispatch.js`, replace the line `if (!(ctx.n >= N_THRESHOLD)) return false;` with:

```js
  const isIRLS = ["Logit", "Probit", "PoissonFE"].includes(ctx.estimator);
  const nGate = isIRLS ? N_THRESHOLD_IRLS : N_THRESHOLD;
  if (!(ctx.n >= nGate)) return false;
```

Update the import to include `N_THRESHOLD_IRLS`.

- [ ] **Step 3: IRLS operand + SE guard**

After the existing guards, add:

```js
  if (["Logit", "Probit", "PoissonFE"].includes(ctx.estimator)) {
    // Fase 6: classical + HC0/HC1 only
    if (!["classical", "HC0", "HC1"].includes(se)) return false;
    if (ctx.hasWeights) return false;
    if (ctx.estimator === "PoissonFE") {
      if (!ctx.unitCol) return false;
      // PoissonFE in Fase 6: unconditional via factor(id). Reject if N_entities huge —
      // best done by routing factor expansion through the existing K_THRESHOLD check.
    }
  }
```

- [ ] **Step 4: Verify in DevTools**

```js
shouldUseSQLPath({
  tableName: "t", n: 300000, xColsExpanded: ["x1","x2"],
  estimator: "Logit", seType: "HC1",
})
// Expected: true

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "Logit", seType: "HC1",
})
// Expected: false (n < N_THRESHOLD_IRLS = 200k)
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(modeling): Fase 6 — dispatcher recognizes Logit/Probit/PoissonFE with N_THRESHOLD_IRLS"
```

---

## Task 2: `buildIRLSSuffStats` — per-iteration weighted aggregates

**Files:**
- Create: `src/services/data/duckdbIRLS.js`

The single function below is family/link-aware: it generates the SQL expressions for `μ`, `w`, `z` based on `family + link`, then aggregates `X'WX`, `X'WZ`, log-likelihood, and the max-absolute-score in **one SQL pass**.

- [ ] **Step 1: Write the function**

```js
// ─── ECON STUDIO · src/services/data/duckdbIRLS.js ────────────────────────────
// Per-iteration sufficient statistics for IRLS-fit GLMs.
//
// Per iteration with current β:
//   η_i  = β0 + Σ_j β_j · x_ij                  (linear predictor)
//   μ_i  = g⁻¹(η_i)                              (link inverse)
//   w_i  = (∂μ/∂η)² / Var(μ)                    (IRLS weight)
//   z_i  = η_i + (y_i − μ_i) / (∂μ/∂η)          (working response)
//
// Families/links supported:
//   logit:    μ = 1/(1+exp(-η));  w = μ(1-μ);   ∂μ/∂η = μ(1-μ);   logLik = y·log(μ) + (1-y)·log(1-μ)
//   probit:   μ = Φ(η);            ∂μ/∂η = φ(η);  w = φ(η)² / (μ(1-μ));   logLik = y·log(μ) + (1-y)·log(1-μ)
//   poisson:  μ = exp(η);          w = μ;         ∂μ/∂η = μ;     logLik = y·η − μ − log(y!)   (drop log(y!) — constant in β)
//
// One SQL pass produces:
//   n
//   XtWX[(k+1) × (k+1)]  symmetric
//   XtWZ[(k+1)]
//   logLik (sum of contributions; constants dropped where they don't depend on β)
//   maxAbsScore (max of |y - μ| for convergence diagnostic / early-stop)

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) { return v == null ? NaN : (typeof v === "bigint" ? Number(v) : Number(v)); }

const SUPPORTED = new Set(["logit", "probit", "poisson"]);

/**
 * Returns SQL fragments for μ, w, z, logLik contribution given a family/link and the η expression.
 *
 * Note: probit uses DuckDB's `erfc` to compute Φ(η) = 0.5 * erfc(-η / sqrt(2)).
 * Logit uses the numerically stable `1 / (1 + exp(-η))` with `LEAST/GREATEST` clipping to avoid log(0).
 */
function irlsExprs(family, etaSQL, ySQL) {
  if (family === "logit") {
    const mu  = `LEAST(GREATEST(1.0 / (1.0 + exp(-(${etaSQL}))), 1e-12), 1.0 - 1e-12)`;
    const w   = `${mu} * (1.0 - ${mu})`;
    const dmu = w;
    const z   = `(${etaSQL}) + (${ySQL} - ${mu}) / ${dmu}`;
    const ll  = `${ySQL} * log(${mu}) + (1.0 - ${ySQL}) * log(1.0 - ${mu})`;
    return { mu, w, z, dmu, ll };
  }
  if (family === "probit") {
    // Φ(x) = 0.5 * (1 + erf(x / sqrt(2))) — DuckDB has erf
    const mu  = `LEAST(GREATEST(0.5 * (1.0 + erf((${etaSQL}) / sqrt(2.0))), 1e-12), 1.0 - 1e-12)`;
    const dmu = `(1.0 / sqrt(2.0 * pi())) * exp(-0.5 * (${etaSQL}) * (${etaSQL}))`;   // φ(η)
    const w   = `(${dmu}) * (${dmu}) / (${mu} * (1.0 - ${mu}))`;
    const z   = `(${etaSQL}) + (${ySQL} - ${mu}) / ${dmu}`;
    const ll  = `${ySQL} * log(${mu}) + (1.0 - ${ySQL}) * log(1.0 - ${mu})`;
    return { mu, w, z, dmu, ll };
  }
  if (family === "poisson") {
    const mu  = `exp(${etaSQL})`;
    const w   = mu;
    const dmu = mu;
    const z   = `(${etaSQL}) + (${ySQL} - ${mu}) / ${mu}`;
    const ll  = `${ySQL} * (${etaSQL}) - ${mu}`;  // drop log(y!) — constant in β
    return { mu, w, z, dmu, ll };
  }
  throw new Error(`irlsExprs: unsupported family ${family}`);
}

/**
 * @param {object} args
 * @param {string}   args.tableName
 * @param {string}   args.yCol
 * @param {string[]} args.xCols
 * @param {"logit"|"probit"|"poisson"} args.family
 * @param {number[]} args.beta            length k+1 (intercept first)
 * @param {Record<string,string>} [args.dummySQL]
 * @returns {Promise<{ n: number, XtWX: number[][], XtWZ: number[], logLik: number, maxAbsScore: number }>}
 */
export async function buildIRLSSuffStats({ tableName, yCol, xCols, family, beta, dummySQL = {} }) {
  if (!SUPPORTED.has(family)) throw new Error(`buildIRLSSuffStats: family ${family} not supported`);
  const { conn } = await getDuckDB();
  const k = xCols.length;
  const dim = k + 1;
  if (beta.length !== dim) throw new Error(`buildIRLSSuffStats: beta length ${beta.length} != dim ${dim}`);

  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  const yExpr  = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const xExprs = xCols.map(colExpr);
  const xRef   = (i) => i === 0 ? "1.0" : `_x_${i - 1}`;

  // η as bound β params
  const etaTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    etaTerms.push(`? * ${xRef(i)}`);
    betaParams.push(beta[i]);
  }
  const etaSQL = `(${etaTerms.join(" + ")})`;
  const { mu, w, z, ll } = irlsExprs(family, etaSQL, "_y_");

  // CTE: raw projection with finite filter; family-specific y validity check.
  const yValid = family === "poisson" ? `_y_ >= 0` : `_y_ IN (0, 1)`;   // logit/probit need 0/1
  const finite = [`isfinite(_y_)`, yValid];
  for (let i = 0; i < k; i++) finite.push(`isfinite(_x_${i})`);

  const projection = [`${yExpr} AS _y_`, ...xExprs.map((e, i) => `${e} AS _x_${i}`)];

  // Aggregates — upper-triangle X'WX, X'WZ, logLik, maxAbsScore
  const aggs = [`COUNT(*) AS n`];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(`SUM((${w}) * ${xRef(i)} * ${xRef(j)}) AS xwx_${i}_${j}`);
    }
  }
  for (let i = 0; i < dim; i++) {
    aggs.push(`SUM((${w}) * (${z}) * ${xRef(i)}) AS xwz_${i}`);
  }
  aggs.push(`SUM(${ll}) AS loglik`);
  aggs.push(`MAX(ABS(_y_ - (${mu}))) AS max_abs_score`);

  const sql = `
    WITH proj AS (
      SELECT ${projection.join(", ")}
      FROM ${esc(tableName)}
      WHERE ${finite.join(" AND ")}
    )
    SELECT ${aggs.join(", ")} FROM proj
  `;

  // Count occurrences of etaSQL/μ/w/z/ll references — each (i,j) aggregate inlines them
  // multiple times. We just bind β-params (η appears ~ aggCount × 1 in inner expressions
  // for logit/probit/poisson per the chosen substitutions).
  //
  // Safer than counting: bind β-params per occurrence of "? *" in `sql`.
  const qmarks = (sql.match(/\?/g) || []).length;
  const boundParams = new Array(qmarks);
  for (let i = 0; i < qmarks; i++) boundParams[i] = betaParams[i % dim];
  // Sanity: ensure each block of `dim` qmarks lines up with one η evaluation
  if (qmarks % dim !== 0) {
    throw new Error(`buildIRLSSuffStats: ? count ${qmarks} not divisible by dim ${dim}`);
  }

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const r = result.toArray()[0];

  const XtWX = Array.from({ length: dim }, () => Array(dim).fill(0));
  const XtWZ = Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const v = num(r[`xwx_${i}_${j}`]);
      XtWX[i][j] = v;
      if (i !== j) XtWX[j][i] = v;
    }
  }
  for (let i = 0; i < dim; i++) XtWZ[i] = num(r[`xwz_${i}`]);

  return {
    n: num(r.n),
    XtWX, XtWZ,
    logLik: num(r.loglik),
    maxAbsScore: num(r.max_abs_score),
  };
}
```

- [ ] **Step 2: Sanity smoke test**

```js
const { buildIRLSSuffStats } = await import("./services/data/duckdbIRLS.js");
// Start at β = 0 — should produce μ = 0.5 (logit) for all rows
const r = await buildIRLSSuffStats({
  tableName: "fase6_tbl", yCol: "y", xCols: ["x1","x2"], family: "logit",
  beta: [0, 0, 0],
});
console.log(r);
// Expected: XtWX symmetric, weights ~ 0.25 (since μ(1-μ) = 0.25 at μ=0.5), no NaN
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(data): Fase 6 — IRLS per-iteration sufficient-statistics SQL pass"
```

---

## Task 3: IRLS orchestrator + classical SE

**Files:**
- Create: `src/math/IRLSSuffStatsEngine.js`
- Modify: `src/math/index.js`

- [ ] **Step 1: Write the orchestrator**

```js
// ─── ECON STUDIO · src/math/IRLSSuffStatsEngine.js ────────────────────────────
// IRLS loop driver. Per iter: SQL-aggregated suff stats → matInv → update → check.
// Classical SE from final (X'WX)⁻¹. Robust SE via separate meat pass after convergence.
//
// Initialization:
//   logit/probit:  β0 = log(ȳ / (1-ȳ)), β_j = 0   (Greene)
//   poisson:       β0 = log(ȳ),         β_j = 0
//   (computed cheaply via a one-shot AVG aggregate before iter 0)
//
// Convergence:
//   max |β_new − β_old| < tol   OR   iter ≥ maxIter
//
// On non-convergence: return last β with _converged: false.

import { matInv, pValue } from "./LinearEngine.js";
import { buildIRLSSuffStats } from "../services/data/duckdbIRLS.js";

function vmul(M, v) { return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0)); }
function maxAbs(arr) { return arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0); }

async function initialBeta({ tableName, yCol, xCols, family, getYMean }) {
  const ybar = await getYMean({ tableName, yCol });
  const k = xCols.length;
  const beta = Array(k + 1).fill(0);
  if (family === "logit" || family === "probit") {
    const clamped = Math.min(Math.max(ybar, 1e-6), 1 - 1e-6);
    beta[0] = family === "logit"
      ? Math.log(clamped / (1 - clamped))
      : require_inverse_phi_here(clamped);   // see helper below
  } else if (family === "poisson") {
    beta[0] = Math.log(Math.max(ybar, 1e-6));
  }
  return beta;
}

// Φ⁻¹ via Beasley-Springer-Moro approximation (small JS helper — no DuckDB roundtrip)
function probitInverse(p) {
  // Acklam 2003 approximation, 1e-9 accuracy
  const a = [-3.969683028665376e+01,  2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00];
  const b = [-5.447609879822406e+01,  1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00];
  const d = [ 7.784695709041462e-03,  3.224671290700398e-01,  2.445134137142996e+00,
              3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= ph) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}
// Replace `require_inverse_phi_here` call above with `probitInverse(clamped)`.

/**
 * @param {object} args
 * @param {string}   args.tableName
 * @param {string}   args.yCol
 * @param {string[]} args.xCols
 * @param {"logit"|"probit"|"poisson"} args.family
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number}   [args.maxIter=50]
 * @param {number}   [args.tol=1e-8]
 * @param {(args: {tableName:string,yCol:string}) => Promise<number>} args.getYMean
 *        — caller injects a small "SELECT AVG(y) FROM table" helper, keeps the engine pure-ish
 * @returns {Promise<EstimationResult>}
 */
export async function runIRLSFromSuffStats({
  tableName, yCol, xCols, family, dummySQL = {},
  maxIter = 50, tol = 1e-8, getYMean,
}) {
  let beta = await initialBeta({ tableName, yCol, xCols, family, getYMean });
  let prev = beta.slice();
  let converged = false;
  let iter = 0;
  let lastSuff = null;
  let lastLogLik = -Infinity;
  let logLik0 = null;   // for McFadden R²

  // Null-model log-likelihood: fit intercept-only at iter 0 (one-shot)
  // For logit/probit: ll = n · (ȳ log ȳ + (1-ȳ) log(1-ȳ))
  // For poisson:      ll = Σ y_i · log(ȳ) - n·ȳ  (drop log(y!))
  // Compute analytically once — no extra SQL pass needed (we have ȳ from initialBeta).
  const ybar = await getYMean({ tableName, yCol });
  if (family === "logit" || family === "probit") {
    const c = Math.min(Math.max(ybar, 1e-12), 1 - 1e-12);
    // n needs to be known — we'll capture it on first iter from buildIRLSSuffStats
  } // else poisson: also need n + sum_y — capture from first iter

  while (iter < maxIter) {
    const suff = await buildIRLSSuffStats({ tableName, yCol, xCols, family, beta, dummySQL });
    lastSuff = suff;
    lastLogLik = suff.logLik;

    if (logLik0 === null) {
      // Compute null model log-likelihood using suff.n
      if (family === "logit" || family === "probit") {
        const c = Math.min(Math.max(ybar, 1e-12), 1 - 1e-12);
        logLik0 = suff.n * (c * Math.log(c) + (1 - c) * Math.log(1 - c));
      } else if (family === "poisson") {
        // ll_0 = n·ȳ·log(ȳ) − n·ȳ
        logLik0 = suff.n * (ybar * Math.log(Math.max(ybar, 1e-12)) - ybar);
      }
    }

    const Ainv = matInv(suff.XtWX);
    if (!Ainv) return { error: "IRLS: X'WX singular at iter " + iter };
    prev = beta.slice();
    beta = vmul(Ainv, suff.XtWZ);

    const delta = beta.map((b, i) => b - prev[i]);
    if (maxAbs(delta) < tol) { converged = true; iter++; break; }
    iter++;
  }

  if (!lastSuff) return { error: "IRLS: did not run any iterations" };

  // Final SE from (X'WX)⁻¹ evaluated at converged β
  const finalSuff = await buildIRLSSuffStats({ tableName, yCol, xCols, family, beta, dummySQL });
  const Ainv = matInv(finalSuff.XtWX);
  if (!Ainv) return { error: "IRLS: final X'WX singular" };

  const se = Ainv.map((row, i) => {
    const d = row[i];
    return isFinite(d) && d >= 0 ? Math.sqrt(d) : NaN;
  });
  const tStats = beta.map((b, i) => (isFinite(b) && se[i] > 0 ? b / se[i] : NaN));
  const k = xCols.length;
  const df = finalSuff.n - (k + 1);
  const pVals = tStats.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  const McFaddenR2 = logLik0 !== null && logLik0 !== 0
    ? 1 - finalSuff.logLik / logLik0
    : NaN;
  const deviance = -2 * finalSuff.logLik;

  return {
    beta, se, tStats, pVals,
    varNames: ["(Intercept)", ...xCols],
    n: finalSuff.n, df,
    logLik: finalSuff.logLik,
    logLik0,
    McFaddenR2,
    deviance,
    XtXinv: Ainv,
    _converged: converged,
    _iter: iter,
    _family: family,
    _suffFinal: finalSuff,   // exposed so the caller can attach robust SE without re-fitting
    _hasLazyResiduals: true,
    _isSample: false,
    _nFull: finalSuff.n,
  };
}
```

- [ ] **Step 2: Export from `src/math/index.js`**

```js
export { runIRLSFromSuffStats } from "./IRLSSuffStatsEngine.js";
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(math): Fase 6 — IRLS orchestrator with classical SE"
```

---

## Task 4: HC0/HC1 robust SE for GLMs

**Files:**
- Create: `src/services/data/duckdbIRLSRobustSE.js`

GLM sandwich: `V = A⁻¹ · B · A⁻¹` where `A = X'WX` (the IRLS final weighted Hessian — same one we already cached on `_suffFinal`) and `B = Σ êᵢ² xᵢxⱼ` with `êᵢ = y_i − μ̂_i` (the score residual). HC1 scales `B` by `n / (n − k)`.

- [ ] **Step 1: Write the meat builder**

```js
// ─── ECON STUDIO · src/services/data/duckdbIRLSRobustSE.js ────────────────────
// HC0/HC1 sandwich meat for GLM (Logit / Probit / Poisson) at converged β.
//
// meat[i][j] = Σ (y - μ̂)² · x_i · x_j
// where μ̂ is computed via the link inverse at β̂.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) { return v == null ? NaN : (typeof v === "bigint" ? Number(v) : Number(v)); }

function muSQL(family, etaSQL) {
  if (family === "logit")   return `LEAST(GREATEST(1.0 / (1.0 + exp(-(${etaSQL}))), 1e-12), 1.0 - 1e-12)`;
  if (family === "probit")  return `LEAST(GREATEST(0.5 * (1.0 + erf((${etaSQL}) / sqrt(2.0))), 1e-12), 1.0 - 1e-12)`;
  if (family === "poisson") return `exp(${etaSQL})`;
  throw new Error(`muSQL: family ${family}`);
}

export async function computeIRLSHCMeat({ tableName, yCol, xCols, family, beta, dummySQL = {} }) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  const dim = k + 1;

  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  const xExprs = xCols.map(colExpr);
  const xRef = (i) => i === 0 ? "1.0" : `_x_${i - 1}`;
  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const etaTerms = [], betaParams = [];
  for (let i = 0; i < dim; i++) {
    etaTerms.push(`? * ${xRef(i)}`);
    betaParams.push(beta[i]);
  }
  const etaSQL = `(${etaTerms.join(" + ")})`;
  const mu = muSQL(family, etaSQL);
  const residSQL = `(_y_ - (${mu}))`;

  const finite = [`isfinite(_y_)`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(_x_${i})`);

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(`SUM(POWER(${residSQL}, 2) * ${xRef(i)} * ${xRef(j)}) AS m_${i}_${j}`);
    }
  }

  const projection = [`${yExpr} AS _y_`, ...xExprs.map((e, i) => `${e} AS _x_${i}`)];
  const sql = `
    WITH proj AS (SELECT ${projection.join(", ")} FROM ${esc(tableName)} WHERE ${finite.join(" AND ")})
    SELECT ${aggs.join(", ")} FROM proj
  `;

  const qmarks = (sql.match(/\?/g) || []).length;
  if (qmarks % dim !== 0) throw new Error(`computeIRLSHCMeat: ? count ${qmarks} not divisible by dim ${dim}`);
  const bound = new Array(qmarks);
  for (let i = 0; i < qmarks; i++) bound[i] = betaParams[i % dim];

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...bound);
  await stmt.close();
  const r = result.toArray()[0];

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const v = num(r[`m_${i}_${j}`]);
      meat[i][j] = v;
      if (i !== j) meat[j][i] = v;
    }
  }
  return { meat, n: num(r.n) };
}
```

- [ ] **Step 2: Wire into the orchestrator (Task 3 file edit)**

In `IRLSSuffStatsEngine.js`, add an exported helper `applyRobustSEToIRLSResult({result, tableName, yCol, xCols, family, dummySQL, hcType})` that computes the meat, applies `V = Ainv · meat · Ainv` (with HC1 scaling), and overwrites `result.se`, `result.tStats`, `result.pVals`. Call site is in ModelingTab (Task 5).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(data): Fase 6 — HC0/HC1 sandwich meat for IRLS GLMs"
```

---

## Task 5: Wire Logit / Probit / PoissonFE branches into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add imports**

```js
import { runIRLSFromSuffStats, applyRobustSEToIRLSResult } from "../math/index.js";
import { computeIRLSHCMeat } from "../services/data/duckdbIRLSRobustSE.js";
```

- [ ] **Step 2: Define a `getYMean` helper inside ModelingTab**

```js
const getYMean = async ({ tableName, yCol }) => {
  const { conn } = await getDuckDB();
  const sql = `SELECT AVG(TRY_CAST("${yCol.replace(/"/g,'""')}" AS DOUBLE)) AS m FROM ${'"'+tableName.replace(/"/g,'""')+'"'} WHERE isfinite(TRY_CAST("${yCol.replace(/"/g,'""')}" AS DOUBLE))`;
  const r = (await conn.query(sql)).toArray()[0];
  return Number(r.m);
};
```

- [ ] **Step 3: Branch in the SQL try block**

```js
          if (["Logit", "Probit", "PoissonFE"].includes(model)) {
            const family = model === "Logit"    ? "logit"
                         : model === "Probit"   ? "probit"
                         : "poisson";

            // PoissonFE: append factor(unitCol) dummies via expandFactors
            let xColsForIRLS = xVars;
            let dummySQLForIRLS = {};
            if (model === "PoissonFE") {
              if (!panelUnit) throw new Error("PoissonFE: entity column not selected — fallback to JS");
              const expansion = await expandFactors({
                xCols: [...xVars, `factor(${panelUnit})`], tableName: duckTable,
              });
              xColsForIRLS    = expansion.xColsExpanded;
              dummySQLForIRLS = expansion.dummySQL;
              if (xColsForIRLS.length > K_THRESHOLD) {
                throw new Error("PoissonFE: post-expansion k > K_THRESHOLD — fallback to JS");
              }
            }

            const r_cls = await runIRLSFromSuffStats({
              tableName: duckTable, yCol: yVar[0], xCols: xColsForIRLS,
              family, dummySQL: dummySQLForIRLS, getYMean,
            });
            if (r_cls?.error) throw new Error(r_cls.error);
            if (!r_cls._converged) {
              console.warn(`${model} IRLS did not converge in ${r_cls._iter} iters — returning last β`);
            }

            let r = r_cls;
            if (["HC0", "HC1"].includes(seTypeNorm)) {
              const mm = await computeIRLSHCMeat({
                tableName: duckTable, yCol: yVar[0], xCols: xColsForIRLS,
                family, beta: r_cls.beta, dummySQL: dummySQLForIRLS,
              });
              const Ainv = r_cls.XtXinv;
              const scale = seTypeNorm === "HC1" ? r_cls.n / Math.max(1, r_cls.df) : 1;
              const meat = mm.meat.map(row => row.map(v => v * scale));
              // V = Ainv · meat · Ainv
              const { matMul } = await import("../math/LinearEngine.js");
              const V = matMul(matMul(Ainv, meat), Ainv);
              const se = V.map((row, i) => {
                const d = row[i];
                return isFinite(d) && d >= 0 ? Math.sqrt(d) : NaN;
              });
              const tStats = r_cls.beta.map((b, i) => (isFinite(b) && se[i] > 0 ? b / se[i] : NaN));
              const { pValue } = await import("../math/LinearEngine.js");
              const pVals = tStats.map(t => (isFinite(t) ? pValue(t, r_cls.df) : NaN));
              r = { ...r_cls, se, tStats, pVals };
            }

            const res = wrapResult(model, r, { yVar: yVar[0], xVars, family });
            return { result: res, panelFE: null, panelFD: null };
          }
```

- [ ] **Step 4: Manually test on n ≥ 200k dataset**

| Model     | SE         | Expected                                                                |
|-----------|------------|--------------------------------------------------------------------------|
| Logit     | classical  | β matches `glm(family=binomial)` within 1e-6                            |
| Logit     | HC1        | SE matches `sandwich::vcovHC(., "HC1")` within 1e-4                     |
| Probit    | classical  | β matches `glm(family=binomial("probit"))` within 1e-6                  |
| PoissonFE | classical  | β matches `glm(family=poisson, ..., + factor(id))` within 1e-6           |
| Logit     | n = 100k   | falls back to JS (n < N_THRESHOLD_IRLS)                                  |

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(modeling): Fase 6 — Logit / Probit / PoissonFE SQL fast paths"
```

---

## Task 6: R validation script

**Files:**
- Create: `src/services/data/__validation__/fase6RValidation.R`

```r
suppressPackageStartupMessages({
  library(sandwich); library(jsonlite)
})
set.seed(20260521)
n <- 50000   # smaller — R glm() chokes on 200k+ otherwise

x1 <- rnorm(n); x2 <- rnorm(n)
# Logit DGP
p_logit <- 1 / (1 + exp(-(0.5 + 1.0 * x1 - 0.5 * x2)))
y_logit <- rbinom(n, 1, p_logit)
# Probit DGP
p_probit <- pnorm(0.3 + 0.8 * x1 - 0.4 * x2)
y_probit <- rbinom(n, 1, p_probit)
# Poisson DGP
mu_pois <- exp(0.2 + 0.5 * x1 - 0.3 * x2)
y_pois <- rpois(n, mu_pois)

df <- data.frame(y_logit, y_probit, y_pois, x1, x2)
write.csv(df, "src/services/data/__validation__/fase6_data.csv", row.names = FALSE)

fit_lo <- glm(y_logit  ~ x1 + x2, data = df, family = binomial("logit"))
fit_pr <- glm(y_probit ~ x1 + x2, data = df, family = binomial("probit"))
fit_po <- glm(y_pois   ~ x1 + x2, data = df, family = poisson)

bench <- list(
  Logit  = list(beta = unname(coef(fit_lo)),
                se_classical = unname(sqrt(diag(vcov(fit_lo)))),
                se_HC1 = unname(sqrt(diag(vcovHC(fit_lo, "HC1")))),
                logLik = as.numeric(logLik(fit_lo)),
                deviance = deviance(fit_lo)),
  Probit = list(beta = unname(coef(fit_pr)),
                se_classical = unname(sqrt(diag(vcov(fit_pr)))),
                se_HC1 = unname(sqrt(diag(vcovHC(fit_pr, "HC1")))),
                logLik = as.numeric(logLik(fit_pr)),
                deviance = deviance(fit_pr)),
  Poisson = list(beta = unname(coef(fit_po)),
                 se_classical = unname(sqrt(diag(vcov(fit_po)))),
                 se_HC1 = unname(sqrt(diag(vcovHC(fit_po, "HC1")))),
                 logLik = as.numeric(logLik(fit_po)),
                 deviance = deviance(fit_po))
)
write_json(bench, "src/services/data/__validation__/fase6Benchmarks.json", auto_unbox = TRUE, digits = 10)
```

**Caveat on n:** the R glm fits run at n = 50k for speed, but the SQL path's dispatcher requires n ≥ 200k. For validation we either (a) lower `N_THRESHOLD_IRLS` to 50k inside the browser harness temporarily, or (b) call `runIRLSFromSuffStats` **directly** in the harness (bypassing the dispatcher gate, just like Fase 3 harnesses already do). Option (b) is the cleaner choice and matches existing fase3*Validation.js patterns.

- [ ] Run R, commit: `git commit -m "test(data): Fase 6 — R glm golden values for Logit/Probit/Poisson"`

---

## Task 7: Browser validation harness

**Files:**
- Create: `src/services/data/__validation__/fase6Validation.js`

Standard pattern. Call `runIRLSFromSuffStats` directly (bypass dispatcher), then `computeIRLSHCMeat` for HC1, compare to `fase6Benchmarks.json`. Tolerances: β at 1e-4 (IRLS converges to slightly different ε than R's glm — relax from the usual 1e-6 for non-linear), SE at 1e-3.

- [ ] Write, import, run `await window.__validation.fase6()`, commit.

---

## Task 8: Update docs

- [ ] Bump design-doc status line: `Fase 6 (IRLS) DONE`.
- [ ] Append Fase 6 status block under `### Fase 6` in the spec.
- [ ] Append Fase 6 sentence to CLAUDE.md item 2a.
- [ ] Commit: `docs: Fase 6 — IRLS GLMs (Logit/Probit/Poisson FE) complete`.

---

## Self-review checklist

- **Threshold raised** to 200k for IRLS estimators (each iter is a roundtrip). ✅
- **Family/link extensibility:** adding gamma / inverse-gaussian later is a one-function edit in `irlsExprs` + a SUPPORTED set check. Not in Fase 6 scope.
- **Convergence flag** propagates to the result and is surfaced as a warning in ModelingTab (Task 5 Step 3). ✅
- **Null-model log-likelihood** computed analytically from `ȳ` and `n` — no extra SQL pass. McFadden R² is exact. ✅
- **PoissonFE strategy:** unconditional via `factor(id)` columns through existing `expandFactors`. K_THRESHOLD rejection if too many entities → JS fallback. Conditional Poisson (HHG transformation) deferred to Fase 6b.
- **Robust SE convention:** Huber sandwich with score residuals `(y − μ̂)`, NOT working residuals. Matches `sandwich::vcovHC` on `glm` objects.
- **Probit Φ⁻¹** done with Acklam approximation in JS (1e-9 accuracy, no SQL roundtrip for initial β).
- **Deferred:** HC2/HC3, clustered, HAC for IRLS; conditional Poisson FE; multinomial / ordered logit; survival models (`coxph`) — all out of scope.
