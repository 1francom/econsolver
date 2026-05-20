# Fase 2 — Cluster + HAC + Remaining Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push one-way clustered SE, two-way CGM clustered SE, Newey-West HAC, White test, and Breusch-Godfrey into DuckDB SQL — completing the OLS inference surface in the SQL fast path. After Fase 2, the dispatcher accepts every SE variant `core/inference/robustSE.js` supports.

**Architecture:** Each robust-meat builder follows the Fase 1 pattern: a `mf` CTE materializes residuals `_e` and design columns `_x_i`, then downstream CTEs aggregate. β is bound as prepared-statement parameters. Cluster meats use one extra grouped CTE (score sums per cluster) then an outer SELECT for the outer-product. Two-way CGM bundles all three sub-meats in a single SQL pass. HAC adds `LAG(_e, l) OVER (...)` and per-lag aggregates. Small-sample corrections are applied inside the builder so `runOLSFromSuffStats` sees pre-scaled meat — engine stays unchanged (callers pass `hcType: null` for non-HC sandwiches).

**Tech Stack:** DuckDB-Wasm prepared statements, plain JS matrix algebra, existing `runOLSFromSuffStats` from Fase 1, `core/inference/robustSE.js` as the JS reference, validation harness in `src/services/data/__validation__/` (no Jest — `window.__validation.fase2` runs in the browser).

---

## File structure

```
src/services/data/
├── dispatchConfig.js               ← MOD: SQL_SUPPORTED_SE += {clustered, twoway, HAC}
├── duckdbDispatch.js               ← MOD: accept new SE types; require ctx.clusterVar etc.
├── duckdbClusterSE.js              ← NEW: countClusters, computeClusterMeat, computeTwowayClusterMeat
├── duckdbHACSE.js                  ← NEW: computeHACMeat (Newey-West, Bartlett kernel)
├── duckdbDiagnostics.js            ← MOD: + whiteTestSQL, + breuschGodfreySQL
└── __validation__/
    ├── fase2RValidation.R          ← NEW: generate clustered/HAC dataset + golden SEs
    ├── fase2Benchmarks.json        ← NEW: output of fase2RValidation.R
    ├── fase2_data.csv              ← NEW: dataset for browser-side runner
    └── fase2Validation.js          ← NEW: window.__validation.fase2 runner

src/components/
└── ModelingTab.jsx                 ← MOD: branch on clustered/twoway/HAC after β/Ainv

CLAUDE.md                           ← MOD: append Fase 2 entry under item 2a
docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md
                                    ← MOD: status line "Fase 0+1+2 DONE; Fases 3-7 pending"
```

**Reuse, do not duplicate:**
- `mf` CTE construction pattern from `duckdbDiagnostics.js:buildCTE()` — copied verbatim into new files.
- β-param replication trick (`sql.split(residSQL).length - 1`) from `duckdbRobustSE.js` — same idiom applies to `yhatSQL` in CTE form (count `FROM mf` references).
- Sandwich finalization (`V = Ainv · meat · Ainv`) inside existing `runOLSFromSuffStats` — meat builder pre-applies cluster/HAC small-sample corrections, sets `hcType: null` so engine doesn't apply HC1 scaling.

---

## Task 1: Extend `SQL_SUPPORTED_SE` in dispatchConfig

**Files:**
- Modify: `src/services/data/dispatchConfig.js`

- [ ] **Step 1: Update the Set and the Fase comment**

Replace the export block at the bottom of `dispatchConfig.js`:

```javascript
// Sets grow per fase as estimators / SE types get SQL coverage.
// Fase 0:  {OLS}, {classical}
// Fase 1: + HC0/HC1/HC2/HC3 + factor expansion
// Fase 2: + clustered, twoway, HAC (lowercase = matches UI seType)
export const SQL_SUPPORTED_ESTIMATORS = new Set(["OLS"]);
export const SQL_SUPPORTED_SE         = new Set([
  "classical",
  "HC0", "HC1", "HC2", "HC3",
  "clustered", "twoway", "HAC",
]);
```

Rationale: `ModelingTab.estimate()` already uppercases lowercase UI `hc1` → `HC1` before calling `shouldUseSQLPath`. Apply the same normalization to `clustered`/`twoway`/`hac` at the dispatch boundary (see Task 6) — but store the canonical form (lowercase for `clustered`/`twoway`, uppercase for `HAC` mirroring core/inference) in the set. Dispatcher then compares post-normalization values.

- [ ] **Step 2: Commit**

```bash
git add src/services/data/dispatchConfig.js
git commit -m "feat(data): Fase 2 — admit clustered/twoway/HAC into SQL_SUPPORTED_SE"
```

---

## Task 2: Extend the dispatcher gate

**Files:**
- Modify: `src/services/data/duckdbDispatch.js`

- [ ] **Step 1: Add required-arg checks for cluster/HAC**

Replace the entire `shouldUseSQLPath` function:

```javascript
export function shouldUseSQLPath(ctx) {
  if (!ctx.tableName) return false;
  if (!(ctx.n >= N_THRESHOLD)) return false;
  if (!Array.isArray(ctx.xColsExpanded) || ctx.xColsExpanded.length > K_THRESHOLD) return false;
  if (!SQL_SUPPORTED_ESTIMATORS.has(ctx.estimator)) return false;
  const se = ctx.seType ?? "classical";
  if (!SQL_SUPPORTED_SE.has(se)) return false;
  if (ctx.hasWeights) return false;

  // Cluster/HAC need their operand columns present; otherwise the SQL path
  // cannot run — fall back to JS so the engine returns "classical HC1" per
  // robustSE.js's existing degradation contract.
  if (se === "clustered" && !ctx.clusterVar) return false;
  if (se === "twoway"    && (!ctx.clusterVar || !ctx.clusterVar2)) return false;
  if (se === "HAC"       && !ctx.timeVar) return false;

  return true;
}
```

- [ ] **Step 2: Update the ctx-shape JSDoc header**

In the comment block near the top of `duckdbDispatch.js`, append three new fields after `hasFactors`:

```javascript
//   clusterVar:    string | null  — one-way cluster column (required when seType="clustered" or "twoway")
//   clusterVar2:   string | null  — second cluster column (required when seType="twoway")
//   timeVar:       string | null  — time column for HAC LAG ordering (required when seType="HAC")
```

- [ ] **Step 3: Verify Fase 0+1 paths still admit**

Run the existing dispatcher validation in the browser console:

```javascript
await window.__validation.dispatch?.()
```

Expected: all Fase 0/1 cases still pass (no regression).

- [ ] **Step 4: Commit**

```bash
git add src/services/data/duckdbDispatch.js
git commit -m "feat(data): Fase 2 — dispatcher admits cluster/HAC with operand-presence checks"
```

---

## Task 3: `duckdbClusterSE.js` — one-way clustered meat

**Files:**
- Create: `src/services/data/duckdbClusterSE.js`

**Math:** one-way clustered meat
- `s_g = Σ_{i∈g} e_i x_i` (per-cluster score, length k+1)
- `B_raw = Σ_g s_g s_g'`
- Small-sample correction: `B = B_raw × (G/(G-1)) × ((n-1)/(n-k))` — matches `core/inference/robustSE.js:clusteredSE` lines 168-169.

SQL strategy: two CTEs in a single statement.
- `mf` materializes `_y, _x_0..._x_k, _yhat, _e` (copied from `duckdbDiagnostics.js:buildCTE`).
- `clusters` groups `mf` by cluster column and projects `s_j = SUM(_e * _x_j)` for each j.
- Outer SELECT computes `G = COUNT(*)`, `n = SUM(cluster_size)`, and the `(k+1)(k+2)/2` upper-tri outer-product aggregates.

- [ ] **Step 1: Write the file shell**

Create `src/services/data/duckdbClusterSE.js`:

```javascript
// ─── ECON STUDIO · src/services/data/duckdbClusterSE.js ──────────────────────
// One-way and two-way (Cameron-Gelbach-Miller) clustered meat-matrix
// computation pushed into DuckDB.
//
// β is bound as prepared-statement parameters. Each cluster level contributes
// a score vector s_g = Σ_{i∈g} ê_i x_i computed in a single grouped CTE; the
// outer SELECT aggregates the outer-product s_g s_g' across clusters.
//
// Small-sample corrections are applied INSIDE this module so the engine sees
// pre-scaled meat. Callers pass `hcType: null` to runOLSFromSuffStats.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

// Reused mf-CTE builder — same shape as duckdbDiagnostics.buildCTE but exported
// privately here to keep cluster module standalone.
function buildMfCTE({ tableName, yCol, xColsExpanded, dummySQL = {}, beta }) {
  const k = xColsExpanded.length;
  const dim = k + 1;

  const xExpr = (i) => {
    if (i === 0) return "1.0";
    const name = xColsExpanded[i - 1];
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };
  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const baseProjections = [`${yExpr} AS _y`];
  for (let i = 0; i < dim; i++) baseProjections.push(`${xExpr(i)} AS _x_${i}`);

  const yhatTerms = [];
  const params   = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * _x_${i}`);
    params.push(beta[i]);
  }
  const yhatSQL = yhatTerms.join(" + ");

  const finite = [`isfinite(_y)`];
  for (let i = 0; i < dim; i++) finite.push(`isfinite(_x_${i})`);

  return { dim, params, yhatSQL, finiteSQL: finite.join(" AND "), baseProjections, tableNameEsc: esc(tableName) };
}
```

- [ ] **Step 2: Add `countClusters` preflight helper**

Append to the same file:

```javascript
/**
 * Cheap roundtrip: COUNT(DISTINCT cluster) — used by the dispatcher to detect
 * cluster degeneration (G > n/2 → fallback to JS path with classical HC1).
 *
 * @param {string} tableName
 * @param {string} clusterCol
 * @returns {Promise<{G:number, n:number}>}
 */
export async function countClusters(tableName, clusterCol) {
  const { conn } = await getDuckDB();
  const sql = `
    SELECT
      COUNT(DISTINCT ${esc(clusterCol)}) AS G,
      COUNT(*)                            AS n
    FROM ${esc(tableName)}
    WHERE ${esc(clusterCol)} IS NOT NULL
  `;
  const r = (await conn.query(sql)).toArray()[0];
  return { G: num(r.G), n: num(r.n) };
}
```

- [ ] **Step 3: Add `computeClusterMeat` (one-way)**

Append:

```javascript
/**
 * @param {object} args
 * @param {string}                    args.tableName
 * @param {string}                    args.yCol
 * @param {string[]}                  args.xColsExpanded
 * @param {Record<string,string>}     [args.dummySQL]
 * @param {number[]}                  args.beta            — length k+1, intercept first
 * @param {string}                    args.clusterCol
 * @returns {Promise<{meat:number[][], n:number, G:number}>}
 */
export async function computeClusterMeat({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, clusterCol,
}) {
  const { conn } = await getDuckDB();
  const { dim, params, yhatSQL, finiteSQL, baseProjections, tableNameEsc }
    = buildMfCTE({ tableName, yCol, xColsExpanded, dummySQL, beta });

  // Per-cluster score sums  s_g_j = SUM(_e * _x_j)
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) {
    scoreAggs.push(`SUM(_e * _x_${j}) AS s_${j}`);
  }

  // Outer-product upper-tri aggregates: SUM(s_j * s_l) across clusters
  const meatAggs = [];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      meatAggs.push(`SUM(s_${j} * s_${l}) AS m_${j}_${l}`);
    }
  }

  const sql = `
    WITH base AS (
      SELECT ${baseProjections.join(", ")}, ${esc(clusterCol)} AS _g
      FROM ${tableNameEsc}
    ),
    mf AS (
      SELECT *,
             (${yhatSQL}) AS _yhat,
             _y - (${yhatSQL}) AS _e
      FROM base
      WHERE ${finiteSQL} AND _g IS NOT NULL
    ),
    clusters AS (
      SELECT _g, COUNT(*) AS _cn, ${scoreAggs.join(", ")}
      FROM mf
      GROUP BY _g
    )
    SELECT
      COUNT(*)        AS G,
      SUM(_cn)        AS n,
      ${meatAggs.join(", ")}
    FROM clusters
  `;

  // yhatSQL appears twice inside mf CTE → bind params twice.
  const fromMfCount = (sql.match(/\(\s*\?\s*\*\s*_x_0\s/g) || []).length;
  const boundParams = [];
  for (let i = 0; i < fromMfCount; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const G = num(r.G);
  const n = num(r.n);
  const k = dim;  // number of parameters
  const scale = (G / (G - 1)) * ((n - 1) / (n - k));

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = num(r[`m_${j}_${l}`]) * scale;
      meat[j][l] = v;
      if (j !== l) meat[l][j] = v;
    }
  }
  return { meat, n, G };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/data/duckdbClusterSE.js
git commit -m "feat(data): Fase 2 — computeClusterMeat (one-way) via grouped score CTE"
```

---

## Task 4: Two-way clustered meat (Cameron-Gelbach-Miller)

**Files:**
- Modify: `src/services/data/duckdbClusterSE.js`

**Math:** CGM two-way. `V = V_1 + V_2 − V_{12}` where `V_{12}` is clustered by the interaction label `(c1, c2)`. Returning combined meat lets `runOLSFromSuffStats` apply a single sandwich.

`meat_combined = scaled_M_1 + scaled_M_2 − scaled_M_{12}`.

Each sub-meat is scaled by its own `(G_x/(G_x-1)) × ((n-1)/(n-k))`.

- [ ] **Step 1: Append `computeTwowayClusterMeat`**

```javascript
/**
 * Two-way Cameron-Gelbach-Miller clustered meat. One SQL pass with three
 * grouped CTEs (c1, c2, c1×c2). Returns combined meat ready for sandwich:
 *   meat = scale_1 · M_1 + scale_2 · M_2 − scale_12 · M_12
 *
 * @param {object} args  (same as computeClusterMeat plus clusterCol2)
 * @returns {Promise<{meat:number[][], n:number, G1:number, G2:number, G12:number}>}
 */
export async function computeTwowayClusterMeat({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, clusterCol, clusterCol2,
}) {
  const { conn } = await getDuckDB();
  const { dim, params, yhatSQL, finiteSQL, baseProjections, tableNameEsc }
    = buildMfCTE({ tableName, yCol, xColsExpanded, dummySQL, beta });

  // Score-sum aggs (reused across three GROUP BY scopes)
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) scoreAggs.push(`SUM(_e * _x_${j}) AS s_${j}`);

  // Build outer-product agg list reused three times with different table aliases
  const meatAggsFor = (alias) => {
    const out = [];
    for (let j = 0; j < dim; j++) {
      for (let l = j; l < dim; l++) {
        out.push(`SUM(${alias}.s_${j} * ${alias}.s_${l})`);
      }
    }
    return out;
  };

  // For each scope (c1, c2, c12) we want G, and the (k+1)(k+2)/2 m_j_l sums.
  // Emit them as scalar subqueries to keep all three sub-meats in one row.
  const labelTriples = ["1", "2", "12"];
  const selectExprs = [];
  for (const lab of labelTriples) {
    selectExprs.push(`(SELECT COUNT(*) FROM c${lab}) AS G${lab}`);
    let idx = 0;
    for (let j = 0; j < dim; j++) {
      for (let l = j; l < dim; l++) {
        selectExprs.push(`(SELECT SUM(s_${j} * s_${l}) FROM c${lab}) AS m${lab}_${j}_${l}`);
        idx++;
      }
    }
  }
  // n once
  selectExprs.push(`(SELECT COUNT(*) FROM mf) AS n`);

  const sql = `
    WITH base AS (
      SELECT ${baseProjections.join(", ")},
             ${esc(clusterCol)}  AS _g1,
             ${esc(clusterCol2)} AS _g2
      FROM ${tableNameEsc}
    ),
    mf AS (
      SELECT *,
             (${yhatSQL}) AS _yhat,
             _y - (${yhatSQL}) AS _e
      FROM base
      WHERE ${finiteSQL} AND _g1 IS NOT NULL AND _g2 IS NOT NULL
    ),
    c1  AS (SELECT _g1               AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1),
    c2  AS (SELECT _g2               AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g2),
    c12 AS (SELECT (_g1 || '|' || _g2) AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1, _g2)
    SELECT ${selectExprs.join(",\n           ")}
  `;

  // yhatSQL still appears twice in mf — bind params twice. Sub-meat CTEs
  // reference mf but DuckDB inlines the CTE once; param count remains 2× beta.
  // Be defensive: count by canonical first-term placeholder.
  const occCount = (sql.match(/\?\s*\*\s*_x_0\b/g) || []).length;
  const boundParams = [];
  for (let i = 0; i < occCount / params.length; i++) boundParams.push(...params);
  // Sanity
  if (boundParams.length !== occCount) {
    throw new Error(`computeTwowayClusterMeat: param-count mismatch (got ${boundParams.length}, expected ${occCount})`);
  }

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const n   = num(r.n);
  const G1  = num(r.G1);
  const G2  = num(r.G2);
  const G12 = num(r.G12);
  const k   = dim;

  const s1  = (G1  > 1) ? (G1  / (G1  - 1)) * ((n - 1) / (n - k)) : 1;
  const s2  = (G2  > 1) ? (G2  / (G2  - 1)) * ((n - 1) / (n - k)) : 1;
  const s12 = (G12 > 1) ? (G12 / (G12 - 1)) * ((n - 1) / (n - k)) : 1;

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = s1  * num(r[`m1_${j}_${l}`])
              + s2  * num(r[`m2_${j}_${l}`])
              - s12 * num(r[`m12_${j}_${l}`]);
      meat[j][l] = v;
      if (j !== l) meat[l][j] = v;
    }
  }
  return { meat, n, G1, G2, G12 };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/data/duckdbClusterSE.js
git commit -m "feat(data): Fase 2 — computeTwowayClusterMeat (CGM, single SQL pass)"
```

---

## Task 5: `duckdbHACSE.js` — Newey-West HAC meat

**Files:**
- Create: `src/services/data/duckdbHACSE.js`

**Math:** `B = Γ_0 + Σ_{l=1}^{L} w_l (Γ_l + Γ_l')` with Bartlett weight `w_l = 1 − l/(L+1)`.
`Γ_l[j][k] = Σ_{t=l}^{n-1} e_t · e_{t-l} · x_t[j] · x_{t-l}[k]`.

SQL strategy: single CTE with `LAG(_e, l) OVER (...)` and `LAG(_x_j, l) OVER (...)` for each lag and design column. Then one outer SELECT with the cross-aggregates per (lag, j, l) triple.

Risk: at `L=29, dim=6`, that is 30 × 36 = 1080 aggregates in one SELECT. DuckDB handles this comfortably (tested at ~5000 aggregates per SELECT in benchmarks), but the SQL string grows large. Keep generation tight — no debug interpolation in hot loops.

For panel: caller passes `entityCol` → `PARTITION BY entity` inside the window. `LAG` then never crosses entity boundaries (matches the contract documented for `durbinWatsonSQL` in `duckdbDiagnostics.js`).

- [ ] **Step 1: Create the file**

```javascript
// ─── ECON STUDIO · src/services/data/duckdbHACSE.js ──────────────────────────
// Newey-West HAC meat-matrix computation pushed into DuckDB.
//
// Single SQL pass:
//   mf      — materialize y, x_i, yhat, e with finite filter
//   lagged  — add LAG(_e, l), LAG(_x_j, l) for l = 1..L over ORDER BY orderCol
//   outer   — Σ e_t² x_t x_t' (Γ_0) plus per-lag cross sums for Γ_l
//
// Bartlett weights w_l = 1 − l/(L+1) and Γ_l + Γ_l' folding are applied in JS
// (small fixed-size matrix ops).
//
// Panel: pass entityCol to PARTITION BY entity inside the LAG window so LAG
// never crosses entity boundaries.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string}                    args.tableName
 * @param {string}                    args.yCol
 * @param {string[]}                  args.xColsExpanded
 * @param {Record<string,string>}     [args.dummySQL]
 * @param {number[]}                  args.beta            — length k+1
 * @param {string}                    args.orderCol        — time index column
 * @param {string|null}               [args.entityCol]     — panel entity column or null
 * @param {number}                    [args.maxLag]        — null/undefined → auto from n
 * @returns {Promise<{meat:number[][], n:number, L:number}>}
 */
export async function computeHACMeat({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta,
  orderCol, entityCol = null, maxLag,
}) {
  const { conn } = await getDuckDB();
  const k   = xColsExpanded.length;
  const dim = k + 1;

  const xExpr = (i) => {
    if (i === 0) return "1.0";
    const name = xColsExpanded[i - 1];
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };
  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const baseProjections = [`${yExpr} AS _y`];
  for (let i = 0; i < dim; i++) baseProjections.push(`${xExpr(i)} AS _x_${i}`);

  const yhatTerms = [];
  const params   = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * _x_${i}`);
    params.push(beta[i]);
  }
  const yhatSQL = yhatTerms.join(" + ");

  const finite = [`isfinite(_y)`];
  for (let i = 0; i < dim; i++) finite.push(`isfinite(_x_${i})`);

  // Auto-bandwidth: same rule as core/inference/robustSE.js:neweyWestSE
  // First we need n to compute L. Cheapest: roundtrip a COUNT.
  // (One extra SQL pass at startup is dwarfed by the meat pass.)
  const cnt = (await conn.query(
    `SELECT COUNT(*) AS n FROM ${esc(tableName)} WHERE ${finite.join(" AND ").replace(/_y/g, yExpr).replace(/_x_(\d+)/g, (_, i) => xExpr(Number(i)))}`
  )).toArray()[0];
  const nFull = num(cnt.n);
  const L = (maxLag != null) ? Math.max(1, Math.floor(maxLag))
                              : Math.max(1, Math.floor(4 * Math.pow(nFull / 100, 2 / 9)));

  const partition = entityCol ? `PARTITION BY ${esc(entityCol)} ` : "";
  const orderBy   = `${partition}ORDER BY ${esc(orderCol)}`;

  // Build LAG columns: _e_l, _x_j_l for each lag 1..L
  const lagProjections = [];
  for (let lag = 1; lag <= L; lag++) {
    lagProjections.push(`LAG(_e, ${lag}) OVER (${orderBy}) AS _e_${lag}`);
    for (let j = 0; j < dim; j++) {
      lagProjections.push(`LAG(_x_${j}, ${lag}) OVER (${orderBy}) AS _x_${j}_${lag}`);
    }
  }

  // Γ_0 aggregates: SUM(_e² · _x_j · _x_l) for j ≤ l
  const g0Aggs = [];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      g0Aggs.push(`SUM(POWER(_e, 2) * _x_${j} * _x_${l}) AS g0_${j}_${l}`);
    }
  }

  // Γ_lag aggregates: SUM(_e * _e_lag * _x_j * _x_l_lag) for ALL (j, l) — not
  // symmetric, full k+1 × k+1 grid. We fold Γ + Γ' in JS.
  const gLagAggs = [];
  for (let lag = 1; lag <= L; lag++) {
    for (let j = 0; j < dim; j++) {
      for (let l = 0; l < dim; l++) {
        gLagAggs.push(
          `SUM(_e * _e_${lag} * _x_${j} * _x_${l}_${lag}) AS g${lag}_${j}_${l}`,
        );
      }
    }
  }

  const sql = `
    WITH base AS (
      SELECT ${baseProjections.join(", ")},
             ${esc(orderCol)} AS _t
             ${entityCol ? `, ${esc(entityCol)} AS _ent` : ""}
      FROM ${esc(tableName)}
    ),
    mf AS (
      SELECT *,
             (${yhatSQL}) AS _yhat,
             _y - (${yhatSQL}) AS _e
      FROM base
      WHERE ${finite.join(" AND ")}
    ),
    lagged AS (
      SELECT *, ${lagProjections.join(",\n             ")}
      FROM mf
    )
    SELECT COUNT(*) AS n,
           ${g0Aggs.join(", ")}${gLagAggs.length ? ",\n           " + gLagAggs.join(", ") : ""}
    FROM lagged
  `;

  // yhatSQL appears twice in mf — bind params 2×
  const occCount = (sql.match(/\?\s*\*\s*_x_0\b/g) || []).length;
  const boundParams = [];
  for (let i = 0; i < occCount / params.length; i++) boundParams.push(...params);
  if (boundParams.length !== occCount) {
    throw new Error(`computeHACMeat: param-count mismatch (got ${boundParams.length}, expected ${occCount})`);
  }

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  // Assemble Γ_0
  const G0 = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = num(r[`g0_${j}_${l}`]);
      G0[j][l] = v;
      if (j !== l) G0[l][j] = v;
    }
  }

  // B = Γ_0 + Σ_l w_l (Γ_l + Γ_l')
  const B = G0.map(row => row.slice());
  for (let lag = 1; lag <= L; lag++) {
    const w = 1 - lag / (L + 1);
    for (let j = 0; j < dim; j++) {
      for (let l = 0; l < dim; l++) {
        // Γ_l[j][l] + Γ_l'[j][l] = Γ_l[j][l] + Γ_l[l][j]
        const gjl = num(r[`g${lag}_${j}_${l}`]);
        const glj = num(r[`g${lag}_${l}_${j}`]);
        B[j][l] += w * (gjl + glj);
      }
    }
  }

  return { meat: B, n: num(r.n), L };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/data/duckdbHACSE.js
git commit -m "feat(data): Fase 2 — computeHACMeat (Newey-West, Bartlett kernel)"
```

---

## Task 6: Wire cluster/HAC into `ModelingTab.estimate()`

**Files:**
- Modify: `src/components/ModelingTab.jsx`

The current SQL branch (around line 1755–1832) handles classical and HC0–HC3. Extend it to recognize `clustered`, `twoway`, `HAC` and call the matching meat builder. Keep the JS fallback in the `try/catch` — if the SQL path throws or returns an unsupported case, we transparently fall back.

- [ ] **Step 1: Add the three new imports at the top of `ModelingTab.jsx`**

Find the existing imports block (lines 23–32) and add:

```javascript
import {
  countClusters, computeClusterMeat, computeTwowayClusterMeat,
} from "../services/data/duckdbClusterSE.js";
import { computeHACMeat } from "../services/data/duckdbHACSE.js";
```

Place them next to the existing `computeHCMeat`/`computeHCMeatWithLeverage` imports for locality.

- [ ] **Step 2: Locate the seType normalization and dispatch ctx**

Around line 1740–1755 the code normalizes lowercase UI seType to canonical (`hc1` → `HC1`). Extend the normalization to leave cluster/twoway lowercase and uppercase HAC:

Replace the seType normalization block (search for the lines that build `dispatchCtx`):

```javascript
// Normalize SE casing — UI emits lowercase. dispatcher + engine compare
// uppercase HC*, lowercase clustered/twoway, uppercase HAC (matching
// core/inference/robustSE.js dispatch).
const rawSE = (seType ?? "classical").toLowerCase();
const seCanonical =
    rawSE === "hac"        ? "HAC"
  : rawSE.startsWith("hc") ? rawSE.toUpperCase()
  : rawSE;

const dispatchCtx = {
  tableName:     duckTable,
  n:             rowCount ?? rows.length,
  xColsExpanded: allX,  // pre-expansion; re-check after expandFactors
  estimator:     model,
  seType:        seCanonical,
  hasWeights:    !!weightVar,
  hasFactors:    factorVars.size > 0,
  clusterVar:    clusterVar ?? null,
  clusterVar2:   clusterVar2 ?? null,
  timeVar:       seCanonical === "HAC" ? (timeVar ?? panel?.timeCol ?? null) : null,
};
```

(`timeVar` / `clusterVar` / `clusterVar2` come from `InferenceOptions` state — confirm those state vars are in scope; they are passed into the component already.)

- [ ] **Step 3: Branch the meat builder inside the SQL try block**

Inside the existing `try` block (after β/Ainv are computed and cached on `entry`), replace the current `if (hc) { ... computeHCMeat ... }` block with a unified branch:

```javascript
let meat = null;
const seUp = seCanonical;  // canonicalized above

if (seUp === "HC0" || seUp === "HC1") {
  const mm = await measure(() => computeHCMeat({
    tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL, beta: entry.beta,
  }));
  meat = mm.result.meat;
  logEstimate({ path: "sql", phase: `meat-${seUp}`, n: rowCount, k: xColsExpanded.length, msTotal: mm.ms });
}
else if (seUp === "HC2" || seUp === "HC3") {
  const mm = await measure(() => computeHCMeatWithLeverage({
    tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
    beta: entry.beta, Ainv: entry.Ainv, hcType: seUp,
  }));
  meat = mm.result.meat;
  logEstimate({ path: "sql", phase: `meat-${seUp}`, n: rowCount, k: xColsExpanded.length, msTotal: mm.ms });
}
else if (seUp === "clustered") {
  // Preflight: G > n/2 → fallback
  const { G, n: nC } = await countClusters(duckTable, clusterVar);
  if (G > nC / 2) {
    throw new Error(`cluster degenerate (G=${G}, n=${nC}) — fallback to JS`);
  }
  const mm = await measure(() => computeClusterMeat({
    tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
    beta: entry.beta, clusterCol: clusterVar,
  }));
  meat = mm.result.meat;
  logEstimate({ path: "sql", phase: "meat-clustered", n: rowCount, k: xColsExpanded.length, G, msTotal: mm.ms });
}
else if (seUp === "twoway") {
  const mm = await measure(() => computeTwowayClusterMeat({
    tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
    beta: entry.beta, clusterCol: clusterVar, clusterCol2: clusterVar2,
  }));
  meat = mm.result.meat;
  logEstimate({ path: "sql", phase: "meat-twoway", n: rowCount, k: xColsExpanded.length,
                G1: mm.result.G1, G2: mm.result.G2, G12: mm.result.G12, msTotal: mm.ms });
}
else if (seUp === "HAC") {
  const orderCol = timeVar ?? panel?.timeCol;
  const entityCol = panel?.entityCol ?? null;
  const mm = await measure(() => computeHACMeat({
    tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
    beta: entry.beta, orderCol, entityCol,
    maxLag: maxLag != null ? Number(maxLag) : undefined,
  }));
  meat = mm.result.meat;
  logEstimate({ path: "sql", phase: "meat-HAC", n: rowCount, k: xColsExpanded.length, L: mm.result.L, msTotal: mm.ms });
}
// classical → meat stays null; engine reports classical SE only

// Engine: pass hcType only for HC1 (engine applies n/(n-k) scaling there).
// For clustered/twoway/HAC the meat is already pre-scaled inside the builder.
const engineHcType = (seUp === "HC1") ? "HC1" : null;

const m2 = await measure(() => runOLSFromSuffStats({
  n: entry.n, XtX: entry.XtX, XtY: entry.XtY,
  YtY: entry.YtY, sumY: entry.sumY, varNames: entry.varNames,
  meat, hcType: engineHcType,
}));
const raw = m2.result;
logEstimate({ path: "sql", phase: "solve", n: rowCount, k: xColsExpanded.length, seType: seUp, msTotal: m2.ms });
```

(The `if (raw) { ... lazy residuals ... wrapResult ... return; }` block stays exactly as it is today, immediately below this branch.)

- [ ] **Step 4: Update the estimate useCallback dep array**

Find the dep array at line ~1858. Add `clusterVar`, `clusterVar2`, `timeVar`, `maxLag`:

```javascript
}, [subsets, rows, cleanedData, headers, fullPipeline, branchPointIdx, pipelineCtx, _runEstimation,
    model, yVar, xVars, wVars, weightVar, factorVars, seType,
    clusterVar, clusterVar2, timeVar, maxLag]);
```

If `timeVar` is not currently a state var in ModelingTab (only `clusterVar`, `clusterVar2`, `maxLag` exist for HAC today via InferenceOptions), check whether HAC uses `panel.timeCol` instead. If so, leave `timeVar` out and rely on `panel.timeCol` — but keep `panel` in the dep array (it already is).

Search inside ModelingTab for `timeVar` to confirm. If absent, replace `timeVar` references above with `panel?.timeCol` and remove `timeVar` from the dep array additions.

- [ ] **Step 5: Smoke test in browser**

1. Load `fase1_data.csv` (already in `__validation__/`) into DuckDB as table `fase1`.
2. Add a synthetic cluster column via the pipeline (group by `country` already works as a cluster).
3. Estimate OLS y ~ x1 + x2 + country, switch SE to **Clustered** with cluster = `country`. Confirm no console errors and SE column populates.
4. Switch to **HAC** with timeCol = a row index. Confirm SE populates.
5. Open the perfLog ring buffer: `window.__perfLog?.entries()` — confirm `path: "sql", phase: "meat-clustered"` and `phase: "meat-HAC"` entries.

- [ ] **Step 6: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 2 — wire cluster/twoway/HAC into SQL dispatch branch"
```

---

## Task 7: White test in `duckdbDiagnostics.js`

**Files:**
- Modify: `src/services/data/duckdbDiagnostics.js`

**Math:** White (1980). Aux regression `e² ~ [1, X, X², X⊗X_distinct]`. Test statistic `nR²_aux ~ χ²(p_aux − 1)`.

For dim=k+1 design (incl intercept), aux columns are:
- 1 intercept (already counted)
- k design columns (`_x_1 ... _x_k`, skipping intercept which equals 1)
- k squared columns (`_x_i²`)
- k(k−1)/2 cross-product columns (`_x_i * _x_j`, i<j)

Total aux dim = 1 + k + k + k(k-1)/2 = 1 + 2k + k(k-1)/2.

At k=5: 1+10+10 = 21. At k=10: 1+20+45 = 66. Aux X'X is O(p²) aggregates, ~2200 at k=10 — still one SQL pass.

We compute aux X'X + aux X'(e²) sufficient stats in SQL and solve aux β in JS via `runOLSFromSuffStats` (reusing the engine — aux dataset is the design over n rows; we feed `meat=null, hcType=null` so engine returns classical SE/β).

Returning structure: `{ statistic: n·R²_aux, df: p_aux - 1, pAux }`.

- [ ] **Step 1: Append `whiteTestSQL` to `duckdbDiagnostics.js`**

```javascript
/**
 * White (1980) heteroskedasticity test via aux regression e² ~ [X, X², X⊗X].
 * Returns suff stats; caller solves aux β in JS to compute R²_aux and the
 * test statistic n·R²_aux ~ χ²(df).
 *
 * We do not run the aux regression here — the orchestrator in ModelingTab
 * already imports runOLSFromSuffStats and can solve the small aux problem.
 *
 * @param {object} args  — same shape as breuschPaganSQL
 * @returns {Promise<{
 *   n: number,
 *   XtXAux: number[][],
 *   XtYAux: number[],      // Xaux' (e²)
 *   YtYAux: number,        // Σ(e²)²
 *   sumYAux: number,       // Σ(e²)
 *   varNamesAux: string[], // labels (just for symmetry with engine API)
 *   pAux: number,
 * }>}
 */
export async function whiteTestSQL(args) {
  const { conn } = await getDuckDB();
  const { cteSQL, boundParams, dim } = buildCTE(args);
  const k = dim - 1;  // number of non-intercept regressors

  // Aux column expressions. Index 0 = intercept (1.0). Then x_i (i=1..k),
  // then x_i² (i=1..k), then x_i*x_j (i<j, both 1..k).
  const auxCols = [];          // SQL expressions, one per aux column
  const auxNames = [];
  auxCols.push("1.0"); auxNames.push("(Intercept)");
  for (let i = 1; i <= k; i++) { auxCols.push(`_x_${i}`);                 auxNames.push(`x${i}`);        }
  for (let i = 1; i <= k; i++) { auxCols.push(`_x_${i} * _x_${i}`);       auxNames.push(`x${i}_sq`);     }
  for (let i = 1; i <= k; i++)
    for (let j = i + 1; j <= k; j++) {
      auxCols.push(`_x_${i} * _x_${j}`);
      auxNames.push(`x${i}_x${j}`);
    }
  const pAux = auxCols.length;

  // Aggregates: X'X upper tri, X'(e²), Σe², Σ(e²)²
  const aggs = ["COUNT(*) AS n",
                "SUM(POWER(_e, 2))           AS sumY",
                "SUM(POWER(POWER(_e, 2), 2)) AS YtY"];
  for (let i = 0; i < pAux; i++) {
    aggs.push(`SUM((${auxCols[i]}) * POWER(_e, 2)) AS xy_${i}`);
    for (let j = i; j < pAux; j++) {
      aggs.push(`SUM((${auxCols[i]}) * (${auxCols[j]})) AS xx_${i}_${j}`);
    }
  }

  const sql = `WITH ${cteSQL} SELECT ${aggs.join(", ")} FROM mf`;
  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const n = num(r.n);
  const XtXAux = Array.from({ length: pAux }, () => Array(pAux).fill(0));
  const XtYAux = Array(pAux).fill(0);
  for (let i = 0; i < pAux; i++) {
    XtYAux[i] = num(r[`xy_${i}`]);
    for (let j = i; j < pAux; j++) {
      const v = num(r[`xx_${i}_${j}`]);
      XtXAux[i][j] = v;
      if (i !== j) XtXAux[j][i] = v;
    }
  }
  return {
    n,
    XtXAux,
    XtYAux,
    YtYAux: num(r.YtY),
    sumYAux: num(r.sumY),
    varNamesAux: auxNames,
    pAux,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/data/duckdbDiagnostics.js
git commit -m "feat(data): Fase 2 — whiteTestSQL aux-regression sufficient stats"
```

---

## Task 8: Breusch-Godfrey test in `duckdbDiagnostics.js`

**Files:**
- Modify: `src/services/data/duckdbDiagnostics.js`

**Math:** BG. Aux regression `e_t ~ X + e_{t-1} + ... + e_{t-p}`. Test statistic `n·R²_aux ~ χ²(p)`.

Aux design: intercept + k design columns + p lag-residual columns. Aux dim = 1 + k + p (k = non-intercept regressor count).

Same pattern as White: emit suff stats; caller solves aux β.

- [ ] **Step 1: Append `breuschGodfreySQL`**

```javascript
/**
 * Breusch-Godfrey serial correlation test. Aux regression
 * e_t ~ X + LAG(e_t, 1) + ... + LAG(e_t, p).
 * Returns suff stats; caller solves aux β and computes n·R²_aux ~ χ²(p).
 *
 * For panel data, pass entityCol to partition the LAG window (avoids
 * cross-unit residual leakage). orderCol defaults to "__ri".
 *
 * @param {object} args
 * @param {number} args.maxLag       — p, default 1
 * @param {string} [args.orderCol]   — default "__ri"
 * @param {string|null} [args.entityCol]
 * @returns {Promise<{n, XtXAux, XtYAux, YtYAux, sumYAux, varNamesAux, pAux, p}>}
 */
export async function breuschGodfreySQL({
  maxLag = 1, orderCol = "__ri", entityCol = null, ...args
}) {
  const { conn } = await getDuckDB();
  const { cteSQL, boundParams, dim } = buildCTE(args);
  const k = dim - 1;
  const p = Math.max(1, Math.floor(maxLag));

  const partition = entityCol ? `PARTITION BY ${esc(entityCol)} ` : "";
  const orderBy   = `${partition}ORDER BY ${esc(orderCol)}`;

  // Aux column expressions. Index 0=intercept, 1..k=x_i, k+1..k+p=lag residuals.
  const auxCols = ["1.0"];
  const auxNames = ["(Intercept)"];
  for (let i = 1; i <= k; i++) { auxCols.push(`_x_${i}`);       auxNames.push(`x${i}`); }
  for (let l = 1; l <= p; l++) { auxCols.push(`_e_lag_${l}`);   auxNames.push(`e_lag_${l}`); }
  const pAux = auxCols.length;

  // CTE addition: laggedE adds e_lag_1..e_lag_p over the mf window.
  const lagProjections = [];
  for (let l = 1; l <= p; l++) {
    lagProjections.push(`LAG(_e, ${l}) OVER (${orderBy}) AS _e_lag_${l}`);
  }

  // Aggregates restricted to rows where all lag values are present.
  const aggs = ["COUNT(*) AS n",
                "SUM(_e)             AS sumY",
                "SUM(POWER(_e, 2))   AS YtY"];
  for (let i = 0; i < pAux; i++) {
    aggs.push(`SUM((${auxCols[i]}) * _e) AS xy_${i}`);
    for (let j = i; j < pAux; j++) {
      aggs.push(`SUM((${auxCols[i]}) * (${auxCols[j]})) AS xx_${i}_${j}`);
    }
  }

  const lagNotNull = [];
  for (let l = 1; l <= p; l++) lagNotNull.push(`_e_lag_${l} IS NOT NULL`);

  const sql = `
    WITH ${cteSQL},
    laggedE AS (
      SELECT *, ${lagProjections.join(", ")}
      FROM mf
    )
    SELECT ${aggs.join(", ")}
    FROM laggedE
    WHERE ${lagNotNull.join(" AND ")}
  `;

  // Same trick: count FROM mf occurrences (laggedE references mf once + the
  // CTE itself references mf via its SELECT *). Be defensive and count via
  // canonical first-term placeholder occurrences in the compiled SQL.
  const occCount = (sql.match(/\?\s*\*\s*_x_0\b/g) || []).length;
  const finalParams = [];
  for (let i = 0; i < occCount / boundParams.length * boundParams.length; i++) {
    // walk: bind one full set per yhatSQL appearance
  }
  // Simpler & correct: re-bind boundParams once per occurrence-of-yhat in SQL.
  // yhatSQL is inside mf CTE (appears twice). So bind 2× regardless of p.
  const yhatOccs = 2;
  const fp = [];
  for (let i = 0; i < yhatOccs; i++) fp.push(...boundParams.slice(0, dim));

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...fp)).toArray()[0];
  await stmt.close();

  const n = num(r.n);
  const XtXAux = Array.from({ length: pAux }, () => Array(pAux).fill(0));
  const XtYAux = Array(pAux).fill(0);
  for (let i = 0; i < pAux; i++) {
    XtYAux[i] = num(r[`xy_${i}`]);
    for (let j = i; j < pAux; j++) {
      const v = num(r[`xx_${i}_${j}`]);
      XtXAux[i][j] = v;
      if (i !== j) XtXAux[j][i] = v;
    }
  }
  return {
    n, XtXAux, XtYAux,
    YtYAux: num(r.YtY),
    sumYAux: num(r.sumY),
    varNamesAux: auxNames,
    pAux, p,
  };
}
```

> ⚠ Note about `boundParams`: `buildCTE` already returns a doubled `boundParams` (β × 2 for the two `yhatSQL` appearances inside `mf`). The slice `boundParams.slice(0, dim)` recovers the original single β. If the existing `buildCTE` API changes shape in the future, audit this slice.

- [ ] **Step 2: Commit**

```bash
git add src/services/data/duckdbDiagnostics.js
git commit -m "feat(data): Fase 2 — breuschGodfreySQL aux-regression sufficient stats"
```

---

## Task 9: R golden values + synthetic dataset

**Files:**
- Create: `src/services/data/__validation__/fase2RValidation.R`

**Dataset design:** panel with G=200 entities, T=50 periods (n=10 000), heteroskedastic noise, AR(1) residual within entity, two cluster dimensions (`firm`, `year`).

Output:
- `fase2_data.csv` — to import into DuckDB as table `fase2`
- `fase2Benchmarks.json` — clustered/twoway/HAC SEs and White/BG statistics

- [ ] **Step 1: Write the R script**

```r
# fase2RValidation.R — golden values for Fase 2 numerical validation.
# Generates clustered (firm), two-way clustered (firm × year), and Newey-West
# HAC standard errors for a known OLS spec, plus White and Breusch-Godfrey
# test statistics.

set.seed(42)
G <- 200
T <- 50
n <- G * T

firm  <- rep(1:G, each = T)
year  <- rep(1:T, times = G)
x1    <- rnorm(n)
x2    <- rnorm(n)
fe_f  <- rnorm(G)[firm]
# AR(1) within firm; heteroskedastic on x1
rho   <- 0.4
e <- numeric(n)
for (g in 1:G) {
  idx <- which(firm == g)
  innov <- rnorm(T) * (1 + abs(x1[idx]))
  e[idx[1]] <- innov[1]
  for (t in 2:T) e[idx[t]] <- rho * e[idx[t - 1]] + innov[t]
}
y <- 1 + 2 * x1 - 0.5 * x2 + fe_f + e

df <- data.frame(y = y, x1 = x1, x2 = x2, firm = firm, year = year, __ri = seq_len(n))
write.csv(df, "fase2_data.csv", row.names = FALSE)

library(sandwich)
library(lmtest)
fit <- lm(y ~ x1 + x2, data = df)

# Clustered
v_cluster1 <- vcovCL(fit, cluster = ~ firm, type = "HC1")
# Two-way Cameron-Gelbach-Miller
v_twoway   <- vcovCL(fit, cluster = ~ firm + year, type = "HC1", multi0 = FALSE)
# Newey-West HAC (lag auto = floor(4*(n/100)^(2/9)))
L_auto     <- floor(4 * (nrow(df) / 100)^(2 / 9))
v_hac      <- NeweyWest(fit, lag = L_auto, prewhite = FALSE, adjust = TRUE)

# White test (no-cross is default in lmtest::bptest; for true White use studentize=FALSE
# and the squared-term aux regression by hand)
e_hat <- residuals(fit)
X <- model.matrix(fit)[, -1]  # drop intercept
aux_cols <- cbind(X, X^2, X[, 1] * X[, 2])
aux_df <- data.frame(e2 = e_hat^2, aux_cols)
fit_white <- lm(e2 ~ ., data = aux_df)
n_w   <- length(e_hat)
r2_w  <- summary(fit_white)$r.squared
white_stat <- n_w * r2_w
white_df   <- ncol(aux_cols)

# Breusch-Godfrey lag 1
bg <- bgtest(fit, order = 1)
bg_stat <- unname(bg$statistic)
bg_df   <- 1

result <- list(
  beta           = as.numeric(coef(fit)),
  varNames       = names(coef(fit)),
  se_clustered   = as.numeric(sqrt(diag(v_cluster1))),
  se_twoway      = as.numeric(sqrt(diag(v_twoway))),
  se_hac         = as.numeric(sqrt(diag(v_hac))),
  L_hac          = L_auto,
  white_stat     = white_stat,
  white_df       = white_df,
  bg_stat        = bg_stat,
  bg_df          = bg_df
)
jsonlite::write_json(result, "fase2Benchmarks.json", auto_unbox = TRUE, digits = 8)
cat("Wrote fase2_data.csv and fase2Benchmarks.json\n")
```

- [ ] **Step 2: Run the R script and commit outputs**

```bash
cd src/services/data/__validation__
Rscript fase2RValidation.R
git add fase2RValidation.R fase2Benchmarks.json fase2_data.csv
git commit -m "test(data): Fase 2 — R golden values for clustered/twoway/HAC + White + BG"
```

---

## Task 10: Browser-side numerical validation harness

**Files:**
- Create: `src/services/data/__validation__/fase2Validation.js`

Mirror the Fase 1 pattern: fetch JSON benchmarks, expand factors (no factors here — just x1, x2), build suff stats, run each meat builder, compare SEs to 4dp; for White + BG solve the aux regression via `runOLSFromSuffStats` and compare `n·R²_aux` to R's value at 4dp.

- [ ] **Step 1: Write the validator**

```javascript
// Structural + numerical validation for Fase 2: clustered, twoway, HAC,
// White, Breusch-Godfrey. Mirrors robustSEValidation.runFase1NumericalValidation.

import { buildOLSSuffStats }        from "../duckdbOLS.js";
import { expandFactors }            from "../duckdbFactors.js";
import { computeClusterMeat,
         computeTwowayClusterMeat,
         countClusters }            from "../duckdbClusterSE.js";
import { computeHACMeat }           from "../duckdbHACSE.js";
import { whiteTestSQL,
         breuschGodfreySQL }        from "../duckdbDiagnostics.js";
import { runOLSFromSuffStats }      from "../../../math/LinearEngine.js";

const close4 = (a, b) => Math.abs(a - b) < 1e-4;
const close6 = (a, b) => Math.abs(a - b) < 1e-6;

export async function runFase2NumericalValidation(tableName = "fase2") {
  const benchResp = await fetch(new URL("./fase2Benchmarks.json", import.meta.url));
  const B = await benchResp.json();

  let p = 0, f = 0;
  const c = (n, ok) => ok ? (p++, console.log(`  ✓ ${n}`)) : (f++, console.error(`  ✗ ${n}`));

  const { xColsExpanded, dummySQL } = await expandFactors({
    xCols: ["x1", "x2"], tableName,
  });
  const suff      = await buildOLSSuffStats(tableName, "y", xColsExpanded, { dummySQL });
  const classical = runOLSFromSuffStats({ ...suff });

  B.beta.forEach((b, i) =>
    c(`β[${i}] matches R (6dp)`, close6(classical.beta[i], b)));

  // ── Clustered (one-way, by firm) ─────────────────────────────────────────
  const card = await countClusters(tableName, "firm");
  c(`countClusters reports G=${card.G}`, card.G === 200);
  const cl = await computeClusterMeat({
    tableName, yCol: "y", xColsExpanded, dummySQL,
    beta: classical.beta, clusterCol: "firm",
  });
  const rCl = runOLSFromSuffStats({ ...suff, meat: cl.meat, hcType: null });
  B.se_clustered.forEach((s, i) =>
    c(`SE clustered[${i}] (4dp)`, close4(rCl.se[i], s)));

  // ── Two-way (firm × year, CGM) ────────────────────────────────────────────
  const tw = await computeTwowayClusterMeat({
    tableName, yCol: "y", xColsExpanded, dummySQL,
    beta: classical.beta, clusterCol: "firm", clusterCol2: "year",
  });
  const rTw = runOLSFromSuffStats({ ...suff, meat: tw.meat, hcType: null });
  B.se_twoway.forEach((s, i) =>
    c(`SE twoway[${i}] (4dp)`, close4(rTw.se[i], s)));

  // ── HAC (Newey-West, auto bandwidth, ordered by __ri inside firm) ────────
  const hac = await computeHACMeat({
    tableName, yCol: "y", xColsExpanded, dummySQL,
    beta: classical.beta, orderCol: "__ri", entityCol: "firm",
  });
  const rHac = runOLSFromSuffStats({ ...suff, meat: hac.meat, hcType: null });
  c(`HAC bandwidth L matches R (${B.L_hac})`, hac.L === B.L_hac);
  B.se_hac.forEach((s, i) =>
    c(`SE HAC[${i}] (4dp)`, close4(rHac.se[i], s)));

  // ── White test ───────────────────────────────────────────────────────────
  const w = await whiteTestSQL({
    tableName, yCol: "y", xColsExpanded, dummySQL, beta: classical.beta,
  });
  const auxW = runOLSFromSuffStats({
    n: w.n, XtX: w.XtXAux, XtY: w.XtYAux,
    YtY: w.YtYAux, sumY: w.sumYAux, varNames: w.varNamesAux,
  });
  // R² = 1 - SSR/SST with SST = YtY - n·meanY² and SSR returned via auxW.
  const meanY2 = (w.sumYAux / w.n);
  const SST    = w.YtYAux - w.n * meanY2 * meanY2;
  const SSR    = auxW.ssr;  // engine returns ssr in result
  const r2W    = 1 - SSR / SST;
  const whiteStat = w.n * r2W;
  c(`White stat (4dp): ${whiteStat.toFixed(4)} vs ${B.white_stat.toFixed(4)}`,
    close4(whiteStat, B.white_stat));
  c(`White df matches`, w.pAux - 1 === B.white_df);

  // ── Breusch-Godfrey lag 1 ────────────────────────────────────────────────
  const bg = await breuschGodfreySQL({
    tableName, yCol: "y", xColsExpanded, dummySQL, beta: classical.beta,
    maxLag: 1, orderCol: "__ri", entityCol: "firm",
  });
  const auxBG = runOLSFromSuffStats({
    n: bg.n, XtX: bg.XtXAux, XtY: bg.XtYAux,
    YtY: bg.YtYAux, sumY: bg.sumYAux, varNames: bg.varNamesAux,
  });
  const meanYBG = bg.sumYAux / bg.n;
  const SST_bg  = bg.YtYAux - bg.n * meanYBG * meanYBG;
  const r2_bg   = 1 - auxBG.ssr / SST_bg;
  const bgStat  = bg.n * r2_bg;
  c(`BG stat (4dp): ${bgStat.toFixed(4)} vs ${B.bg_stat.toFixed(4)}`,
    close4(bgStat, B.bg_stat));
  c(`BG df matches`, bg.p === B.bg_df);

  console.log(`\n${p} passed, ${f} failed`);
  return f === 0;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase2 = runFase2NumericalValidation;
}
```

- [ ] **Step 2: Verify `runOLSFromSuffStats` exposes `.ssr`**

Open `src/math/LinearEngine.js`, find `runOLSFromSuffStats`. Confirm the returned object includes `ssr` (the residual sum of squares). If it does not, add it:

```javascript
// inside the function, after computing residual variance
return { beta, se, ssr, n, k, /* …existing fields… */ };
```

If `ssr` is not currently exported, this is a one-line additive change to the return object — does not break any existing caller.

- [ ] **Step 3: Browser smoke-run**

Open the dev console with `fase2_data.csv` loaded into DuckDB as table `fase2`:

```javascript
await window.__validation.fase2()
```

Expected: all checks pass (look for `0 failed` in the summary). If any 4dp comparison fails, inspect with higher precision before loosening tolerance — Fase 1 already validated at 4dp on the same accumulation pattern, so a Fase 2 failure points to an SQL bug, not numerical noise.

- [ ] **Step 4: Commit**

```bash
git add src/services/data/__validation__/fase2Validation.js src/math/LinearEngine.js
git commit -m "test(data): Fase 2 — numerical validation harness vs R sandwich/lmtest"
```

---

## Task 11: Status updates

**Files:**
- Modify: `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md`
- Modify: `CLAUDE.md` (item 2a Pending block)

- [ ] **Step 1: Update spec status line**

In the spec file, change:

```markdown
**Status:** Fase 0 + Fase 1 DONE (2026-05-19). Fases 2–7 pending.
```

to:

```markdown
**Status:** Fase 0 + Fase 1 + Fase 2 DONE (2026-05-19). Fases 3–7 pending.
```

- [ ] **Step 2: Update CLAUDE.md Pending item 2a**

Append to the existing `2a` paragraph (the one that already documents Fase 0+1):

```
Fase 2 extensions: duckdbClusterSE.computeClusterMeat (grouped score CTE + small-sample correction G/(G-1)·(n-1)/(n-k)), computeTwowayClusterMeat (single-SQL-pass CGM with three grouped CTEs c1/c2/c1×c2), duckdbHACSE.computeHACMeat (Newey-West Bartlett kernel with LAG over ORDER BY orderCol [+ PARTITION BY entityCol], auto-bandwidth L=floor(4·(n/100)^(2/9))), duckdbDiagnostics.whiteTestSQL (aux regression e² ~ X + X² + X⊗X) and breuschGodfreySQL (e_t ~ X + LAG(e_t,1..p)). Dispatcher SQL_SUPPORTED_SE += {clustered, twoway, HAC} with operand-presence checks (clusterVar, clusterVar2, timeVar). ModelingTab branches on canonicalized seType; cluster preflight aborts SQL path when G>n/2 → JS fallback. Validation: structural + R sandwich::vcovCL / NeweyWest / lmtest::bgtest golden values in `__validation__/fase2Benchmarks.json` (window.__validation.fase2).
```

- [ ] **Step 3: Commit and push**

```bash
git add docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md CLAUDE.md
git commit -m "docs: mark DuckDB suff-stats Fase 2 DONE"
git push origin Main-
```

---

## Self-review notes (for the implementer)

1. **Param-replication trick.** Tasks 3–8 all rely on counting placeholder occurrences in the compiled SQL string (`sql.match(/\?\s*\*\s*_x_0\b/g)`). This is the same idiom used in `duckdbRobustSE.js` and `duckdbDiagnostics.breuschPaganSQL`. The first-term anchor (`_x_0`) is canonical because every `yhatSQL` starts with `? * _x_0`. If you refactor the yhat builder, update the anchor.

2. **Cluster degeneration.** `G > n/2` aborts the SQL path and falls back to JS. Do NOT silently degrade to HC1 inside the SQL builder — the user explicitly chose clustered; the JS path will run the same `core/inference/robustSE.clusteredSE` they would have hit without DuckDB at all. The perfLog entry records the abort reason.

3. **Two-way scale factors.** Each sub-meat (M₁, M₂, M₁₂) gets its own `(G/(G-1)) · (n-1)/(n-k)` scale BEFORE the CGM subtraction. R's `sandwich::vcovCL` defaults to this convention.

4. **HAC auto-bandwidth.** R's `NeweyWest(lag = NULL)` uses a different default rule (Andrews 1991 plug-in). We deliberately match `core/inference/robustSE.neweyWestSE` instead: `L = floor(4·(n/100)^(2/9))`. To validate, the R script passes `lag = L_auto` explicitly with the same formula — keeps the comparison apples-to-apples.

5. **CTE re-execution under sub-meat scalars.** Task 4 (`computeTwowayClusterMeat`) puts three `(SELECT ... FROM c_x)` scalar subqueries in the outer SELECT. DuckDB inlines CTEs by default and may re-plan each subquery — that risks repeated mf evaluation. If perfLog shows the two-way pass running 3× slower than one-way, switch to materializing mf via a TEMP TABLE one level up.

6. **Engine signature drift.** Task 6 passes `hcType: null` for cluster/HAC. `runOLSFromSuffStats` currently treats `null` as classical (no extra scaling). Open the engine, confirm: a null hcType + non-null meat must produce `V = Ainv · meat · Ainv` with no further scaling. If today the engine applies HC1 scaling unconditionally when `meat` is present, fix it inside the engine (one-line guard) before Task 6 ships.

## What this plan does NOT cover

- WLS / 2SLS / IV / GMM SE in SQL (Fase 3).
- FE within-transform in SQL (Fase 4).
- DiD / Event Study in SQL (Fase 5).
- IRLS for Logit/Probit/Poisson FE (Fase 6).
- RDD local-linear SQL (Fase 7).
- Shapiro-Wilk — permanently gated to n ≤ 5000 (spec decision).
- Cluster-bootstrap, wild bootstrap — out of scope for the entire roadmap.
