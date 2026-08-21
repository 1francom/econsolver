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

// Sort levels the way R's factor() would: numeric ascending when every level
// is a finite number, else lexicographic on the string form. Mirrors
// components/modeling/helpers.js's sortFactorLevels — kept as a separate copy
// since services/ must not import from components/. Not delegated to SQL
// ORDER BY: whether that sorts numerically depends on the column's DuckDB
// type (numeric column vs. VARCHAR of numeric-looking strings), so client-side
// re-sort is the only way to guarantee the same convention as the JS path.
export function sortLevels(rawLevels) {
  const allNum = rawLevels.every(v => typeof v === "number" && isFinite(v));
  return allNum
    ? [...rawLevels].sort((a, b) => a - b)
    : [...rawLevels].sort((a, b) => {
        const sa = String(a), sb = String(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
}

async function defaultFetchLevels(tableName, col) {
  const { conn } = await getDuckDB();
  const sql = `SELECT DISTINCT ${esc(col)} AS lvl FROM ${esc(tableName)} WHERE ${esc(col)} IS NOT NULL`;
  const r = await conn.query(sql);
  return sortLevels(r.toArray().map(row => row.lvl));
}

// Floats a user-chosen reference level to the front of an already-sorted
// levels array. Own local copy, not shared with components/modeling/helpers.js's
// identically-named helper — same layering reason sortLevels above is its own
// copy (services/ must not import from components/), and the two callers keep
// different element types (this one leaves numbers as numbers; helpers.js's
// levels are already .map(String)'d), so `ref` is compared via String() on
// both sides rather than assuming a shared type. Silently no-ops if ref isn't
// an actual level of this column.
function reorderForReference(sortedLevels, ref) {
  if (ref == null) return sortedLevels;
  const i = sortedLevels.findIndex(v => String(v) === String(ref));
  if (i <= 0) return sortedLevels;
  const rest = sortedLevels.slice();
  const [chosen] = rest.splice(i, 1);
  return [chosen, ...rest];
}

export async function expandFactors({ xCols, tableName, fetchLevels, factorRefs = {} }) {
  const fetch = fetchLevels ?? ((col) => defaultFetchLevels(tableName, col));
  const xColsExpanded = [];
  const dummySQL = {};
  for (const x of xCols) {
    const factorCol = parseFactorSpec(x);
    if (factorCol === null) {
      xColsExpanded.push(x);
      continue;
    }
    const levels = reorderForReference(await fetch(factorCol), factorRefs[factorCol]);
    for (let i = 1; i < levels.length; i++) {
      const lvl = levels[i];
      const dummyName = `${factorCol}_${String(lvl).replace(/[^A-Za-z0-9_]/g, "_")}`;
      // NULL (not 0) when the factor itself is NULL, so the row is excluded
      // by buildOLSSuffStats's isfinite() filter instead of silently folding
      // into the reference category (same contract as applyFactors' NaN rows).
      dummySQL[dummyName] =
        `CASE WHEN ${esc(factorCol)} IS NULL THEN NULL WHEN ${esc(factorCol)} = ${literal(lvl)} THEN 1 ELSE 0 END`;
      xColsExpanded.push(dummyName);
    }
  }
  return { xColsExpanded, dummySQL };
}
