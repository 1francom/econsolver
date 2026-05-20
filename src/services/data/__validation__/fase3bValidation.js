// ─── ECON STUDIO · src/services/data/__validation__/fase3bValidation.js ───────
// Loads fase3b_data.csv into DuckDB, runs the SQL path's GMM and LIML, and
// compares against fase3bBenchmarks.json.
// Exposed at window.__validation.fase3b — call from DevTools.

import { getDuckDB }            from "../duckdb.js";
import { buildGMMSuffStats }    from "../duckdbGMM.js";
import { computeGMMOmega }      from "../duckdbGMMOmega.js";
import { buildLIMLSuffStats }   from "../duckdbLIML.js";
import { runGMMFromSuffStats }  from "../../../math/GMMSuffStatsEngine.js";
import { runLIMLFromSuffStats } from "../../../math/LIMLSuffStatsEngine.js";
import { run2SLSFromSuffStats } from "../../../math/IV2SLSEngine.js";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  const url = new URL("./fase3b_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase3b.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase3b_tbl`);
  await conn.query(`CREATE TABLE fase3b_tbl AS SELECT * FROM read_csv_auto('fase3b.csv')`);
  return "fase3b_tbl";
}

export async function runFase3bNumericalValidation() {
  const benchResp = await fetch(new URL("./fase3bBenchmarks.json", import.meta.url));
  const bench = await benchResp.json();

  const table = await loadCSV();
  const results = [];

  // ── LIML ─────────────────────────────────────────────────────────────────
  const ssL = await buildLIMLSuffStats(table, "y", ["x1"], ["x2"], ["z1", "z2"], {});
  const rL  = runLIMLFromSuffStats(ssL);

  // varNames order from LIML SS = ["(Intercept)", "x2", "x1"]
  // Bench order = ["(Intercept)", "x1", "x2"] — remap explicitly.
  const ssLOrderLookup = { "(Intercept)": 0, "x2": 1, "x1": 2 };
  for (const [name, benchIdx] of [["(Intercept)", 0], ["x1", 1], ["x2", 2]]) {
    const ssIdx = ssLOrderLookup[name];
    results.push([`liml_beta[${name}]`, rL.beta[ssIdx], bench.liml_beta[benchIdx], close6]);
    results.push([`liml_se[${name}]`,   rL.se[ssIdx],   bench.liml_se[benchIdx],   close4]);
  }
  results.push(["liml_kappa", rL.kappa, bench.liml_kappa, close6]);

  // ── GMM (2-step) ─────────────────────────────────────────────────────────
  const ssG  = await buildGMMSuffStats(table, "y", ["x1"], ["x2"], ["z1", "z2"], {});
  const step1 = run2SLSFromSuffStats({ ...ssG, meat: null, hcType: null });
  const omega = (await computeGMMOmega({
    tableName: table, yCol: "y",
    xColsAll: ssG.xColsAll, zColsAll: ssG.zColsAll,
    beta: step1.beta,
  })).Omega;
  const rG = runGMMFromSuffStats({ ...ssG, Omega: omega, overidDf: 1 });

  for (const [name, benchIdx] of [["(Intercept)", 0], ["x1", 1], ["x2", 2]]) {
    const ssIdx = ssLOrderLookup[name];
    results.push([`gmm_beta[${name}]`, rG.beta[ssIdx], bench.gmm_beta[benchIdx], close6]);
    results.push([`gmm_se[${name}]`,   rG.se[ssIdx],   bench.gmm_se[benchIdx],   close4]);
  }
  results.push(["gmm_jStat", rG.jStat, bench.gmm_jStat, close4]);

  const failures = [];
  results.forEach(([name, got, want, fn]) => {
    const ok = fn(got, want);
    if (!ok) failures.push({ name, got, want });
    console.log(`${ok ? "✓" : "✗"} ${name}: got ${got}, want ${want}`);
  });
  console.log(failures.length === 0
    ? `Fase 3b validation PASSED (${results.length}/${results.length})`
    : `Fase 3b validation FAILED (${failures.length} mismatches)`);
  return { results, failures };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.fase3b = runFase3bNumericalValidation;
}
