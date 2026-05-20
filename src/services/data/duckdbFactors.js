// ECON STUDIO · src/services/data/duckdbFactors.js
// Detects factor(col) entries in xCols, fetches distinct levels from DuckDB,
// drops the first level as the reference category, and emits CASE WHEN dummy
// SQL fragments keyed by synthetic dummy name (country_FR, year_2011, ...).

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
