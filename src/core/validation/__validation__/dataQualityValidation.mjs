// ─── ECON STUDIO · dataQualityValidation.mjs ─────────────────────────────────
// Pins the fast (typed-array, single-pass) data quality report against a
// straightforward per-row computation. Run:
//   node src/core/validation/__validation__/dataQualityValidation.mjs
import assert from "node:assert/strict";
import { buildDataQualityReport } from "../dataQuality.js";
import { buildInfo } from "../../../pipeline/validator.js";

let s = 5;
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const H = ["a", "b", "c", "d", "txt", "mix"];
const rows = [];
for (let i = 0; i < 2000; i++) {
  const base = rnd();
  rows.push({
    a: rnd() < 0.05 ? null : base * 10,
    b: base * 10 + rnd() * 0.3,               // ~collinear with a
    c: rnd() < 0.01 ? 1e4 : rnd(),            // outliers
    d: i < 150 ? null : rnd(),                // boundary missingness
    txt: ["x", "y"][i % 2],
    mix: i % 50 === 0 ? "bad" : rnd(),
  });
}
const info = buildInfo(H, rows);
const rep = buildDataQualityReport(H, rows, info, null);

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

check("correlation r matches a direct pairwise Pearson", () => {
  const p = rep.correlations.find(x => x.a === "a" && x.b === "b");
  assert.ok(p, "a/b must be flagged");
  let ab = 0, aa = 0, bb = 0;
  for (const r of rows) {
    if (typeof r.a !== "number" || typeof r.b !== "number") continue;
    const da = r.a - info.a.mean, db = r.b - info.b.mean;
    ab += da * db; aa += da * da; bb += db * db;
  }
  assert.equal(p.r, parseFloat((ab / Math.sqrt(aa * bb)).toFixed(4)));
  assert.ok(!rep.correlations.some(x => x.a === "c" || x.b === "c"), "c is noise");
});

check("outlier counts, extremes and skew match a direct computation", () => {
  const col = rep.columns.find(x => x.col === "c");
  const st = info.c, nums = rows.map(r => r.c).filter(v => typeof v === "number");
  const lo = st.q1 - 1.5 * st.iqr, hi = st.q3 + 1.5 * st.iqr;
  assert.equal(col.outlierReport.iqrCount, nums.filter(v => v < lo || v > hi).length);
  assert.equal(col.outlierReport.zCount, nums.filter(v => Math.abs((v - st.mean) / st.std) > 3).length);
  const sorted = [...nums].sort((x, y) => x - y);
  assert.deepEqual(col.outlierReport.extremeLow, sorted.slice(0, 3));
  assert.deepEqual(col.outlierReport.extremeHigh, sorted.slice(-3).reverse());
  const skew = nums.reduce((t, v) => t + ((v - st.mean) / st.std) ** 3, 0) / nums.length;
  assert.equal(col.outlierReport.skewness, skew);
});

check("missingness count and boundary pattern", () => {
  const d = rep.columns.find(x => x.col === "d");
  assert.equal(d.missingPattern.count, 150);
  assert.equal(d.missingPattern.isSystematic, true);
});

check("mixed-type column is reported", () => {
  assert.ok(rep.columns.find(x => x.col === "mix").typeReport);
});

console.log(`dataQuality: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
