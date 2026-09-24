// ─── ECON STUDIO · duckdbExploreValidation.mjs ───────────────────────────────
// The SQL column info and Summary stats Explore uses for DuckDB-backed datasets
// must equal the JS implementations they replace (validator.js buildInfo and
// the Summary table's statsFor). Runs the node build of DuckDB-Wasm:
//   node src/services/data/__validation__/duckdbExploreValidation.mjs

import { createRequire } from "node:module";
import path from "node:path";
import { buildInfo } from "../../../pipeline/validator.js";
import { fetchColumnInfoSQL, fetchSummaryStatsSQL, plainRows } from "../duckdbExplore.js";

const require = createRequire(import.meta.url);
const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
const DIST = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
const db = await duckdb.createDuckDB(
  { mvp: { mainModule: path.join(DIST, "duckdb-mvp.wasm"), mainWorker: path.join(DIST, "duckdb-node-mvp.worker.cjs") } },
  new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
await db.instantiate();
const conn = db.connect();
const run = async (sql) => plainRows(conn.query(sql));

// Fixture: numeric with NAs and ties, an integer column, a low- and a
// high-cardinality string column, a numeric column that is all NULL, and a
// grouping column with a NULL level.
let s = 11;
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const rows = [];
for (let i = 0; i < 3001; i++) {
  rows.push({
    y: rnd() < 0.07 ? null : Math.round((rnd() * 100 - 30) * 100) / 100,
    k: i % 13,
    reg: rnd() < 0.05 ? null : ["north", "south", "east"][i % 3],
    id: `u${i}`,
    empty: null,
    g: i % 11 === 0 ? null : `G${i % 4}`,
    big: rnd() < 0.01 ? 1e6 : rnd(),
  });
}
const headers = ["y", "k", "reg", "id", "empty", "g", "big"];
conn.query(`CREATE TABLE t (y DOUBLE, k INTEGER, reg VARCHAR, id VARCHAR, empty DOUBLE, g VARCHAR, big DOUBLE)`);
const lit = (v) => v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v}'`;
for (let i = 0; i < rows.length; i += 500) {
  conn.query(`INSERT INTO t VALUES ${rows.slice(i, i + 500).map(r => `(${headers.map(h => lit(r[h])).join(",")})`).join(",")}`);
}

let pass = 0, fail = 0;
const close = (a, b) => (a === null && b === null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));
const check = (name, ok, detail = "") => { if (ok) pass++; else { fail++; console.error(`  FAIL ${name} ${detail}`); } };

// ── column info ──
const js = buildInfo(headers, rows);
const sq = await fetchColumnInfoSQL(run, "t", headers, { chunk: 3 });
const NUMF = ["naCount", "naPct", "total", "uCount", "mean", "std", "median", "q1", "q3", "iqr", "min", "max", "outliers"];
for (const h of headers) {
  // The all-NULL column is typed DOUBLE in SQL but has no values: JS cannot tell.
  check(`${h}.isNum`, js[h].isNum === sq[h].isNum, `${js[h].isNum} vs ${sq[h].isNum}`);
  check(`${h}.isCat`, js[h].isCat === sq[h].isCat, `${js[h].isCat} vs ${sq[h].isCat}`);
  for (const f of NUMF) check(`${h}.${f}`, close(js[h][f], sq[h][f]), `${js[h][f]} vs ${sq[h][f]}`);
  if (js[h].isCat) check(`${h}.uVals set`, [...js[h].uVals].sort().join() === [...sq[h].uVals].sort().join(),
    `${js[h].uVals} vs ${sq[h].uVals}`);
}

// ── summary stats: the JS statsFor from ExplorerModule, verbatim semantics ──
function qtile(sorted, p) {
  const i = p * (sorted.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function statsFor(subset, col, extraQs) {
  const vals = subset.map(r => r[col]).filter(v => typeof v === "number" && isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return { mean: null, std: null, min: null, max: null, median: null, q1: null, q3: null, n: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((t, v) => t + (v - mean) ** 2, 0) / vals.length);
  const extra = {};
  extraQs.forEach(p => { extra[`p${p}`] = qtile(vals, p / 100); });
  return { mean, std, min: vals[0], max: vals[vals.length - 1], median: qtile(vals, 0.5), q1: qtile(vals, 0.25), q3: qtile(vals, 0.75), n: vals.length, ...extra };
}
const cols = ["y", "k", "big", "empty"];
for (const groupBy of [null, "g", "k"]) {
  const qsx = [5, 95];
  const { groups, stats } = await fetchSummaryStatsSQL(run, "t", cols, { groupBy, quantiles: qsx });
  const jsGroups = groupBy ? [...new Set(rows.map(r => r[groupBy]).filter(v => v != null))].sort() : ["All"];
  check(`groups(${groupBy})`, JSON.stringify(groups) === JSON.stringify(jsGroups), `${groups} vs ${jsGroups}`);
  for (const c of cols) for (const g of jsGroups) {
    const sub = groupBy ? rows.filter(r => r[groupBy] === g) : rows;
    const a = statsFor(sub, c, qsx), b = stats[c][g];
    for (const f of Object.keys(a)) check(`${groupBy}:${g}:${c}.${f}`, close(a[f], b?.[f]), `${a[f]} vs ${b?.[f]}`);
  }
}

console.log(`duckdbExplore: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
