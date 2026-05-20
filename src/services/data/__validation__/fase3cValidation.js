// ─── ECON STUDIO · src/services/data/__validation__/fase3cValidation.js ──────
// Numerical validation for Fase 3c (WLS suff-stats path). Loads
// fase3c_data.csv into DuckDB, runs the SQL path's WLS three ways
// (classical / HC0 / HC1), and compares against fase3cBenchmarks.json
// (R lm(..., weights = w) + sandwich::vcovHC). Exposed at
// window.__validation.fase3c — call from DevTools.

import { getDuckDB }            from "../duckdb.js";
import { buildWLSSuffStats }    from "../duckdbWLS.js";
import { computeWLSHCMeat }     from "../duckdbWLSRobustSE.js";
import { runWLSFromSuffStats }  from "../../../math/WLSEngine.js";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  const url  = new URL("./fase3c_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase3c.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase3c_tbl`);
  await conn.query(`CREATE TABLE fase3c_tbl AS SELECT * FROM read_csv_auto('fase3c.csv')`);
  return "fase3c_tbl";
}

export async function runFase3cNumericalValidation() {
  const benchResp = await fetch(new URL("./fase3cBenchmarks.json", import.meta.url));
  const B = await benchResp.json();

  let p = 0, f = 0;
  const c = (n, ok) => ok ? (p++, console.log(`  ✓ ${n}`)) : (f++, console.error(`  ✗ ${n}`));

  const table = await loadCSV();
  const xCols = ["x1", "x2"];
  const wCol  = "w";

  const ss = await buildWLSSuffStats(table, "y", xCols, wCol);

  // ── Classical ──────────────────────────────────────────────────────────────
  const rCls = runWLSFromSuffStats({ ...ss, meat: null, hcType: null });
  B.beta.forEach((b, i) => c(`β[${i}] vs R (6dp)`, close6(rCls.beta[i], b)));
  B.se_classical.forEach((s, i) =>
    c(`SE classical[${i}] vs R (4dp)`, close4(rCls.se[i], s)));

  // ── HC0 ────────────────────────────────────────────────────────────────────
  const meatHC0 = (await computeWLSHCMeat({
    tableName: table, yCol: "y", xCols, wCol,
    beta: rCls.beta,
  })).meat;
  const rHC0 = runWLSFromSuffStats({ ...ss, meat: meatHC0, hcType: null });
  B.se_HC0.forEach((s, i) => c(`SE HC0[${i}] vs R (4dp)`, close4(rHC0.se[i], s)));

  // ── HC1 (reuses HC0 meat — engine applies n/(n-k) scaling) ────────────────
  const rHC1 = runWLSFromSuffStats({ ...ss, meat: meatHC0, hcType: "HC1" });
  B.se_HC1.forEach((s, i) => c(`SE HC1[${i}] vs R (4dp)`, close4(rHC1.se[i], s)));

  console.log(`\n${p} passed, ${f} failed`);
  return f === 0;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase3c = runFase3cNumericalValidation;
}
