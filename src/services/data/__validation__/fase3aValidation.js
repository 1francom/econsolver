// ─── ECON STUDIO · src/services/data/__validation__/fase3aValidation.js ──────
// Numerical validation for Fase 3a (2SLS suff-stats path). Loads
// fase3a_data.csv into DuckDB, runs the SQL path's 2SLS three ways
// (classical / HC0 / HC1), compares against fase3aBenchmarks.json (AER::ivreg
// + sandwich::vcovHC). Exposed at window.__validation.fase3a.

import { getDuckDB }              from "../duckdb.js";
import { buildIVSuffStats }       from "../duckdbIV.js";
import { computeIVHCMeat }        from "../duckdbIVRobustSE.js";
import { run2SLSFromSuffStats }   from "../../../math/IV2SLSEngine.js";
import { buildOLSSuffStats }      from "../duckdbOLS.js";
import { runOLSFromSuffStats }    from "../../../math/LinearEngine.js";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  const url  = new URL("./fase3a_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase3a.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase3a_tbl`);
  await conn.query(`CREATE TABLE fase3a_tbl AS SELECT * FROM read_csv_auto('fase3a.csv')`);
  return "fase3a_tbl";
}

export async function runFase3aNumericalValidation() {
  const benchResp = await fetch(new URL("./fase3aBenchmarks.json", import.meta.url));
  const B = await benchResp.json();

  let p = 0, f = 0;
  const c = (n, ok) => ok ? (p++, console.log(`  ✓ ${n}`)) : (f++, console.error(`  ✗ ${n}`));

  const table = await loadCSV();

  // 2SLS suff-stats: X = [x1, x2], Z = [z1, z2, x2] in conceptual sense, but
  // here we pass the *flat* lists the dispatcher would build: xCols = endog+exog
  // (x1, x2) and zCols = exog+excluded (here z1, z2 — exog x2 is in both X and Z
  // implicit via the design convention). buildIVSuffStats expects xCols=full
  // design and zCols=full instrument list including exogenous controls.
  const xCols = ["x1", "x2"];
  const zCols = ["z1", "z2", "x2"];   // exog x2 acts as its own instrument
  const ss    = await buildIVSuffStats(table, "y", xCols, zCols);

  // ── Classical ─────────────────────────────────────────────────────────────
  const rCls = run2SLSFromSuffStats({ ...ss, meat: null, hcType: null });
  B.beta.forEach((b, i) => c(`β[${i}] vs R (6dp)`, close6(rCls.beta[i], b)));
  B.se_classical.forEach((s, i) =>
    c(`SE classical[${i}] vs R (4dp)`, close4(rCls.se[i], s)));

  // ── First-stage β for x1 (X-column index 1, since intercept = 0) ─────────
  // unrestricted: x1 ~ [1, x2, z1, z2]   ← exogenous controls + excluded instr
  const fsU    = await buildOLSSuffStats(table, "x1", ["x2", "z1", "z2"]);
  const fsUSol = runOLSFromSuffStats(fsU);
  const firstStageBeta = new Map([[1, fsUSol.beta]]);

  // ── HC0 ───────────────────────────────────────────────────────────────────
  // computeIVHCMeat zCols must match the unrestricted-regression z-layout
  // [exogenous controls, excluded instruments] = ["x2","z1","z2"].
  const ivZ = ["x2", "z1", "z2"];
  const meatHC0 = (await computeIVHCMeat({
    tableName: table, yCol: "y",
    xCols, zCols: ivZ,
    beta: rCls.beta, firstStageBeta,
  })).meat;
  const rHC0 = run2SLSFromSuffStats({ ...ss, meat: meatHC0, hcType: null });
  B.se_HC0.forEach((s, i) => c(`SE HC0[${i}] vs R (4dp)`, close4(rHC0.se[i], s)));

  // ── HC1 (reuses HC0 meat — engine applies n/(n-k) scaling) ────────────────
  const rHC1 = run2SLSFromSuffStats({ ...ss, meat: meatHC0, hcType: "HC1" });
  B.se_HC1.forEach((s, i) => c(`SE HC1[${i}] vs R (4dp)`, close4(rHC1.se[i], s)));

  // ── First-stage F ─────────────────────────────────────────────────────────
  // restricted: x1 ~ [1, x2]   (drop z1, z2)
  const fsR    = await buildOLSSuffStats(table, "x1", ["x2"]);
  const fsRSol = runOLSFromSuffStats(fsR);
  const Fstat  = ((fsRSol.ssr - fsUSol.ssr) / 2) / (fsUSol.ssr / fsUSol.df);
  c(`first-stage F (4dp): ${Fstat.toFixed(4)} vs ${B.firstStageF_x1.toFixed(4)}`,
    close4(Fstat, B.firstStageF_x1));

  console.log(`\n${p} passed, ${f} failed`);
  return f === 0;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase3a = runFase3aNumericalValidation;
}
