// Fase 5 browser validation harness for DuckDB DiD / Event Study fast paths.
// Usage after loading this module in dev:
//   const r = await window.__validation.fase5();
//   console.table(r);

import { getDuckDB } from "../duckdb.js";
import { buildOLSSuffStats } from "../duckdbOLS.js";
import { computeHCMeat } from "../duckdbRobustSE.js";
import { buildWithinSuffStats } from "../duckdbWithin.js";
import { computeWithinHCMeat } from "../duckdbWithinRobustSE.js";
import {
  buildDiD2x2Synthetic,
  buildTWFEDiDSynthetic,
  buildEventStudySynthetic,
} from "../duckdbDiDSynthetic.js";
import { runOLSFromSuffStats } from "../../../math/LinearEngine.js";
import { runTWFEFromSuffStats } from "../../../math/PanelSuffStatsEngine.js";

const DATA_URL = new URL("./fase5_data.csv", import.meta.url).href;
const BENCH_URL = new URL("./fase5Benchmarks.json", import.meta.url).href;
const TOL_COEF = 1e-6;
const TOL_SE = 1e-4;

async function loadTable() {
  const { db, conn } = await getDuckDB();
  const csv = await fetch(DATA_URL).then(resp => resp.text());
  await db.registerFileText("fase5_data.csv", csv);
  await conn.query("DROP TABLE IF EXISTS fase5_tbl");
  await conn.query("CREATE TABLE fase5_tbl AS SELECT * FROM read_csv_auto('fase5_data.csv')");
  await conn.query("DROP TABLE IF EXISTS fase5_did_tbl");
  await conn.query("CREATE TABLE fase5_did_tbl AS SELECT * FROM fase5_tbl WHERE year IN (9, 10)");
  return { full: "fase5_tbl", did: "fase5_did_tbl" };
}

function maxAbsDiff(actual, expected) {
  return Math.max(...actual.map((value, idx) => Math.abs(value - (expected[idx] ?? NaN))));
}

function summarize(cell, result, refBeta, refSe) {
  const coefDiff = maxAbsDiff(result.beta, refBeta);
  const seDiff = maxAbsDiff(result.se, refSe);
  const ok = coefDiff <= TOL_COEF && seDiff <= TOL_SE;
  return {
    cell,
    ok,
    maxCoefDiff: coefDiff,
    maxSeDiff: seDiff,
    beta: result.beta,
    se: result.se,
    refBeta,
    refSe,
    message: ok ? "PASS" : `FAIL coef=${coefDiff.toExponential(2)} se=${seDiff.toExponential(2)}`,
  };
}

async function solveDiD(table, seType) {
  const synth = buildDiD2x2Synthetic({
    postCol: "post",
    treatCol: "treated_ever",
    controls: ["x1"],
  });
  const suff = await buildOLSSuffStats(table, "y", synth.xColsExpanded, { dummySQL: synth.dummySQL });
  const classical = runOLSFromSuffStats(suff);
  if (seType === "classical") return classical;

  const meat = (await computeHCMeat({
    tableName: table,
    yCol: "y",
    xColsExpanded: synth.xColsExpanded,
    dummySQL: synth.dummySQL,
    beta: classical.beta,
  })).meat;
  return runOLSFromSuffStats({ ...suff, meat, hcType: "HC1" });
}

async function solveTWFE(table, synth, seType) {
  const suff = await buildWithinSuffStats(table, "y", synth.xColsExpanded, "id", {
    mode: "TWFE",
    timeCol: "year",
    dummySQL: synth.dummySQL,
  });
  const classical = runTWFEFromSuffStats({ ...suff, meat: null, hcType: null });
  if (seType === "classical") return classical;

  const meat = (await computeWithinHCMeat({
    withinCTEPrefix: suff.withinCTEPrefix,
    k: synth.xColsExpanded.length,
    beta: classical._betaFull,
  })).meat;
  return runTWFEFromSuffStats({ ...suff, meat, hcType: "HC1" });
}

export async function runFase5NumericalValidation() {
  const [table, bench] = await Promise.all([
    loadTable(),
    fetch(BENCH_URL).then(resp => resp.json()),
  ]);

  const results = [];

  const didCls = await solveDiD(table.did, "classical");
  results.push(summarize("did_classical", didCls, bench.DiD2x2.beta, bench.DiD2x2.se_classical));
  const didHC1 = await solveDiD(table.did, "HC1");
  results.push(summarize("did_hc1", didHC1, bench.DiD2x2.beta, bench.DiD2x2.se_HC1));

  const twfeSynth = buildTWFEDiDSynthetic({ treatCol: "treat_post", controls: ["x1"] });
  const twfeCls = await solveTWFE(table.full, twfeSynth, "classical");
  results.push(summarize("twfe_classical", twfeCls, bench.TWFEDiD.beta, bench.TWFEDiD.se_classical));
  const twfeHC1 = await solveTWFE(table.full, twfeSynth, "HC1");
  results.push(summarize("twfe_hc1", twfeHC1, bench.TWFEDiD.beta, bench.TWFEDiD.se_HC1));

  const eventSynth = buildEventStudySynthetic({
    timeCol: "year",
    treatTimeCol: "t_treat",
    kPre: 3,
    kPost: 3,
    controls: ["x1"],
  });
  const eventCls = await solveTWFE(table.full, eventSynth, "classical");
  results.push(summarize("event_classical", eventCls, bench.EventStudy.beta, bench.EventStudy.se_classical));
  const eventHC1 = await solveTWFE(table.full, eventSynth, "HC1");
  results.push(summarize("event_hc1", eventHC1, bench.EventStudy.beta, bench.EventStudy.se_HC1));

  const nPass = results.filter(result => result.ok).length;
  console.log(`Fase 5: ${nPass}/${results.length} cells pass`);
  console.table(results.map(({ cell, ok, maxCoefDiff, maxSeDiff, message }) => ({
    cell,
    ok,
    coef: maxCoefDiff.toExponential(2),
    se: maxSeDiff.toExponential(2),
    message,
  })));
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase5 = runFase5NumericalValidation;
}
