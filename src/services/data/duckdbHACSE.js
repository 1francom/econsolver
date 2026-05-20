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

  // yhatSQL appears exactly twice in mf CTE (once for _yhat, once for _e).
  // Use sql.split(yhatSQL) to count occurrences — matches the Fase 1 pattern
  // in duckdbRobustSE.computeHCMeat and computeClusterMeat. If a future
  // refactor changes the mf CTE, this guard throws with an actionable message.
  const yhatOccurrences = sql.split(yhatSQL).length - 1;
  if (yhatOccurrences !== 2) {
    throw new Error(
      `computeHACMeat: yhatSQL occurrence count mismatch ` +
      `(found ${yhatOccurrences}, expected 2). ` +
      `If you refactored the mf CTE, update this guard.`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < yhatOccurrences; i++) boundParams.push(...params);

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
