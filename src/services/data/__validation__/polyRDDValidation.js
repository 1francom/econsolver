// polyRDD browser validation harness
// Validates runSharpRDD with polyOrder=2 and polyOrder=3 against R base-WLS reference values.
//
// Usage (browser console after running polyRDDRValidation.R to generate the benchmarks):
//   const r = await window.__validation.polyRDD();
//
// Tolerances:
//   Coefficients: 1e-6  (6 decimal places)
//   Standard errors: 1e-4 (4 decimal places)

import { runSharpRDD } from "../../../math/CausalEngine.js";

const DATA_URL  = new URL("./polyRDD_data.csv",     import.meta.url).href;
const BENCH_URL = new URL("./polyRDDBenchmarks.json", import.meta.url).href;
const TOL_COEF  = 1e-6;
const TOL_SE    = 1e-4;

async function parseCSV(text) {
  const lines   = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row  = {};
    headers.forEach((h, i) => { row[h] = parseFloat(vals[i]); });
    return row;
  });
}

function maxAbsDiff(a, b) {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

function summarize(cell, diffs, tols = {}) {
  const checks = Object.entries(diffs);
  const ok     = checks.every(([k, d]) => d <= (tols[k] ?? TOL_COEF));
  const maxD   = Math.max(...checks.map(([, d]) => d));
  return { cell, ok, maxDiff: maxD, ...diffs, message: ok ? "PASS" : `FAIL ${maxD.toExponential(2)}` };
}

export async function runPolyRDDValidation() {
  const [csvText, bench] = await Promise.all([
    fetch(DATA_URL).then(r => r.text()),
    fetch(BENCH_URL).then(r => r.json()),
  ]);
  const rows = await parseCSV(csvText);
  const h    = bench.manual_h;

  const res2 = runSharpRDD(rows, "y", "r", 0, h, "triangular", [], {}, 2);
  const res3 = runSharpRDD(rows, "y", "r", 0, h, "triangular", [], {}, 3);

  const results = [
    summarize("p2_beta",
      { beta: maxAbsDiff(res2.beta, bench.p2.beta) },
    ),
    summarize("p2_se",
      { se: maxAbsDiff(res2.se, bench.p2.se) },
      { se: TOL_SE },
    ),
    summarize("p2_late",
      { late: Math.abs(res2.late - bench.p2.late), lateSE: Math.abs(res2.lateSE - bench.p2.lateSE) },
      { lateSE: TOL_SE },
    ),
    summarize("p3_beta",
      { beta: maxAbsDiff(res3.beta, bench.p3.beta) },
    ),
    summarize("p3_se",
      { se: maxAbsDiff(res3.se, bench.p3.se) },
      { se: TOL_SE },
    ),
    summarize("p3_late",
      { late: Math.abs(res3.late - bench.p3.late), lateSE: Math.abs(res3.lateSE - bench.p3.lateSE) },
      { lateSE: TOL_SE },
    ),
  ];

  const nPass = results.filter(r => r.ok).length;
  console.log(`polyRDD: ${nPass}/${results.length} cells pass`);
  console.table(results.map(({ cell, ok, maxDiff, message }) => ({
    cell, ok, diff: maxDiff.toExponential(2), message,
  })));
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.polyRDD = runPolyRDDValidation;
}
