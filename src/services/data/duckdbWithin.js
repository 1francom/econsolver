// ─── ECON STUDIO · src/services/data/duckdbWithin.js ───────────────────────────
// Within-transform sufficient-statistics push-down for panel estimators.
//
// Two modes:
//   FE: within demeaning with grand-mean recentering (matches PanelEngine.runFE):
//       x̃ᵢₜ = xᵢₜ - x̄ᵢ + x̄  (same for y)
//       OLS with intercept on (ỹ, x̃) yields the same β as plm/fixest.
//   FD: first differences within entity, ordered by time (matches runFD):
//       Δxᵢₜ = xᵢₜ - xᵢ,ₜ₋₁
//       Rows where any diff is NULL (boundary / non-numeric) are dropped.
//
// Returns:
//   { n, n_units, XtX, XtY, YtY, sumY, varNames, mode, unitCol, timeCol,
//     withinCTEPrefix } — the meat builder reuses withinCTEPrefix to compute
//     Σ êᵢ² x̃ᵢx̃ⱼ in a second SQL pass with β as prepared params.
//
// withinCTEPrefix is a "WITH … wf AS (…)" string. Consumers append their own
// "SELECT … FROM wf" or "SELECT … FROM wf WHERE …".

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {string}   tableName
 * @param {string}   yCol
 * @param {string[]} xCols
 * @param {string}   unitCol
 * @param {object}   opts
 * @param {"FE"|"FD"|"TWFE"} opts.mode
 * @param {string}   [opts.timeCol]        required for FD and TWFE
 * @param {Record<string,string>} [opts.dummySQL]  factor-expansion CASE WHEN map
 *
 * Option-A canonical projection: _g = _u_ and _t_h = _t_ are always projected
 * into wf when timeCol is present, so the cache key stays mode-only and SE
 * flips reuse the same withinCTEPrefix.
 */
export async function buildWithinSuffStats(tableName, yCol, xCols, unitCol, opts = {}) {
  const { mode, timeCol, dummySQL = {} } = opts;
  if (!["FE", "FD", "TWFE"].includes(mode)) {
    throw new Error(`buildWithinSuffStats: invalid mode "${mode}" (expected "FE", "FD", or "TWFE")`);
  }
  if ((mode === "FD" || mode === "TWFE") && !timeCol) {
    throw new Error(`buildWithinSuffStats: ${mode} mode requires timeCol`);
  }
  if (!unitCol) throw new Error("buildWithinSuffStats: unitCol required");

  const k = xCols.length;
  if (k < 1) throw new Error("buildWithinSuffStats: need at least one regressor");

  const { conn } = await getDuckDB();

  const colExpr = (c) => Object.prototype.hasOwnProperty.call(dummySQL, c)
    ? `CAST((${dummySQL[c]}) AS DOUBLE)`
    : `TRY_CAST(${esc(c)} AS DOUBLE)`;

  const yExpr  = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const xExprs = xCols.map(colExpr);

  // ── base CTE: cast + filter for finite y / x; carry _u_, _t_ (FD/TWFE), _g=_u_, _t_h=_t_ ──
  const baseProj = [`${yExpr} AS _yb_`, `${esc(unitCol)} AS _u_`];
  xExprs.forEach((e, i) => baseProj.push(`${e} AS _xb_${i}`));
  // _t_ needed by FD/TWFE for lag/time-mean; carry when timeCol available
  if (timeCol) baseProj.push(`${esc(timeCol)} AS _t_`);
  // Option A: always carry _g (cluster=entity) and _t_h (HAC time) for SE reuse
  baseProj.push(`${esc(unitCol)} AS _g`);
  if (timeCol) baseProj.push(`${esc(timeCol)} AS _t_h`);

  const baseFinite = [`isfinite(_yb_)`, `_u_ IS NOT NULL`];
  for (let i = 0; i < k; i++) baseFinite.push(`isfinite(_xb_${i})`);
  if (timeCol) baseFinite.push(`_t_ IS NOT NULL`);

  const baseCTE = `base AS (
    SELECT ${baseProj.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${baseFinite.join(" AND ")}
  )`;

  let withinCTEPrefix;
  if (mode === "FE") {
    const umAggs = [`_u_`, `AVG(_yb_) AS m_y`];
    for (let i = 0; i < k; i++) umAggs.push(`AVG(_xb_${i}) AS m_x_${i}`);

    const gmAggs = [`AVG(_yb_) AS g_y`];
    for (let i = 0; i < k; i++) gmAggs.push(`AVG(_xb_${i}) AS g_x_${i}`);

    const finalProj = [`(base._yb_ - um.m_y + gm.g_y) AS _y_`];
    for (let i = 0; i < k; i++) {
      finalProj.push(`(base._xb_${i} - um.m_x_${i} + gm.g_x_${i}) AS _x_${i}`);
    }
    finalProj.push(`base._u_ AS _u_`);
    finalProj.push(`base._g AS _g`);
    if (timeCol) finalProj.push(`base._t_h AS _t_h`);

    withinCTEPrefix = `WITH ${baseCTE},
      um AS (SELECT ${umAggs.join(", ")} FROM base GROUP BY _u_),
      gm AS (SELECT ${gmAggs.join(", ")} FROM base),
      wf AS (
        SELECT ${finalProj.join(", ")}
        FROM base
        JOIN um ON base._u_ = um._u_
        CROSS JOIN gm
      )`;
  } else if (mode === "FD") {
    const lagProj = [
      `(_yb_ - LAG(_yb_) OVER (PARTITION BY _u_ ORDER BY _t_)) AS _y_`,
    ];
    for (let i = 0; i < k; i++) {
      lagProj.push(`(_xb_${i} - LAG(_xb_${i}) OVER (PARTITION BY _u_ ORDER BY _t_)) AS _x_${i}`);
    }
    // _g and _t_h from second row of each pair (matches runFD JS convention)
    lagProj.push(`_u_`, `_g`, `_t_h`);

    const fdFinite = [`_y_ IS NOT NULL`, `isfinite(_y_)`];
    for (let i = 0; i < k; i++) fdFinite.push(`_x_${i} IS NOT NULL`, `isfinite(_x_${i})`);

    withinCTEPrefix = `WITH ${baseCTE},
      diffs AS (
        SELECT ${lagProj.join(", ")}
        FROM base
      ),
      wf AS (
        SELECT * FROM diffs
        WHERE ${fdFinite.join(" AND ")}
      )`;
  } else {
    // TWFE: double-demean (unit-mean + time-mean − grand-mean)
    const umAggs = [`_u_`, `AVG(_yb_) AS m_y`];
    for (let i = 0; i < k; i++) umAggs.push(`AVG(_xb_${i}) AS m_x_${i}`);

    const tmAggs = [`_t_`, `AVG(_yb_) AS t_y`];
    for (let i = 0; i < k; i++) tmAggs.push(`AVG(_xb_${i}) AS t_x_${i}`);

    const gmAggs = [`AVG(_yb_) AS g_y`];
    for (let i = 0; i < k; i++) gmAggs.push(`AVG(_xb_${i}) AS g_x_${i}`);

    const finalProj = [
      `(base._yb_ - um.m_y - tm.t_y + gm.g_y) AS _y_`,
    ];
    for (let i = 0; i < k; i++) {
      finalProj.push(
        `(base._xb_${i} - um.m_x_${i} - tm.t_x_${i} + gm.g_x_${i}) AS _x_${i}`
      );
    }
    finalProj.push(`base._u_ AS _u_`, `base._t_ AS _t_`, `base._g AS _g`, `base._t_h AS _t_h`);

    withinCTEPrefix = `WITH ${baseCTE},
      um AS (SELECT ${umAggs.join(", ")} FROM base GROUP BY _u_),
      tm AS (SELECT ${tmAggs.join(", ")} FROM base GROUP BY _t_),
      gm AS (SELECT ${gmAggs.join(", ")} FROM base),
      wf AS (
        SELECT ${finalProj.join(", ")}
        FROM base
        JOIN um ON base._u_ = um._u_
        JOIN tm ON base._t_ = tm._t_
        CROSS JOIN gm
      )`;
  }

  // ── aggregation: same shape as buildOLSSuffStats (sum_y, sum_x_i, sum_xx_i_j, …)
  const aggs = [
    `COUNT(*) AS n`,
    `COUNT(DISTINCT _u_) AS n_units`,
    `SUM(_y_) AS sum_y`,
    `SUM(_y_ * _y_) AS yty`,
  ];
  if (mode === "TWFE") aggs.push(`COUNT(DISTINCT _t_) AS n_times`);
  for (let i = 0; i < k; i++) {
    aggs.push(`SUM(_x_${i}) AS sum_x_${i}`);
    aggs.push(`SUM(_x_${i} * _y_) AS sum_xy_${i}`);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      aggs.push(`SUM(_x_${i} * _x_${j}) AS sum_xx_${i}_${j}`);
    }
  }

  const sql = `${withinCTEPrefix}
    SELECT ${aggs.join(", ")} FROM wf`;

  const r = (await conn.query(sql)).toArray()[0];

  const n       = num(r.n);
  const nUnits  = num(r.n_units);
  const nTimes  = mode === "TWFE" ? num(r.n_times) : null;
  const sumY    = num(r.sum_y);
  const YtY     = num(r.yty);

  // Sanity guard for TWFE degenerate panels
  if (mode === "TWFE" && (nUnits < 2 || nTimes < 2)) return null;

  const dim = k + 1;
  const XtX = Array.from({ length: dim }, () => Array(dim).fill(0));
  const XtY = Array(dim).fill(0);

  // intercept row/col 0
  XtX[0][0] = n;
  XtY[0]    = sumY;
  for (let i = 0; i < k; i++) {
    const sx = num(r[`sum_x_${i}`]);
    XtX[0][i + 1] = sx;
    XtX[i + 1][0] = sx;
    XtY[i + 1]    = num(r[`sum_xy_${i}`]);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const v = num(r[`sum_xx_${i}_${j}`]);
      XtX[i + 1][j + 1] = v;
      if (i !== j) XtX[j + 1][i + 1] = v;
    }
  }

  return {
    n, n_units: nUnits, n_times: nTimes,
    XtX, XtY, YtY, sumY,
    varNames: ["(Intercept)", ...xCols],
    mode, unitCol, timeCol: (mode === "FD" || mode === "TWFE") ? timeCol : null,
    withinCTEPrefix,
  };
}
