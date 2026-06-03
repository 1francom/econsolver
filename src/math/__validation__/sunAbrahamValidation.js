// ─── ECON STUDIO · sunAbrahamValidation.js ────────────────────────────────────
// Node-runnable harness: validates runSunAbraham (Sun & Abraham 2021 IW event
// study over PPML) against fixest::fepois + sunab() benchmarks.
//
// Reads the same deterministic CSVs the R script consumes, runs the JS engine
// with clustered-by-unit SE, and diffs the aggregated per-relative-period ATTs
// (eventCoeffs) against sunAbrahamBenchmarks.json. Also checks the single-cohort
// reduction (case 1 sunab ATTs must equal the plain Poisson TWFE i(rel) path).
//
// Run:
//   node src/math/__validation__/sunAbrahamValidation.js
//
// Exposes runSunAbrahamValidation() for window.__validation wiring.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSunAbraham } from "../NonLinearEngine.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const TOL_COEF = 1e-6;
const TOL_SE   = 1e-4;

// Parse a CSV; blank cohort ⇒ null (never-treated control). Numeric coercion.
function readCsv(file) {
  const txt = readFileSync(join(HERE, file), "utf8").trim();
  const lines = txt.split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map(line => {
    const cells = line.split(",");
    const r = {};
    header.forEach((h, i) => {
      const v = cells[i];
      if (h === "cohort") {
        r.cohort = (v == null || v.trim() === "") ? null : Number(v);
      } else {
        r[h] = Number(v);
      }
    });
    return r;
  });
}

// Benchmark JSON stores columnar arrays {k:[...], beta:[...], se:[...]} (R toJSON).
function toRows(col) {
  return col.k.map((k, i) => ({ k, beta: col.beta[i], se: col.se[i] }));
}

function diffByK(label, got, want) {
  // got: array of {k, beta, se}; want: columnar {k,beta,se}. Match on k.
  want = toRows(want);
  const wantMap = new Map(want.map(w => [w.k, w]));
  let maxCoef = 0, maxSe = 0;
  const rows = [];
  for (const g of got) {
    const w = wantMap.get(g.k);
    if (!w) { rows.push({ k: g.k, status: "NO_BENCH" }); continue; }
    const dC = Math.abs(g.beta - w.beta);
    const dS = Math.abs(g.se - w.se);
    maxCoef = Math.max(maxCoef, dC);
    maxSe = Math.max(maxSe, dS);
    rows.push({
      k: g.k,
      js_beta: g.beta, r_beta: w.beta, dCoef: dC,
      js_se: g.se, r_se: w.se, dSe: dS,
      ok: dC < TOL_COEF && dS < TOL_SE,
    });
  }
  const pass = maxCoef < TOL_COEF && maxSe < TOL_SE && rows.every(r => r.status !== "NO_BENCH");
  return { label, pass, maxCoef, maxSe, rows };
}

export function runSunAbrahamValidation() {
  const bench = JSON.parse(readFileSync(join(HERE, "sunAbrahamBenchmarks.json"), "utf8"));
  const results = [];

  const cfgBase = { cohortCol: "cohort", periodCol: "period", feCols: ["unit", "period"], refPeriod: -1, controlMode: "auto" };
  const seOpts = { seType: "clustered", clusterVar: "unit" };

  // ── CASE 1 — single cohort + never-treated ──────────────────────────────────
  const d1 = readCsv("sunAbraham_case1.csv");
  const r1 = runSunAbraham(d1, "y", [], cfgBase, seOpts);
  if (r1.error) throw new Error(`case1 engine error: ${r1.error}`);
  const ec1 = r1.eventCoeffs.filter(e => !e.isRef).map(e => ({ k: e.k, beta: e.beta, se: e.se }));
  results.push(diffByK("case1 sunab vs fixest sunab", ec1, bench.case1.sunab));
  // single-cohort reduction: engine ATTs must equal the R plain-Poisson TWFE path
  results.push(diffByK("case1 sunab vs R Poisson TWFE i(rel)", ec1, bench.case1.twfe));

  // ── CASE 2 — staggered 2 cohorts + never-treated ────────────────────────────
  const d2 = readCsv("sunAbraham_case2.csv");
  const r2 = runSunAbraham(d2, "y", [], cfgBase, seOpts);
  if (r2.error) throw new Error(`case2 engine error: ${r2.error}`);
  const ec2 = r2.eventCoeffs.filter(e => !e.isRef).map(e => ({ k: e.k, beta: e.beta, se: e.se }));
  results.push(diffByK("case2 sunab vs fixest sunab", ec2, bench.case2.sunab));

  return { results, allPass: results.every(r => r.pass) };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url.startsWith("file:") &&
    fileURLToPath(import.meta.url) === process.argv[1]) {
  const { results, allPass } = runSunAbrahamValidation();
  for (const r of results) {
    console.log(`\n── ${r.label} ── ${r.pass ? "PASS" : "FAIL"}  (maxΔcoef=${r.maxCoef.toExponential(2)}, maxΔse=${r.maxSe.toExponential(2)})`);
    console.table(r.rows.map(row => row.status ? { k: row.k, status: row.status } : {
      k: row.k,
      js_beta: +row.js_beta.toFixed(7), r_beta: +row.r_beta.toFixed(7), dCoef: +row.dCoef.toExponential(2),
      js_se: +row.js_se.toFixed(7), r_se: +row.r_se.toFixed(7), dSe: +row.dSe.toExponential(2),
      ok: row.ok,
    }));
  }
  console.log(`\n${allPass ? "✅ ALL PASS" : "❌ FAIL"}`);
  process.exit(allPass ? 0 : 1);
}
