// ECON STUDIO - src/services/data/duckdbIRLSRobustSE.js
// HC0/HC1 score-residual meat for IRLS GLM fast paths.

import { getDuckDB } from "./duckdb.js";

function esc(c) {
  return `"${String(c).replace(/"/g, '""')}"`;
}

function num(v) {
  return v == null ? NaN : (typeof v === "bigint" ? Number(v) : Number(v));
}

function etaClip(etaSQL, lo, hi) {
  return `LEAST(GREATEST((${etaSQL}), ${lo}), ${hi})`;
}

function muSQL(family, etaSQL) {
  if (family === "logit") {
    return `LEAST(GREATEST(1.0 / (1.0 + exp(-(${etaClip(etaSQL, -35.0, 35.0)}))), 1e-12), 1.0 - 1e-12)`;
  }
  if (family === "probit") {
    return `LEAST(GREATEST(0.5 * (1.0 + erf((${etaClip(etaSQL, -8.0, 8.0)}) / sqrt(2.0))), 1e-12), 1.0 - 1e-12)`;
  }
  if (family === "poisson") {
    return `exp(${etaClip(etaSQL, -30.0, 30.0)})`;
  }
  throw new Error(`computeIRLSHCMeat: family '${family}' is not supported.`);
}

function familyYFilter(family) {
  return family === "poisson" ? "_y_ >= 0" : "_y_ IN (0, 1)";
}

export async function computeIRLSHCMeat({
  tableName,
  yCol,
  xCols,
  family,
  beta,
  dummySQL = {},
}) {
  const { conn } = await getDuckDB();
  const dim = xCols.length + 1;
  if (!Array.isArray(beta) || beta.length !== dim) {
    throw new Error(`computeIRLSHCMeat: beta length must be ${dim}.`);
  }

  const colExpr = (c) => Object.prototype.hasOwnProperty.call(dummySQL, c)
    ? `CAST((${dummySQL[c]}) AS DOUBLE)`
    : `TRY_CAST(${esc(c)} AS DOUBLE)`;
  const projection = [
    `TRY_CAST(${esc(yCol)} AS DOUBLE) AS _y_`,
    ...xCols.map((col, idx) => `${colExpr(col)} AS _x_${idx}`),
  ];
  const xRef = (idx) => idx === 0 ? "1.0" : `_x_${idx - 1}`;
  const etaSQL = `(${beta.map((_, idx) => `? * ${xRef(idx)}`).join(" + ")})`;
  const finite = ["isfinite(_y_)", familyYFilter(family)];
  for (let idx = 0; idx < xCols.length; idx++) finite.push(`isfinite(_x_${idx})`);

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(`SUM((_score_ * _score_) * ${xRef(i)} * ${xRef(j)}) AS m_${i}_${j}`);
    }
  }

  const sql = `
    WITH raw AS (
      SELECT ${projection.join(", ")}
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
    score AS (
      SELECT *, _y_ - (${muSQL(family, "_eta_")}) AS _score_
      FROM eta
    )
    SELECT ${aggs.join(", ")}
    FROM score
  `;

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...beta);
  await stmt.close();
  const row = result.toArray()[0];

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const value = num(row[`m_${i}_${j}`]);
      meat[i][j] = value;
      if (i !== j) meat[j][i] = value;
    }
  }
  return { meat, n: num(row.n) };
}
