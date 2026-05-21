// ECON STUDIO - src/services/data/duckdbIRLS.js
// Per-iteration DuckDB sufficient statistics for IRLS GLM fast paths.

import { getDuckDB } from "./duckdb.js";

const SUPPORTED = new Set(["logit", "probit", "poisson"]);

function esc(c) {
  return `"${String(c).replace(/"/g, '""')}"`;
}

function num(v) {
  return v == null ? NaN : (typeof v === "bigint" ? Number(v) : Number(v));
}

function etaClip(etaSQL, lo, hi) {
  return `LEAST(GREATEST((${etaSQL}), ${lo}), ${hi})`;
}

function irlsExprs(family, etaSQL, ySQL) {
  if (family === "logit") {
    const eta = etaClip(etaSQL, -35.0, 35.0);
    const mu = `LEAST(GREATEST(1.0 / (1.0 + exp(-(${eta}))), 1e-12), 1.0 - 1e-12)`;
    const w = `(${mu}) * (1.0 - (${mu}))`;
    return {
      mu,
      w,
      z: `(${etaSQL}) + ((${ySQL}) - (${mu})) / (${w})`,
      ll: `(${ySQL}) * log(${mu}) + (1.0 - (${ySQL})) * log(1.0 - (${mu}))`,
    };
  }

  if (family === "probit") {
    const eta = etaClip(etaSQL, -8.0, 8.0);
    const mu = `LEAST(GREATEST(0.5 * (1.0 + erf((${eta}) / sqrt(2.0))), 1e-12), 1.0 - 1e-12)`;
    const dmu = `(1.0 / sqrt(2.0 * pi())) * exp(-0.5 * (${eta}) * (${eta}))`;
    const w = `((${dmu}) * (${dmu})) / ((${mu}) * (1.0 - (${mu})))`;
    return {
      mu,
      w,
      z: `(${etaSQL}) + ((${ySQL}) - (${mu})) / GREATEST((${dmu}), 1e-12)`,
      ll: `(${ySQL}) * log(${mu}) + (1.0 - (${ySQL})) * log(1.0 - (${mu}))`,
    };
  }

  if (family === "poisson") {
    const mu = `exp(${etaClip(etaSQL, -30.0, 30.0)})`;
    return {
      mu,
      w: mu,
      z: `(${etaSQL}) + ((${ySQL}) - (${mu})) / GREATEST((${mu}), 1e-12)`,
      ll: `(${ySQL}) * (${etaSQL}) - (${mu}) - lgamma((${ySQL}) + 1.0)`,
    };
  }

  throw new Error(`IRLS family '${family}' is not supported.`);
}

function familyYFilter(family) {
  return family === "poisson" ? "_y_ >= 0" : "_y_ IN (0, 1)";
}

function buildProjection({ yCol, xCols, dummySQL }) {
  const colExpr = (c) => Object.prototype.hasOwnProperty.call(dummySQL, c)
    ? `CAST((${dummySQL[c]}) AS DOUBLE)`
    : `TRY_CAST(${esc(c)} AS DOUBLE)`;

  return [
    `TRY_CAST(${esc(yCol)} AS DOUBLE) AS _y_`,
    ...xCols.map((col, idx) => `${colExpr(col)} AS _x_${idx}`),
  ];
}

/**
 * Build the weighted cross-products for one IRLS iteration.
 * beta includes the intercept at index 0.
 */
export async function buildIRLSSuffStats({
  tableName,
  yCol,
  xCols,
  family,
  beta,
  dummySQL = {},
}) {
  if (!SUPPORTED.has(family)) {
    throw new Error(`buildIRLSSuffStats: family '${family}' is not supported.`);
  }

  const { conn } = await getDuckDB();
  const dim = xCols.length + 1;
  if (!Array.isArray(beta) || beta.length !== dim) {
    throw new Error(`buildIRLSSuffStats: beta length must be ${dim}.`);
  }

  const xRef = (idx) => idx === 0 ? "1.0" : `_x_${idx - 1}`;
  const etaSQL = `(${beta.map((_, idx) => `? * ${xRef(idx)}`).join(" + ")})`;
  const { mu, w, z, ll } = irlsExprs(family, "_eta_", "_y_");
  const finite = ["isfinite(_y_)", familyYFilter(family)];
  for (let idx = 0; idx < xCols.length; idx++) finite.push(`isfinite(_x_${idx})`);

  const aggs = [
    "COUNT(*) AS n",
    "SUM(_y_) AS sum_y",
    "SUM(CASE WHEN _y_ > 0 THEN 1 ELSE 0 END) AS positive_y",
  ];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(`SUM(_w_ * ${xRef(i)} * ${xRef(j)}) AS xwx_${i}_${j}`);
    }
  }
  for (let i = 0; i < dim; i++) {
    aggs.push(`SUM(_w_ * _z_ * ${xRef(i)}) AS xwz_${i}`);
  }
  aggs.push("SUM(_ll_) AS loglik");
  aggs.push("MAX(ABS(_y_ - _mu_)) AS max_abs_score");
  aggs.push(family === "poisson"
    ? "SUM(lgamma(_y_ + 1.0)) AS sum_log_factorial"
    : "0.0 AS sum_log_factorial");

  const sql = `
    WITH raw AS (
      SELECT ${buildProjection({ yCol, xCols, dummySQL }).join(", ")}
      FROM ${esc(tableName)}
    ),
    valid AS (
      SELECT * FROM raw
      WHERE ${finite.join(" AND ")}
    ),
    eta AS (
      SELECT *, ${etaSQL} AS _eta_
      FROM valid
    ),
    glm AS (
      SELECT *, (${mu}) AS _mu_, (${w}) AS _w_, (${z}) AS _z_, (${ll}) AS _ll_
      FROM eta
    )
    SELECT ${aggs.join(", ")}
    FROM glm
  `;

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...beta);
  await stmt.close();
  const row = result.toArray()[0];

  const XtWX = Array.from({ length: dim }, () => Array(dim).fill(0));
  const XtWZ = Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const value = num(row[`xwx_${i}_${j}`]);
      XtWX[i][j] = value;
      if (i !== j) XtWX[j][i] = value;
    }
    XtWZ[i] = num(row[`xwz_${i}`]);
  }

  return {
    n: num(row.n),
    sumY: num(row.sum_y),
    positiveY: num(row.positive_y),
    XtWX,
    XtWZ,
    logLik: num(row.loglik),
    maxAbsScore: num(row.max_abs_score),
    sumLogFactorial: num(row.sum_log_factorial),
  };
}
