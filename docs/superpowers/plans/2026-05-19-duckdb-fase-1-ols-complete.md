# Fase 1 — OLS Complete in SQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push the rest of the OLS workflow (HC0–HC3 robust SE, factor expansion, lazy residuals, cheap diagnostics) into DuckDB SQL so large-n OLS estimation never materializes the full dataset in JS.

**Architecture:** SQL builds the meat matrix Σ êᵢ² xᵢ xⱼ (and leverage-scaled variants) with β and Ainv injected as prepared-statement parameters. The classical path stays zero-extra-pass. HC0/HC1 adds one SQL meat pass; HC2/HC3 adds one meat-with-leverage pass. β and Ainv are cached on the suff-stats entry so SE-type toggles are cheap. Residuals are lazy — only sampled (5k rows) when a consumer panel mounts.

**Tech Stack:** DuckDB-Wasm prepared statements, plain JS matrix algebra, existing `runOLSFromSuffStats` and `core/inference/robustSE.js` patterns, validation harness in `__validation__/` (no Jest).

---

### File structure

```
src/services/data/
├── dispatchConfig.js         ← MOD: SQL_SUPPORTED_SE grows to {classical, HC0, HC1, HC2, HC3}
├── duckdbDispatch.js         ← MOD: drop hasFactors gate (factors now supported)
├── duckdbOLS.js              ← MOD: buildOLSSuffStats accepts dummySQL fragments
├── duckdbFactors.js          ← NEW: expandFactors() — CASE WHEN dummy generator
├── duckdbRobustSE.js         ← NEW: computeHCMeat + computeHCMeatWithLeverage
├── duckdbResiduals.js        ← NEW: sampleResiduals() lazy thunk
├── duckdbDiagnostics.js      ← NEW: BP, DW, JB in SQL; VIF, cond from cached X'X
└── __validation__/
    ├── factorsValidation.js          ← NEW
    ├── robustSEValidation.js         ← NEW
    └── fase1RValidation.R            ← NEW: golden values from sandwich::vcovHC

src/math/
└── LinearEngine.js           ← MOD: runOLSFromSuffStats accepts {seType, meat, hcType}

src/components/
├── ModelingTab.jsx           ← MOD: pass seType + dummySQL through SQL path
└── modeling/
    ├── DiagnosticsPanel.jsx  ← MOD: detect _hasLazyResiduals; SQL diag routing
    └── ResidualPlots.jsx     ← MOD: await result._residualsThunk()
```

---

### Task 1: Dispatcher accepts HC0–HC3 and factors

**Files:**
- Modify: `src/services/data/dispatchConfig.js`
- Modify: `src/services/data/duckdbDispatch.js`
- Modify: `src/services/data/__validation__/dispatchValidation.js`

- [ ] **Step 1: Update failing tests in dispatchValidation.js**

Add to `validateDispatch()`:

```js
check("HC0 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC0" }) === true);
check("HC1 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC1" }) === true);
check("HC2 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC2" }) === true);
check("HC3 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC3" }) === true);
check("clustered → false (Fase 2)",
  shouldUseSQLPath({ ...baseCtx, seType: "clustered" }) === false);
check("hasFactors=true → true (Fase 1)",
  shouldUseSQLPath({ ...baseCtx, hasFactors: true }) === true);
```

Update `validateConfig()`:

```js
check("SQL_SUPPORTED_SE has HC0", cfg.SQL_SUPPORTED_SE.has("HC0"));
check("SQL_SUPPORTED_SE has HC3", cfg.SQL_SUPPORTED_SE.has("HC3"));
check("SQL_SUPPORTED_SE does not have clustered", !cfg.SQL_SUPPORTED_SE.has("clustered"));
```

Replace the obsolete checks `"SQL_SUPPORTED_SE does not have HC1"` and `"hasFactors=true → false"`.

- [ ] **Step 2: Run validation — confirm failure**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected: fails on new HC0–3 checks (still returns false), passes others.

- [ ] **Step 3: Update dispatchConfig.js**

```js
export const SQL_SUPPORTED_SE = new Set(["classical", "HC0", "HC1", "HC2", "HC3"]);
```

- [ ] **Step 4: Update duckdbDispatch.js**

Remove the line `if (ctx.hasFactors) return false;`. Factors now supported via SQL CASE WHEN expansion. Leave `hasWeights` gate — Fase 3.

- [ ] **Step 5: Run validation — confirm pass**

Expected: all dispatch tests pass, exit code 0.

- [ ] **Step 6: Commit**

```
git add src/services/data/dispatchConfig.js src/services/data/duckdbDispatch.js src/services/data/__validation__/dispatchValidation.js
git commit -m "feat(data): Fase 1 — dispatcher admits HC0-3 and factors"
```

---

### Task 2: Factor expansion (duckdbFactors.js)

**Files:**
- Create: `src/services/data/duckdbFactors.js`
- Create: `src/services/data/__validation__/factorsValidation.js`
- Create: `src/services/data/__validation__/factorsValidation.runner.js`

- [ ] **Step 1: Write failing tests in factorsValidation.js**

```js
import { parseFactorSpec, expandFactors } from "../duckdbFactors.js";

let passes = 0, fails = 0;
const check = (n, c) => c ? (passes++, console.log(`  ✓ ${n}`)) : (fails++, console.error(`  ✗ ${n}`));

function validateParse() {
  console.log("\n[parseFactorSpec]");
  check("plain col → null", parseFactorSpec("x1") === null);
  check("factor(country) → 'country'", parseFactorSpec("factor(country)") === "country");
  check("whitespace tolerated", parseFactorSpec("factor( region )") === "region");
}

async function validateExpand() {
  console.log("\n[expandFactors]");
  const fakeLevels = async (col) => {
    if (col === "country") return ["DE", "FR", "IT"];
    if (col === "year")    return [2010, 2011, 2012];
    return [];
  };
  const out = await expandFactors({
    xCols: ["x1", "factor(country)", "x2"],
    fetchLevels: fakeLevels,
  });
  check("xColsExpanded length = 4", out.xColsExpanded.length === 4);
  check("reference level (DE) dropped", !out.xColsExpanded.includes("country_DE"));
  check("FR dummy present", out.xColsExpanded.includes("country_FR"));
  check("dummySQL FR has level literal", out.dummySQL.country_FR.includes("'FR'"));
  check("dummySQL uses CASE WHEN", out.dummySQL.country_FR.startsWith("CASE WHEN"));

  const out2 = await expandFactors({
    xCols: ["factor(year)"], fetchLevels: fakeLevels,
  });
  check("numeric levels unquoted in SQL", out2.dummySQL.year_2011.includes("= 2011"));
}

export async function runFactorsValidation() {
  passes = 0; fails = 0;
  validateParse();
  await validateExpand();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
```

Companion runner `factorsValidation.runner.js`:

```js
import { runFactorsValidation } from "./factorsValidation.js";
const ok = await runFactorsValidation();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run — confirm failure (module not found)**

Run: `node src/services/data/__validation__/factorsValidation.runner.js`
Expected: import error, exit 1.

- [ ] **Step 3: Implement duckdbFactors.js**

```js
// ─── ECON STUDIO · src/services/data/duckdbFactors.js ─────────────────────────
// Detects factor(col) entries in xCols, fetches distinct levels from DuckDB,
// drops the first level as the reference, emits CASE WHEN dummy fragments
// keyed by synthetic column name (country_FR, year_2011, ...).
// Output preserves original ordering of plain regressors interleaved with
// expanded dummies. buildOLSSuffStats consumes dummySQL via the opts arg.

import { getDuckDB } from "./duckdb.js";

const FACTOR_RE = /^factor\(\s*([^()\s][^()]*?)\s*\)$/;

export function parseFactorSpec(name) {
  const m = FACTOR_RE.exec(name);
  return m ? m[1] : null;
}

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }

function literal(v) {
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function defaultFetchLevels(tableName, col) {
  const { conn } = await getDuckDB();
  const sql = `SELECT DISTINCT ${esc(col)} AS lvl FROM ${esc(tableName)} WHERE ${esc(col)} IS NOT NULL ORDER BY lvl`;
  const r = await conn.query(sql);
  return r.toArray().map(row => row.lvl);
}

export async function expandFactors({ xCols, tableName, fetchLevels }) {
  const fetch = fetchLevels ?? ((col) => defaultFetchLevels(tableName, col));
  const xColsExpanded = [];
  const dummySQL = {};
  for (const x of xCols) {
    const factorCol = parseFactorSpec(x);
    if (factorCol === null) {
      xColsExpanded.push(x);
      continue;
    }
    const levels = await fetch(factorCol);
    for (let i = 1; i < levels.length; i++) {
      const lvl = levels[i];
      const dummyName = `${factorCol}_${String(lvl).replace(/[^A-Za-z0-9_]/g, "_")}`;
      dummySQL[dummyName] = `CASE WHEN ${esc(factorCol)} = ${literal(lvl)} THEN 1 ELSE 0 END`;
      xColsExpanded.push(dummyName);
    }
  }
  return { xColsExpanded, dummySQL };
}
```

- [ ] **Step 4: Run — confirm pass**

Expected: `XX passed, 0 failed`.

- [ ] **Step 5: Commit**

```
git add src/services/data/duckdbFactors.js src/services/data/__validation__/factorsValidation.js src/services/data/__validation__/factorsValidation.runner.js
git commit -m "feat(data): Fase 1 — duckdbFactors.expandFactors() with CASE WHEN dummies"
```

---

### Task 3: buildOLSSuffStats accepts dummySQL

**Files:**
- Modify: `src/services/data/duckdbOLS.js`

- [ ] **Step 1: Change function signature**

From `buildOLSSuffStats(tableName, yCol, xCols)` to `buildOLSSuffStats(tableName, yCol, xCols, opts = {})`.

- [ ] **Step 2: Substitute dummySQL where present**

Replace the `xExprs` generation:

```js
const dummySQL = opts.dummySQL ?? {};
const xExprs = xCols.map(c => {
  if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
    return `CAST((${dummySQL[c]}) AS DOUBLE)`;
  }
  return `TRY_CAST(${esc(c)} AS DOUBLE)`;
});
```

Leave the rest intact.

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Smoke check in browser**

Manual: load a >50k Parquet/CSV with a string column, run OLS with `factor(...)` in xCols. Verify no SQL error and result β matches the JS-path values for the same model.

(No isolated unit test — integration happens via Task 10 R validation.)

- [ ] **Step 5: Commit**

```
git add src/services/data/duckdbOLS.js
git commit -m "feat(data): Fase 1 — buildOLSSuffStats accepts dummySQL substitutions"
```

---

### Task 4: HC0/HC1 meat pass (no leverage)

**Files:**
- Create: `src/services/data/duckdbRobustSE.js`
- Create: `src/services/data/__validation__/robustSEValidation.js`
- Create: `src/services/data/__validation__/robustSEValidation.runner.js`

- [ ] **Step 1: Write failing import test**

```js
import { computeHCMeat } from "../duckdbRobustSE.js";

let passes = 0, fails = 0;
const check = (n, c) => c ? (passes++, console.log(`  ✓ ${n}`)) : (fails++, console.error(`  ✗ ${n}`));

async function validateImport() {
  console.log("\n[computeHCMeat]");
  check("computeHCMeat is a function", typeof computeHCMeat === "function");
}

export async function runRobustSEValidation() {
  passes = 0; fails = 0;
  await validateImport();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
```

Mirror the runner pattern.

Note: numerical validation lives in Task 10 because it needs a real DuckDB-Wasm context. This task only verifies structure.

- [ ] **Step 2: Run — import fails**

Expected: module not found.

- [ ] **Step 3: Implement computeHCMeat**

```js
// ─── ECON STUDIO · src/services/data/duckdbRobustSE.js ────────────────────────
// HC0/HC1/HC2/HC3 sandwich meat-matrix computation pushed into DuckDB.
//
// β and Ainv are passed as prepared-statement parameters — never string
// interpolated. The residual êᵢ = yᵢ - Xᵢ β is expressed inline as a SUM
// of products. HC0 returns raw meat; HC1 = HC0 × n/(n-k) (caller scales).
// HC2/HC3 inject Ainv to compute leverage hᵢᵢ.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

export async function computeHCMeat({ tableName, yCol, xColsExpanded, dummySQL = {}, beta }) {
  const { conn } = await getDuckDB();
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

  const yhatTerms = [];
  const params = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    params.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const yExpr    = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const residSQL = `(${yExpr} - (${yhatSQL}))`;

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) * ${xExpr(i)} * ${xExpr(j)}) AS m_${i}_${j}`
      );
    }
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);

  const sql = `
    SELECT ${aggs.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
  `;

  // POWER(residSQL, 2) inlines residSQL twice; each occurrence consumes the
  // full param list. Replicate by counting occurrences in the SQL string.
  const residOccurrences = (sql.match(/\(_y_|TRY_CAST/g) || []).length;
  // Safer: residSQL appears once per aggregate (in POWER) + once per "*"
  // multiplier — we count the literal residSQL substring instead.
  const literalCount = sql.split(residSQL).length - 1;
  const boundParams = [];
  for (let i = 0; i < literalCount; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
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

- [ ] **Step 4: Run — confirm pass**

Expected: import test passes.

- [ ] **Step 5: Commit**

```
git add src/services/data/duckdbRobustSE.js src/services/data/__validation__/robustSEValidation.js src/services/data/__validation__/robustSEValidation.runner.js
git commit -m "feat(data): Fase 1 — computeHCMeat (HC0/HC1) via prepared statement"
```

---

### Task 5: HC2/HC3 meat with leverage

**Files:**
- Modify: `src/services/data/duckdbRobustSE.js`
- Modify: `src/services/data/__validation__/robustSEValidation.js`

- [ ] **Step 1: Extend import test**

Add to `validateImport()`:

```js
const mod = await import("../duckdbRobustSE.js");
check("computeHCMeatWithLeverage is a function",
  typeof mod.computeHCMeatWithLeverage === "function");
```

- [ ] **Step 2: Run — confirm failure (not exported)**

- [ ] **Step 3: Implement computeHCMeatWithLeverage**

Append to duckdbRobustSE.js:

```js
export async function computeHCMeatWithLeverage({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, Ainv, hcType,
}) {
  const { conn } = await getDuckDB();
  const k = xColsExpanded.length;
  const dim = k + 1;
  const p = hcType === "HC3" ? 2 : 1;

  const xExpr = (i) => {
    if (i === 0) return "1.0";
    const name = xColsExpanded[i - 1];
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };

  const params = [];

  // yhat ────────────────────────────────────────────────────────────────
  const yhatTerms = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    params.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const yExpr    = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const residSQL = `(${yExpr} - (${yhatSQL}))`;

  // hᵢᵢ = Σ_j Σ_l Ainv[j][l] x_j x_l, symmetric → upper triangle ×2 ───────
  const hTerms = [];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const coef = j === l ? "?" : "(2.0 * ?)";
      hTerms.push(`${coef} * ${xExpr(j)} * ${xExpr(l)}`);
      params.push(Ainv[j][l]);
    }
  }
  const hSQL     = hTerms.join(" + ");
  const denomSQL = `POWER(1.0 - (${hSQL}), ${p})`;

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) / ${denomSQL} * ${xExpr(i)} * ${xExpr(j)}) AS m_${i}_${j}`
      );
    }
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);

  const sql = `
    SELECT ${aggs.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
  `;

  // β params replicated per residSQL occurrence; Ainv params replicated per
  // denomSQL occurrence.
  const residCount = sql.split(residSQL).length - 1;
  const hCount     = sql.split(hSQL).length - 1;
  const betaArr = params.slice(0, dim);
  const ainvArr = params.slice(dim);
  const boundParams = [];
  // Walk through the aggregates in order; each contains one residSQL and one denom.
  // Simpler: residSQL params and h params each repeat by their respective counts.
  for (let i = 0; i < residCount; i++) boundParams.push(...betaArr);
  for (let i = 0; i < hCount; i++) boundParams.push(...ainvArr);
  // Note: this assumes DuckDB resolves placeholders left-to-right across the
  // SELECT list. If it does not, the safer approach is to compute residSQL and
  // hSQL once in a CTE — recorded as a follow-up.

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
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

> **Risk note:** the parameter ordering between residSQL repetitions and hSQL repetitions in the same SELECT is a known fragility. If Task 10 validation shows numerical mismatch, refactor to a CTE that precomputes `e2` and `h_ii` once, then aggregates against those columns. The CTE form needs zero parameter replication.

- [ ] **Step 4: Run — confirm pass**

- [ ] **Step 5: Commit**

```
git add src/services/data/duckdbRobustSE.js src/services/data/__validation__/robustSEValidation.js
git commit -m "feat(data): Fase 1 — computeHCMeatWithLeverage (HC2/HC3)"
```

---

### Task 6: runOLSFromSuffStats accepts robust meat

**Files:**
- Modify: `src/math/LinearEngine.js`

- [ ] **Step 1: Change function signature and SE block**

Replace the current `runOLSFromSuffStats` with:

```js
export function runOLSFromSuffStats({
  n, XtX, XtY, YtY, sumY, varNames,
  meat = null, hcType = null,
}) {
  const k = XtX.length;
  if (!Number.isFinite(n) || n < k + 1) return null;

  const XtXinv = matInv(XtX);
  if (!XtXinv) return null;

  const beta = XtXinv.map(row => row.reduce((s, v, j) => s + v * XtY[j], 0));

  const betaXtY = beta.reduce((s, b, i) => s + b * XtY[i], 0);
  const SSR = YtY - betaXtY;
  const df  = n - k;
  const s2  = SSR / Math.max(1, df);
  const SST = YtY - (sumY * sumY) / n;
  const R2  = SST > 0 ? 1 - SSR / SST : 0;
  const adjR2 = 1 - (1 - R2) * (n - 1) / Math.max(1, df);

  let se;
  if (meat !== null) {
    const dim = k;
    const tmp = Array.from({ length: dim }, () => Array(dim).fill(0));
    for (let i = 0; i < dim; i++)
      for (let j = 0; j < dim; j++)
        for (let l = 0; l < dim; l++) tmp[i][j] += XtXinv[i][l] * meat[l][j];
    const V = Array.from({ length: dim }, () => Array(dim).fill(0));
    for (let i = 0; i < dim; i++)
      for (let j = 0; j < dim; j++)
        for (let l = 0; l < dim; l++) V[i][j] += tmp[i][l] * XtXinv[l][j];
    const scale = hcType === "HC1" ? n / Math.max(1, df) : 1;
    se = V.map((row, i) => Math.sqrt(Math.max(0, row[i] * scale)));
  } else {
    se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  }

  const tStats = beta.map((b, i) => b / se[i]);
  const pVals  = tStats.map(t => pValue(t, df));

  const kReg  = k - 1;
  const Fstat = kReg > 0 ? ((SST - SSR) / kReg) / s2 : 0;
  const Fpval = kReg > 0 ? fCDF(Fstat, kReg, df)    : 1;

  return {
    beta, se, tStats, pVals, R2, adjR2,
    n, df, SSR, s2,
    resid: null, Yhat: null,
    Fstat, Fpval, varNames, XtXinv,
    _suffStats: true,
    _hcType: hcType,
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Smoke verify classical path unchanged**

Run the existing engine validation harness (whatever entry point already validates `runOLSFromSuffStats` against R OLS golden values):

`node src/math/__validation__/engineValidation.runner.js` (or equivalent — check the actual filename)

Expected: existing OLS β/SE/R² golden checks still pass.

- [ ] **Step 4: Commit**

```
git add src/math/LinearEngine.js
git commit -m "feat(math): runOLSFromSuffStats accepts robust-SE meat matrix"
```

---

### Task 7: Lazy residual sampling

**Files:**
- Create: `src/services/data/duckdbResiduals.js`

- [ ] **Step 1: Write the module**

```js
// ─── ECON STUDIO · src/services/data/duckdbResiduals.js ───────────────────────
// On-demand residual sampling for the SQL OLS path. Returns a fixed-size
// random sample (default 5000 rows) of {resid, yhat, x_*}. Consumers call
// this via the _residualsThunk attached to EstimationResult.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

export async function sampleResiduals({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, sampleSize = 5000,
}) {
  const { conn } = await getDuckDB();
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

  const yhatTerms = [];
  const params = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    params.push(beta[i]);
  }
  const yhatSQL = yhatTerms.join(" + ");
  const yExpr   = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const projections = [
    `${yExpr} - (${yhatSQL}) AS _resid`,
    `${yhatSQL} AS _yhat`,
  ];
  for (let i = 0; i < k; i++) {
    projections.push(`${xExpr(i + 1)} AS _x_${i}`);
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);

  const sql = `
    SELECT ${projections.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
    USING SAMPLE ${sampleSize} ROWS
  `;

  // yhatSQL is referenced twice (once for resid, once for yhat) → params×2
  const literalCount = sql.split(yhatSQL).length - 1;
  const boundParams = [];
  for (let i = 0; i < literalCount; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const arr = result.toArray();

  const resid = arr.map(r => num(r._resid));
  const yhat  = arr.map(r => num(r._yhat));
  const xSample = arr.map(r => {
    const row = [1];
    for (let i = 0; i < k; i++) row.push(num(r[`_x_${i}`]));
    return row;
  });

  return { resid, yhat, xSample, _isSample: true, _nSample: arr.length };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```
git add src/services/data/duckdbResiduals.js
git commit -m "feat(data): Fase 1 — sampleResiduals() lazy 5k-row residual thunk"
```

---

### Task 8: Cheap diagnostics in SQL

**Files:**
- Create: `src/services/data/duckdbDiagnostics.js`

Strategy decision: use a CTE that materializes `e` and `x_*` once per query, instead of inlining `residSQL` everywhere. This sidesteps the parameter-replication fragility documented in Task 5.

- [ ] **Step 1: Write the module**

```js
// ─── ECON STUDIO · src/services/data/duckdbDiagnostics.js ─────────────────────
// SQL implementations of Breusch-Pagan, Durbin-Watson, Jarque-Bera.
// VIF and condition number stay JS (computed from cached X'X).
//
// All three tests need β. Each uses a CTE that computes e and x_* once;
// the outer SELECT aggregates against the CTE columns. No parameter
// repetition in the prepared statement — only β bound (dim params).

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

function buildCTE({ tableName, yCol, xColsExpanded, dummySQL = {}, beta }) {
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

  const projections = [`${yExpr} AS _y`];
  for (let i = 0; i < dim; i++) projections.push(`${xExpr(i)} AS _x_${i}`);

  const yhatTerms = [];
  const params = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * _x_${i}`);
    params.push(beta[i]);
  }
  // Note: yhat references _x_i which exists only in the next layer. Use a
  // second CTE step.
  const finite = [`isfinite(_y)`];
  for (let i = 0; i < dim; i++) finite.push(`isfinite(_x_${i})`);

  const cteSQL = `
    base AS (
      SELECT ${projections.join(", ")}
      FROM ${esc(tableName)}
    ),
    mf AS (
      SELECT *,
             (${yhatTerms.join(" + ")}) AS _yhat,
             _y - (${yhatTerms.join(" + ")}) AS _e
      FROM base
      WHERE ${finite.join(" AND ")}
    )
  `;
  // yhatTerms appears twice in mf — replicate β.
  const boundParams = [...params, ...params];
  return { cteSQL, dim, boundParams };
}

export async function jarqueBeraSQL(args) {
  const { conn } = await getDuckDB();
  const { cteSQL, boundParams } = buildCTE(args);
  const sql = `
    WITH ${cteSQL}
    SELECT
      COUNT(*) AS n,
      SUM(POWER(_e, 2)) AS s2,
      SUM(POWER(_e, 3)) AS s3,
      SUM(POWER(_e, 4)) AS s4
    FROM mf
  `;
  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();
  const n  = num(r.n);
  const m2 = num(r.s2) / n;
  const m3 = num(r.s3) / n;
  const m4 = num(r.s4) / n;
  const skew = m3 / Math.pow(m2, 1.5);
  const kurt = m4 / (m2 * m2);
  const JB = (n / 6) * (skew * skew + Math.pow(kurt - 3, 2) / 4);
  return { statistic: JB, df: 2, skew, kurtosis: kurt, n };
}

export async function durbinWatsonSQL({ orderCol = "__ri", entityCol = null, ...args }) {
  const { conn } = await getDuckDB();
  const { cteSQL, boundParams } = buildCTE(args);
  const partition = entityCol ? `PARTITION BY ${esc(entityCol)} ` : "";
  const sql = `
    WITH ${cteSQL},
    lagged AS (
      SELECT _e,
             LAG(_e) OVER (${partition}ORDER BY ${esc(orderCol)}) AS _e_lag
      FROM mf
    )
    SELECT
      SUM(POWER(_e - _e_lag, 2)) AS num,
      SUM(_e * _e)               AS den
    FROM lagged
    WHERE _e_lag IS NOT NULL
  `;
  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();
  return { statistic: num(r.num) / num(r.den) };
}

export async function breuschPaganSQL(args) {
  // BP statistic = n * R²_aux, where R²_aux comes from regressing e² on X.
  // Build suff stats for the aux regression in SQL (no JS row materialization).
  const { conn } = await getDuckDB();
  const { cteSQL, boundParams, dim } = buildCTE(args);

  // Aggregates: n, sum(e²), sum((e²-mean)²), and X'X / X'e² for solving β_aux.
  const aggs = [
    `COUNT(*) AS n`,
    `SUM(POWER(_e, 2)) AS sum_e2`,
    `SUM(POWER(POWER(_e, 2) - (SELECT AVG(POWER(_e, 2)) FROM mf), 2)) AS sst_e2`,
  ];
  for (let i = 0; i < dim; i++) {
    aggs.push(`SUM(POWER(_e, 2) * _x_${i}) AS xe_${i}`);
    for (let j = i; j < dim; j++) {
      aggs.push(`SUM(_x_${i} * _x_${j}) AS xx_${i}_${j}`);
    }
  }
  const sql = `
    WITH ${cteSQL}
    SELECT ${aggs.join(", ")}
    FROM mf
  `;
  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const n   = num(r.n);
  const XtX = Array.from({ length: dim }, () => Array(dim).fill(0));
  const Xte = Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    Xte[i] = num(r[`xe_${i}`]);
    for (let j = i; j < dim; j++) {
      const v = num(r[`xx_${i}_${j}`]);
      XtX[i][j] = v;
      if (i !== j) XtX[j][i] = v;
    }
  }
  return { n, XtX, Xte, sst_e2: num(r.sst_e2), df: dim - 1 };
  // Caller solves β_aux = inv(XtX) Xte, computes SSR_aux = Σ_i (eᵢ² - x'β_aux)²,
  // R² = 1 - SSR/SST, statistic = n·R². Caller has matrix utilities.
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
git add src/services/data/duckdbDiagnostics.js
git commit -m "feat(data): Fase 1 — BP/DW/JB diagnostics in SQL (CTE form)"
```

---

### Task 9: Wire SE + factors + residuals into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add imports**

Append to the existing data-service import block (after the Fase 0 imports added in commit 653da6f):

```js
import { expandFactors }      from "../services/data/duckdbFactors.js";
import { computeHCMeat, computeHCMeatWithLeverage } from "../services/data/duckdbRobustSE.js";
import { sampleResiduals }    from "../services/data/duckdbResiduals.js";
```

- [ ] **Step 2: Replace the SQL fast-path block in estimate()**

Currently (post-Fase-0, in ModelingTab.jsx around line 1720):

```js
if (shouldUseSQLPath(dispatchCtx) && yVar[0] && allX.length > 0) {
  try {
    const cache = suffStatsCacheRef.current;
    const key   = makeCacheKey(duckTable, yVar[0], allX);
    let suff    = cache.get(key);
    let cacheHit = suff != null && validateSuffStatsEntry(suff, allX);
    if (!cacheHit) {
      const m = await measure(() => buildOLSSuffStats(duckTable, yVar[0], allX));
      suff = m.result;
      cache.set(key, suff);
      logEstimate({ path: "sql", phase: "suffStats", n: rowCount, k: allX.length, msTotal: m.ms });
    }
    const m2 = await measure(async () => runOLSFromSuffStats(suff));
    const raw = m2.result;
    logEstimate({ path: "sql", phase: "solve", n: rowCount, k: allX.length, seType: dispatchCtx.seType, cacheHit, msTotal: m2.ms });
    if (raw) {
      const wrapped = wrapResult("OLS", raw, { yVar: yVar[0], xVars, wVars, weightCol: null });
      setResult(wrapped); return;
    }
  } catch (e) { console.warn("[ModelingTab] SQL path failed, falling back to JS:", e); }
}
```

Replace with:

```js
if (shouldUseSQLPath(dispatchCtx) && yVar[0] && allX.length > 0) {
  try {
    const { xColsExpanded, dummySQL } = await expandFactors({
      xCols: allX, tableName: duckTable,
    });
    // Re-check post-expansion k against threshold
    if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded })) {
      throw new Error("Post-expansion k exceeds threshold — fallback to JS");
    }

    const cache = suffStatsCacheRef.current;
    const key   = makeCacheKey(duckTable, yVar[0], xColsExpanded);
    let entry   = cache.get(key);
    let cacheHit = entry != null && validateSuffStatsEntry(entry, xColsExpanded);
    if (!cacheHit) {
      const m = await measure(() => buildOLSSuffStats(duckTable, yVar[0], xColsExpanded, { dummySQL }));
      entry = { ...m.result, dummySQL };
      cache.set(key, entry);
      logEstimate({ path: "sql", phase: "suffStats", n: rowCount, k: xColsExpanded.length, msTotal: m.ms });
    }

    // Compute β and Ainv once (needed for HC2/HC3 leverage). Cached on entry.
    if (!entry.beta) {
      const classicalRaw = runOLSFromSuffStats({
        n: entry.n, XtX: entry.XtX, XtY: entry.XtY,
        YtY: entry.YtY, sumY: entry.sumY, varNames: entry.varNames,
      });
      if (!classicalRaw) throw new Error("Suff-stats solve returned null (singular X'X)");
      entry.beta = classicalRaw.beta;
      entry.Ainv = classicalRaw.XtXinv;
    }

    // Meat pass (only if non-classical)
    let meat = null;
    const hc = seType && seType !== "classical" ? seType : null;
    if (hc) {
      const mm = await measure(async () => {
        if (hc === "HC0" || hc === "HC1") {
          return computeHCMeat({
            tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL, beta: entry.beta,
          });
        }
        return computeHCMeatWithLeverage({
          tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
          beta: entry.beta, Ainv: entry.Ainv, hcType: hc,
        });
      });
      meat = mm.result.meat;
      logEstimate({ path: "sql", phase: `meat-${hc}`, n: rowCount, k: xColsExpanded.length, msTotal: mm.ms });
    }

    const m2 = await measure(async () => runOLSFromSuffStats({
      n: entry.n, XtX: entry.XtX, XtY: entry.XtY,
      YtY: entry.YtY, sumY: entry.sumY, varNames: entry.varNames,
      meat, hcType: hc,
    }));
    const raw = m2.result;
    logEstimate({
      path: "sql", phase: "solve", n: rowCount, k: xColsExpanded.length,
      seType, cacheHit, msTotal: m2.ms,
    });

    if (raw) {
      raw._hasLazyResiduals = true;
      raw._residualsThunk   = () => sampleResiduals({
        tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
        beta: raw.beta, sampleSize: 5000,
      });
      const wrapped = wrapResult("OLS", raw, {
        yVar: yVar[0], xVars, wVars, weightCol: null,
      });
      setResult(wrapped);
      return;
    }
  } catch (e) {
    console.warn("[ModelingTab] SQL path failed, falling back to JS:", e);
  }
}
```

- [ ] **Step 3: Run npm build**

Expected: clean.

- [ ] **Step 4: Manual smoke test in browser**

1. Load a >50k row CSV/Parquet.
2. Run OLS with classical SE → should match previous behavior.
3. Toggle SE type to HC1 → cache hit on suff stats, one meat-HC1 perfLog entry.
4. Toggle to HC3 → cache hit on suff stats, meat-HC3 entry.
5. Add a categorical column wrapped as `factor(...)` → dummies expanded in SQL, no error.
6. Open Residual Plots panel → triggers thunk, 5k-point scatter renders.
7. DevTools: `window.__perfLog.getEntries()` should show distinct `phase` values per SE flip with `cacheHit: true` on the suff-stats line.

- [ ] **Step 5: Commit**

```
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 1 — robust SE meat + factors + lazy residuals in SQL path"
```

---

### Task 10: R validation harness for HC0–3

**Files:**
- Create: `src/services/data/__validation__/fase1RValidation.R`
- Create: `src/services/data/__validation__/fase1Benchmarks.json` (output)
- Modify: `src/services/data/__validation__/robustSEValidation.js`

- [ ] **Step 1: Generate golden values in R**

```r
# fase1RValidation.R — golden coefficients, classical and HC0-3 SEs, BP/DW/JB
set.seed(42)
n <- 50000
x1 <- rnorm(n)
x2 <- rnorm(n)
country <- sample(c("DE", "FR", "IT", "ES"), n, replace = TRUE)
e <- rnorm(n) * (1 + abs(x1))  # heteroskedastic
y <- 1 + 2*x1 - 0.5*x2 + (country == "FR") * 0.7 + (country == "IT") * -0.3 + e

df <- data.frame(y = y, x1 = x1, x2 = x2, country = country)
write.csv(df, "fase1_data.csv", row.names = FALSE)

library(sandwich)
library(lmtest)
fit <- lm(y ~ x1 + x2 + country, data = df)

result <- list(
  beta         = as.numeric(coef(fit)),
  varNames     = names(coef(fit)),
  se_classical = as.numeric(sqrt(diag(vcov(fit)))),
  se_HC0       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC0")))),
  se_HC1       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC1")))),
  se_HC2       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC2")))),
  se_HC3       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC3")))),
  bp           = bptest(fit)$statistic,
  dw           = dwtest(fit)$statistic,
  jb           = tseries::jarque.bera.test(residuals(fit))$statistic
)

jsonlite::write_json(result, "fase1Benchmarks.json", auto_unbox = TRUE, digits = 8)
```

- [ ] **Step 2: Run R to generate benchmarks**

Run: `Rscript src/services/data/__validation__/fase1RValidation.R`
Expected: `fase1_data.csv` + `fase1Benchmarks.json` written next to the .R file.

- [ ] **Step 3: Extend robustSEValidation.js with browser-side numerical compare**

Add a function that runs `buildOLSSuffStats → runOLSFromSuffStats({...meat})` for each seType inside the running DuckDB-Wasm instance, comparing to the R benchmarks. Gate behind `typeof window !== 'undefined'` and expose via `window.__validation.fase1`.

```js
import benchmarks from "./fase1Benchmarks.json" assert { type: "json" };
import { buildOLSSuffStats } from "../duckdbOLS.js";
import { computeHCMeat, computeHCMeatWithLeverage } from "../duckdbRobustSE.js";
import { runOLSFromSuffStats } from "../../../math/LinearEngine.js";
import { expandFactors } from "../duckdbFactors.js";
import { getDuckDB } from "../duckdb.js";

function close6(a, b) { return Math.abs(a - b) < 1e-6; }
function close4(a, b) { return Math.abs(a - b) < 1e-4; }

export async function runFase1NumericalValidation(tableName = "fase1") {
  const { xColsExpanded, dummySQL } = await expandFactors({
    xCols: ["x1", "x2", "factor(country)"], tableName,
  });
  const suff = await buildOLSSuffStats(tableName, "y", xColsExpanded, { dummySQL });
  const classical = runOLSFromSuffStats({ ...suff });

  let passes = 0, fails = 0;
  const check = (n, c) => c ? (passes++, console.log(`  ✓ ${n}`)) : (fails++, console.error(`  ✗ ${n}`));

  benchmarks.beta.forEach((b, i) =>
    check(`β[${i}] matches R (6dp)`, close6(classical.beta[i], b)));
  benchmarks.se_classical.forEach((s, i) =>
    check(`SE classical[${i}] (4dp)`, close4(classical.se[i], s)));

  for (const hc of ["HC0", "HC1", "HC2", "HC3"]) {
    const meatRes = (hc === "HC0" || hc === "HC1")
      ? await computeHCMeat({ tableName, yCol: "y", xColsExpanded, dummySQL, beta: classical.beta })
      : await computeHCMeatWithLeverage({ tableName, yCol: "y", xColsExpanded, dummySQL,
                                          beta: classical.beta, Ainv: classical.XtXinv, hcType: hc });
    const r = runOLSFromSuffStats({ ...suff, meat: meatRes.meat, hcType: hc });
    benchmarks[`se_${hc}`].forEach((s, i) =>
      check(`SE ${hc}[${i}] (4dp)`, close4(r.se[i], s)));
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase1 = runFase1NumericalValidation;
}
```

- [ ] **Step 4: Run validation in browser**

Start the dev server (`npm run dev`), import `fase1_data.csv` via Data tab, ensure the DuckDB table name is `fase1`, then in DevTools:

```js
await window.__validation.fase1();
```

Expected: every β within 1e-6 of R, every SE (classical + HC0-3) within 1e-4. If any HC SE fails, the parameter-replication assumption in Task 4/5 is the prime suspect — refactor those queries to the CTE pattern used in Task 8.

- [ ] **Step 5: Commit**

```
git add src/services/data/__validation__/fase1RValidation.R src/services/data/__validation__/fase1Benchmarks.json src/services/data/__validation__/robustSEValidation.js
git commit -m "test(data): Fase 1 — R sandwich::vcovHC golden values for HC0-3"
```

---

### Final review

After Task 10, dispatch the code-reviewer agent over the full Fase 1 diff (commits since the Fase 0 wiring at `653da6f`). Review focus:
- Prepared-statement parameter counts: do the param-replication heuristics in Tasks 4–5 hold across DuckDB-Wasm versions?
- Factor expansion escaping: are category names with quotes, parens, or NULL handled safely?
- Cache key uses `xColsExpanded` (post-expansion) — confirm it never aliases with a pre-expansion key from old cache entries.
- Build size: did the new diagnostics file materially affect the main bundle?

Then update `CLAUDE.md` § Pending to mark Fase 1 done and add the new file paths to the structure tree.
