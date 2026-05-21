// Fase 7 browser validation harness for DuckDB sharp/fuzzy RDD fast paths.
// Usage after loading this module in dev:
//   const r = await window.__validation.fase7();

import { getDuckDB } from "../duckdb.js";
import {
  runSharpRDDFromSuffStats,
  runFuzzyRDDFromSuffStats,
} from "../../../math/RDDSuffStatsEngine.js";
import { runMcCrarySQL } from "../duckdbRDDMcCrary.js";

const DATA_URL = new URL("./fase7_data.csv", import.meta.url).href;
const BENCH_URL = new URL("./fase7Benchmarks.json", import.meta.url).href;
const TOL = 1e-6;

async function loadTable() {
  const [csv, bench] = await Promise.all([
    fetch(DATA_URL).then(resp => resp.text()),
    fetch(BENCH_URL).then(resp => resp.json()),
  ]);
  const { db, conn } = await getDuckDB();
  await db.registerFileText("fase7_data.csv", csv);
  await conn.query("DROP TABLE IF EXISTS fase7_tbl");
  await conn.query("CREATE TABLE fase7_tbl AS SELECT * FROM read_csv_auto('fase7_data.csv')");
  return { bench, tableName: "fase7_tbl" };
}

function maxAbsDiff(actual, expected) {
  return Math.max(...actual.map((value, idx) => Math.abs(value - expected[idx])));
}

function summarize(cell, diffs) {
  const maxDiff = Math.max(...Object.values(diffs));
  return {
    cell,
    ok: maxDiff <= TOL,
    maxDiff,
    ...diffs,
    message: maxDiff <= TOL ? "PASS" : `FAIL ${maxDiff.toExponential(2)}`,
  };
}

export async function runFase7NumericalValidation() {
  const { bench, tableName } = await loadTable();
  const common = {
    tableName,
    runningCol: "r",
    cutoff: 0,
    bandwidth: bench.manual_h,
  };
  const sharpClassical = await runSharpRDDFromSuffStats({
    ...common,
    yCol: "y_sharp",
  });
  const sharpHC1 = await runSharpRDDFromSuffStats({
    ...common,
    yCol: "y_sharp",
    seType: "HC1",
  });
  const fuzzyClassical = await runFuzzyRDDFromSuffStats({
    ...common,
    yCol: "y_fuzzy",
    treatCol: "d",
  });
  const fuzzyHC1 = await runFuzzyRDDFromSuffStats({
    ...common,
    yCol: "y_fuzzy",
    treatCol: "d",
    seType: "HC1",
  });
  const sharpIK = await runSharpRDDFromSuffStats({
    tableName,
    yCol: "y_sharp",
    runningCol: "r",
    cutoff: 0,
  });
  const mcCrary = await runMcCrarySQL({
    tableName,
    runningCol: "r",
    cutoff: 0,
  });

  const results = [
    summarize("sharp_classical", {
      beta: maxAbsDiff(sharpClassical.beta, bench.SharpRDD.beta),
      se: maxAbsDiff(sharpClassical.se, bench.SharpRDD.se_classical),
    }),
    summarize("sharp_hc1", {
      se: maxAbsDiff(sharpHC1.se, bench.SharpRDD.se_HC1),
    }),
    summarize("fuzzy_classical", {
      late: Math.abs(fuzzyClassical.late - bench.FuzzyRDD.late),
      se: Math.abs(fuzzyClassical.lateSE - bench.FuzzyRDD.lateSE_classical),
      first: Math.abs(fuzzyClassical.firstStageJumpD - bench.FuzzyRDD.firstStageJumpD),
      reduced: Math.abs(fuzzyClassical.reducedForm.late - bench.FuzzyRDD.reducedFormJump),
    }),
    summarize("fuzzy_hc1", {
      se: Math.abs(fuzzyHC1.lateSE - bench.FuzzyRDD.lateSE_HC1),
    }),
    summarize("ik_bandwidth", {
      h: Math.abs(sharpIK.h - bench.ik_h),
    }),
    summarize("mccrary", {
      theta: Math.abs(mcCrary.theta - bench.McCrary.theta),
      se: Math.abs(mcCrary.thetaSE - bench.McCrary.thetaSE),
      z: Math.abs(mcCrary.zStat - bench.McCrary.zStat),
      p: Math.abs(mcCrary.pVal - bench.McCrary.pVal),
      h: Math.abs(mcCrary.h - bench.McCrary.h),
      bw: Math.abs(mcCrary.bw - bench.McCrary.bw),
      bins: Math.abs(mcCrary.nBins - bench.McCrary.nBins),
    }),
  ];

  const nPass = results.filter(result => result.ok).length;
  console.log(`Fase 7: ${nPass}/${results.length} cells pass`);
  console.table(results.map(({ cell, ok, maxDiff, message }) => ({
    cell,
    ok,
    diff: maxDiff.toExponential(2),
    message,
  })));
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase7 = runFase7NumericalValidation;
}
