// ─── ECON STUDIO · src/services/data/duckdbDiagnostics.js ─────────────────────
// SQL implementations of Breusch-Pagan, Durbin-Watson, Jarque-Bera tests.
// VIF and condition number stay JS-only (computed from cached X'X).
//
// Each test uses a CTE that materializes _e (residual) and _x_* once; the
// outer SELECT aggregates against CTE columns. β is bound only for yhatSQL
// occurrences inside the CTE — no proliferating placeholder replication.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"` }
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

  // base CTE: project y and x_i. Then mf: filter finite, compute yhat and e.
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

  const cteSQL = `
    base AS (
      SELECT ${baseProjections.join(", ")}
      FROM ${esc(tableName)}
    ),
    mf AS (
      SELECT *,
             (${yhatSQL}) AS _yhat,
             _y - (${yhatSQL}) AS _e
      FROM base
      WHERE ${finite.join(" AND ")}
    )
  `;
  // yhatSQL referenced twice in mf — params replicated once.
  const boundParams = [...params, ...params];
  return { cteSQL, dim, boundParams };
}

/**
 * Jarque-Bera: JB = n/6 · (S² + (K − 3)² / 4), where S = skewness, K = kurtosis.
 * OLS residuals sum to zero by construction, so first moment is treated as 0.
 */
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

/**
 * Durbin-Watson: DW = Σ (eᵢ − eᵢ₋₁)² / Σ eᵢ².
 * Default order is the __ri row-index column. If panel data, pass entityCol
 * to partition the LAG window by entity (prevents cross-unit contamination).
 */
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

/**
 * Breusch-Pagan: aux regression e² ~ X. Returns the raw sufficient stats
 * (n, X'X, X'(e²), SST_e²) — the caller solves β_aux in JS, computes
 * R²_aux = 1 − SSR / SST, and reports statistic = n · R²_aux ~ χ²(k).
 */
export async function breuschPaganSQL(args) {
  const { conn } = await getDuckDB();
  const { cteSQL, boundParams, dim } = buildCTE(args);

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
  // The subquery `SELECT AVG(POWER(_e, 2)) FROM mf` re-references mf, which
  // re-runs the CTE under DuckDB's planner. Count `FROM mf` occurrences.
  const fromMfCount = (sql.match(/FROM mf\b/g) || []).length;
  const finalParams = [];
  for (let i = 0; i < fromMfCount; i++) finalParams.push(...boundParams);

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...finalParams)).toArray()[0];
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
}

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
