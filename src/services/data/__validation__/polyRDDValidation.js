// polyRDD browser validation harness
// Validates runSharpRDD with polyOrder=1,2,3 against R base-WLS reference values.
// Also cross-checks IK bandwidth for each order against the R replica.
//
// Usage (browser console after running polyRDDRValidation.R):
//   const r = await window.__validation.polyRDD();
//
// Tolerances:
//   Coefficients / LATE : 1e-6  (6 decimal places)
//   Standard errors      : 1e-4  (4 decimal places)
//   IK bandwidth         : 1e-4  (4 decimal places — same pilot rounding)

import { runSharpRDD, ikBandwidth } from "../../../math/CausalEngine.js";

const DATA_URL  = new URL("./polyRDD_data.csv",       import.meta.url).href;
const BENCH_URL = new URL("./polyRDDBenchmarks.json", import.meta.url).href;
const TOL_COEF  = 1e-6;
const TOL_SE    = 1e-4;
const TOL_BW    = 1e-4;

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
  if (!a?.length || !b?.length) return Infinity;
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

function cell(name, diff, tol) {
  const ok = diff <= tol;
  return { cell: name, ok, diff, tol, message: ok ? "PASS" : `FAIL (${diff.toExponential(2)} > ${tol.toExponential(2)})` };
}

export async function runPolyRDDValidation() {
  const [csvText, bench] = await Promise.all([
    fetch(DATA_URL).then(r => r.text()),
    fetch(BENCH_URL).then(r => r.json()),
  ]);
  const rows   = await parseCSV(csvText);
  const runArr = rows.map(r => r.r);
  const yArr   = rows.map(r => r.y);
  const mh     = bench.manual_h;
  const results = [];

  for (const p of [1, 2, 3]) {
    const label = `p${p}`;
    const bRef  = bench[label];

    // ── manual bandwidth ────────────────────────────────────────────────────
    const resM = runSharpRDD(rows, "y", "r", 0, mh, "triangular", [], {}, p);
    results.push(cell(`${label}_manual_beta`,  maxAbsDiff(resM?.beta,  bRef.manual.beta),  TOL_COEF));
    results.push(cell(`${label}_manual_se`,    maxAbsDiff(resM?.se,    bRef.manual.se),    TOL_SE));
    results.push(cell(`${label}_manual_late`,  Math.abs((resM?.late   ?? NaN) - bRef.manual.late),   TOL_COEF));
    results.push(cell(`${label}_manual_lateSE`,Math.abs((resM?.lateSE ?? NaN) - bRef.manual.lateSE), TOL_SE));

    // ── IK bandwidth — cross-check JS value against R replica ───────────────
    const hJS  = ikBandwidth(runArr, yArr, 0, p);
    const hRef = bench.ik_h[label];
    results.push(cell(`${label}_ik_bw`, Math.abs(hJS - hRef), TOL_BW));

    // ── IK bandwidth estimation ─────────────────────────────────────────────
    const resI = runSharpRDD(rows, "y", "r", 0, hJS, "triangular", [], {}, p);
    results.push(cell(`${label}_ik_late`,  Math.abs((resI?.late   ?? NaN) - bRef.ik.late),   TOL_COEF));
    results.push(cell(`${label}_ik_lateSE`,Math.abs((resI?.lateSE ?? NaN) - bRef.ik.lateSE), TOL_SE));
  }

  const nPass = results.filter(r => r.ok).length;
  console.log(`polyRDD: ${nPass}/${results.length} cells pass`);
  console.table(results.map(({ cell, ok, diff, message }) => ({
    cell, ok, diff: diff.toExponential(2), message,
  })));
  return results;
}

// ─── Attach to window ─────────────────────────────────────────────────────────
if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.polyRDD = function wrappedPolyRDDValidation() {
    sessionStorage.setItem("__polyRDDValidationRan", new Date().toISOString());
    return runPolyRDDValidation();
  };
}
