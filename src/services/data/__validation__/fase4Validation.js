// ─── ECON STUDIO · src/services/data/__validation__/fase4Validation.js ────────
// Numerical validation for Fase 4 (Panel FE/FD suff-stats path). Loads
// fase4_data.csv into DuckDB, runs the SQL path's FE and FD three ways each
// (classical / HC0 / HC1), and compares against fase4Benchmarks.json
// (R fixest / lm on demeaned & differenced data + sandwich::vcovHC). Exposed
// at window.__validation.fase4 — call from DevTools.

import { getDuckDB }              from "../duckdb.js";
import { buildWithinSuffStats }   from "../duckdbWithin.js";
import { computeWithinHCMeat }    from "../duckdbWithinRobustSE.js";
import {
  runFEFromSuffStats, runFDFromSuffStats,
} from "../../../math/PanelSuffStatsEngine.js";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  const url  = new URL("./fase4_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase4.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase4_tbl`);
  await conn.query(`CREATE TABLE fase4_tbl AS SELECT * FROM read_csv_auto('fase4.csv')`);
  return "fase4_tbl";
}

export async function runFase4NumericalValidation() {
  const benchResp = await fetch(new URL("./fase4Benchmarks.json", import.meta.url));
  const B = await benchResp.json();

  let p = 0, f = 0;
  const c = (n, ok) => ok ? (p++, console.log(`  ✓ ${n}`)) : (f++, console.error(`  ✗ ${n}`));

  const table = await loadCSV();
  const xCols = ["x1", "x2"];

  // ── FE ─────────────────────────────────────────────────────────────────────
  console.log("\n── FE (within-demean + grand-mean recenter) ──");
  const ssFE = await buildWithinSuffStats(table, "y", xCols, "i", { mode: "FE" });
  c(`FE n matches R                       (${ssFE.n} vs ${B.n})`, ssFE.n === B.n);
  c(`FE n_units matches R                 (${ssFE.n_units} vs ${B.n_units})`, ssFE.n_units === B.n_units);

  const rClsFE = runFEFromSuffStats({ ...ssFE, meat: null, hcType: null });
  B.FE.beta.forEach((b, i) =>
    c(`FE β[${i}] vs R (6dp)`, close6(rClsFE._betaFull[i], b)));
  B.FE.se_classical.forEach((s, i) =>
    c(`FE SE classical[${i}] vs R (4dp)`, close4(rClsFE._seFull[i], s)));
  c(`FE df vs R                            (${rClsFE.df} vs ${B.FE.df})`, rClsFE.df === B.FE.df);
  c(`FE SSR vs R (4dp)`, close4(rClsFE.SSR, B.FE.SSR));

  const meatFE = (await computeWithinHCMeat({
    withinCTEPrefix: ssFE.withinCTEPrefix, k: xCols.length, beta: rClsFE._betaFull,
  })).meat;
  const rHC0FE = runFEFromSuffStats({ ...ssFE, meat: meatFE, hcType: null });
  B.FE.se_HC0.forEach((s, i) =>
    c(`FE SE HC0[${i}] vs R (4dp)`, close4(rHC0FE._seFull[i], s)));
  const rHC1FE = runFEFromSuffStats({ ...ssFE, meat: meatFE, hcType: "HC1" });
  B.FE.se_HC1.forEach((s, i) =>
    c(`FE SE HC1[${i}] vs R (4dp)`, close4(rHC1FE._seFull[i], s)));

  // ── FD ─────────────────────────────────────────────────────────────────────
  console.log("\n── FD (first differences ordered by t within i) ──");
  const ssFD = await buildWithinSuffStats(table, "y", xCols, "i", { mode: "FD", timeCol: "t" });
  c(`FD n_diff matches R                  (${ssFD.n} vs ${B.n_diff})`, ssFD.n === B.n_diff);

  const rClsFD = runFDFromSuffStats({ ...ssFD, meat: null, hcType: null });
  B.FD.beta.forEach((b, i) =>
    c(`FD β[${i}] vs R (6dp)`, close6(rClsFD._betaFull[i], b)));
  B.FD.se_classical.forEach((s, i) =>
    c(`FD SE classical[${i}] vs R (4dp)`, close4(rClsFD._seFull[i], s)));

  const meatFD = (await computeWithinHCMeat({
    withinCTEPrefix: ssFD.withinCTEPrefix, k: xCols.length, beta: rClsFD._betaFull,
  })).meat;
  const rHC0FD = runFDFromSuffStats({ ...ssFD, meat: meatFD, hcType: null });
  B.FD.se_HC0.forEach((s, i) =>
    c(`FD SE HC0[${i}] vs R (4dp)`, close4(rHC0FD._seFull[i], s)));
  const rHC1FD = runFDFromSuffStats({ ...ssFD, meat: meatFD, hcType: "HC1" });
  B.FD.se_HC1.forEach((s, i) =>
    c(`FD SE HC1[${i}] vs R (4dp)`, close4(rHC1FD._seFull[i], s)));

  console.log(`\n${p} passed, ${f} failed`);
  return f === 0;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase4 = runFase4NumericalValidation;
}
