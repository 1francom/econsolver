// ECON STUDIO - src/services/data/duckdbRDDBandwidth.js
// IK-style bandwidth selector using SQL local quadratic moments.

import { getDuckDB } from "./duckdb.js";
import { matInv } from "../../math/LinearEngine.js";

function esc(c) {
  return `"${String(c).replace(/"/g, '""')}"`;
}

function num(v) {
  return v == null ? NaN : (typeof v === "bigint" ? Number(v) : Number(v));
}

function vmul(M, v) {
  return M.map(row => row.reduce((sum, value, idx) => sum + value * v[idx], 0));
}

function quadraticFit(row) {
  const XtX = [
    [num(row.n), num(row.su), num(row.su2)],
    [num(row.su), num(row.su2), num(row.su3)],
    [num(row.su2), num(row.su3), num(row.su4)],
  ];
  const XtY = [num(row.sy), num(row.suy), num(row.su2y)];
  const inv = matInv(XtX);
  if (!inv) return { s2: 1, curv: 0.001, n: num(row.n) };
  const beta = vmul(inv, XtY);
  const ssr = num(row.syy)
    - 2 * beta.reduce((sum, value, idx) => sum + value * XtY[idx], 0)
    + beta.reduce((sum, bi, i) =>
      sum + bi * XtX[i].reduce((inner, value, j) => inner + value * beta[j], 0), 0);
  return {
    s2: ssr / Math.max(1, num(row.n) - 3),
    curv: Math.abs(beta[2]) || 0.001,
    n: num(row.n),
  };
}

export async function computeIKBandwidthSQL({
  tableName,
  yCol,
  runningCol,
  cutoff,
}) {
  const { conn } = await getDuckDB();
  const y = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const r = `TRY_CAST(${esc(runningCol)} AS DOUBLE)`;
  const baseWhere = `isfinite(${y}) AND isfinite(${r})`;

  const rangeRow = (await conn.query(`
    SELECT COUNT(*) AS n, MIN(${r}) AS rmin, MAX(${r}) AS rmax
    FROM ${esc(tableName)}
    WHERE ${baseWhere}
  `)).toArray()[0];
  const n = num(rangeRow.n);
  const rmin = num(rangeRow.rmin);
  const rmax = num(rangeRow.rmax);
  const range = rmax - rmin;
  if (!(n > 0) || !(range > 0)) {
    return { h: NaN, components: { n, range } };
  }

  const pilot = range / 4;
  const c = String(cutoff);
  const u = `((${r}) - ${c})`;
  const fitSide = async (side) => {
    const sideFilter = side === "left" ? `${r} < ${c}` : `${r} >= ${c}`;
    const row = (await conn.query(`
      SELECT
        COUNT(*) AS n,
        SUM(${u}) AS su,
        SUM(POWER(${u}, 2)) AS su2,
        SUM(POWER(${u}, 3)) AS su3,
        SUM(POWER(${u}, 4)) AS su4,
        SUM(${y}) AS sy,
        SUM(${u} * ${y}) AS suy,
        SUM(POWER(${u}, 2) * ${y}) AS su2y,
        SUM(${y} * ${y}) AS syy
      FROM ${esc(tableName)}
      WHERE ${baseWhere}
        AND ${sideFilter}
        AND ABS(${u}) < ${pilot}
    `)).toArray()[0];
    return num(row.n) >= 3 ? quadraticFit(row) : { s2: 1, curv: 0.001, n: num(row.n) };
  };

  const left = await fitSide("left");
  const right = await fitSide("right");
  const s2 = (left.s2 + right.s2) / 2;
  const curv = (left.curv + right.curv) / 2;
  const rawH = 3.4375 * Math.pow(s2 / (curv ** 2 * n), 0.2);
  const h = Math.min(Math.max(rawH, range * 0.05), range * 0.8);
  return {
    h,
    components: { n, range, pilot, left, right, rawH },
  };
}
