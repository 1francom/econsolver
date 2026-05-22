// DuckDB Fase 8 browser validation: WLS, 2SLS, and LIML robust-SE backfill.

import { getDuckDB } from "../duckdb.js";
import { buildWLSSuffStats } from "../duckdbWLS.js";
import {
  computeWLSHCMeatWithLeverage,
  computeWLSClusterMeat,
  computeWLSTwowayClusterMeat,
  computeWLSHACMeat,
} from "../duckdbWLSRobustSE.js";
import { buildIVSuffStats } from "../duckdbIV.js";
import {
  computeIVHCMeatWithLeverage,
  computeIVClusterMeat,
  computeIVTwowayClusterMeat,
  computeIVHACMeat,
} from "../duckdbIVRobustSE.js";
import { buildOLSSuffStats } from "../duckdbOLS.js";
import { buildLIMLSuffStats } from "../duckdbLIML.js";
import { computeHCMeat } from "../duckdbRobustSE.js";
import { computeClusterMeat } from "../duckdbClusterSE.js";
import { computeHACMeat } from "../duckdbHACSE.js";
import { runOLSFromSuffStats } from "../../../math/LinearEngine.js";
import { runWLSFromSuffStats } from "../../../math/WLSEngine.js";
import { run2SLSFromSuffStats } from "../../../math/IV2SLSEngine.js";
import { runLIMLFromSuffStats } from "../../../math/LIMLSuffStatsEngine.js";

function maxAbsDiff(actual, expected) {
  return Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));
}

function summarize(cell, beta, se, expectedBeta, expectedSe, extras = {}) {
  const maxCoefDiff = maxAbsDiff(beta, expectedBeta);
  const maxSeDiff = maxAbsDiff(se, expectedSe);
  return {
    cell,
    ok: maxCoefDiff <= 1e-6 && maxSeDiff <= 1e-4,
    maxCoefDiff,
    maxSeDiff,
    ...extras,
  };
}

async function loadFixtureTable() {
  const { db, conn } = await getDuckDB();
  const data = await fetch(new URL("./fase8_data.csv", import.meta.url)).then(resp => resp.text());
  await db.registerFileText("fase8.csv", data);
  await conn.query("DROP TABLE IF EXISTS fase8_tbl");
  await conn.query("CREATE TABLE fase8_tbl AS SELECT * FROM read_csv_auto('fase8.csv')");
  return "fase8_tbl";
}

async function runWLSCells(table, bench) {
  const xCols = ["wx1", "wx2"];
  const suff = await buildWLSSuffStats(table, "y_wls", xCols, "w");
  const classical = runWLSFromSuffStats({ ...suff, meat: null, hcType: null });
  const shared = {
    tableName: table,
    yCol: "y_wls",
    xCols,
    wCol: "w",
    beta: classical.beta,
  };
  const hc2 = await computeWLSHCMeatWithLeverage({
    ...shared,
    Ainv: classical.XtXinv,
    hcType: "HC2",
  });
  const hc3 = await computeWLSHCMeatWithLeverage({
    ...shared,
    Ainv: classical.XtXinv,
    hcType: "HC3",
  });
  const clustered = await computeWLSClusterMeat({ ...shared, clusterCol: "firm" });
  const twoway = await computeWLSTwowayClusterMeat({
    ...shared,
    clusterCol: "firm",
    clusterCol2: "year",
  });
  const hac = await computeWLSHACMeat({ ...shared, orderCol: "time" });
  return [
    summarize("wls_hc2", classical.beta, runWLSFromSuffStats({ ...suff, meat: hc2.meat }).se, bench.beta, bench.se_HC2),
    summarize("wls_hc3", classical.beta, runWLSFromSuffStats({ ...suff, meat: hc3.meat }).se, bench.beta, bench.se_HC3),
    summarize("wls_clustered", classical.beta, runWLSFromSuffStats({ ...suff, meat: clustered.meat }).se, bench.beta, bench.se_clustered),
    summarize("wls_twoway", classical.beta, runWLSFromSuffStats({ ...suff, meat: twoway.meat }).se, bench.beta, bench.se_twoway),
    summarize("wls_hac", classical.beta, runWLSFromSuffStats({ ...suff, meat: hac.meat }).se, bench.beta, bench.se_HAC, { L: hac.L }),
  ];
}

async function firstStageBetas(table) {
  const fit = await buildOLSSuffStats(table, "x1", ["x2", "z1", "z2"]);
  return new Map([[1, runOLSFromSuffStats(fit).beta]]);
}

async function runIVCells(table, bench) {
  const xCols = ["x1", "x2"];
  const zCols = ["x2", "z1", "z2"];
  const suff = await buildIVSuffStats(table, "y_iv", xCols, zCols);
  const classical = run2SLSFromSuffStats({ ...suff, meat: null, hcType: null });
  const shared = {
    tableName: table,
    yCol: "y_iv",
    xCols,
    zCols,
    beta: classical.beta,
    firstStageBeta: await firstStageBetas(table),
  };
  const hc2 = await computeIVHCMeatWithLeverage({
    ...shared,
    Ainv: classical.XtPzXinv,
    hcType: "HC2",
  });
  const hc3 = await computeIVHCMeatWithLeverage({
    ...shared,
    Ainv: classical.XtPzXinv,
    hcType: "HC3",
  });
  const clustered = await computeIVClusterMeat({ ...shared, clusterCol: "firm" });
  const twoway = await computeIVTwowayClusterMeat({
    ...shared,
    clusterCol: "firm",
    clusterCol2: "year",
  });
  const hac = await computeIVHACMeat({ ...shared, orderCol: "time" });
  return [
    summarize("iv_hc2", classical.beta, run2SLSFromSuffStats({ ...suff, meat: hc2.meat }).se, bench.beta, bench.se_HC2),
    summarize("iv_hc3", classical.beta, run2SLSFromSuffStats({ ...suff, meat: hc3.meat }).se, bench.beta, bench.se_HC3),
    summarize("iv_clustered", classical.beta, run2SLSFromSuffStats({ ...suff, meat: clustered.meat }).se, bench.beta, bench.se_clustered),
    summarize("iv_twoway", classical.beta, run2SLSFromSuffStats({ ...suff, meat: twoway.meat }).se, bench.beta, bench.se_twoway),
    summarize("iv_hac", classical.beta, run2SLSFromSuffStats({ ...suff, meat: hac.meat }).se, bench.beta, bench.se_HAC, { L: hac.L }),
  ];
}

async function runLIMLCells(table, bench) {
  const suff = await buildLIMLSuffStats(table, "y_iv", ["x1"], ["x2"], ["z1", "z2"]);
  const classical = runLIMLFromSuffStats({ ...suff, meat: null, hcType: null });
  const shared = {
    tableName: table,
    yCol: "y_iv",
    xColsExpanded: ["x2", "x1"],
    beta: classical.beta,
  };
  const hc = await computeHCMeat(shared);
  const clustered = await computeClusterMeat({ ...shared, clusterCol: "firm" });
  const hac = await computeHACMeat({ ...shared, orderCol: "time" });
  return [
    summarize("liml_hc0", classical.beta, runLIMLFromSuffStats({ ...suff, meat: hc.meat }).se, bench.beta, bench.se_HC0, {
      kappaDiff: Math.abs(classical.kappa - bench.kappa),
    }),
    summarize("liml_hc1", classical.beta, runLIMLFromSuffStats({ ...suff, meat: hc.meat, hcType: "HC1" }).se, bench.beta, bench.se_HC1),
    summarize("liml_clustered", classical.beta, runLIMLFromSuffStats({ ...suff, meat: clustered.meat }).se, bench.beta, bench.se_clustered),
    summarize("liml_hac", classical.beta, runLIMLFromSuffStats({ ...suff, meat: hac.meat }).se, bench.beta, bench.se_HAC, { L: hac.L }),
  ];
}

export async function runFase8NumericalValidation() {
  const table = await loadFixtureTable();
  const bench = await fetch(new URL("./fase8Benchmarks.json", import.meta.url)).then(resp => resp.json());
  return [
    ...(await runWLSCells(table, bench.WLS)),
    ...(await runIVCells(table, bench.IV)),
    ...(await runLIMLCells(table, bench.LIML)),
  ];
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase8 = runFase8NumericalValidation;
}
