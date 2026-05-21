// DuckDB Fase 6 numerical validation: Logit, Probit, and Poisson FE IRLS.
// Browser entrypoint:
//   const r = await window.__validation.fase6();

import { getDuckDB } from "../duckdb.js";
import { expandFactors } from "../duckdbFactors.js";
import {
  runIRLSFromSuffStats,
  applyRobustSEToIRLSResult,
} from "../../../math/IRLSSuffStatsEngine.js";

const DATA_URL = new URL("./fase6_data.csv", import.meta.url).href;
const BENCH_URL = new URL("./fase6Benchmarks.json", import.meta.url).href;
const TOL_BETA = 1e-4;
const TOL_SE = 1e-3;
const TOL_LOGLIK = 1e-4;

async function loadFixtureTable() {
  const [csv, bench] = await Promise.all([
    fetch(DATA_URL).then(r => r.text()),
    fetch(BENCH_URL).then(r => r.json()),
  ]);
  const { db, conn } = await getDuckDB();
  await db.registerFileText("fase6_data.csv", csv);
  await conn.query("DROP TABLE IF EXISTS fase6_tbl");
  await conn.query("CREATE TABLE fase6_tbl AS SELECT * FROM read_csv_auto('fase6_data.csv')");
  return { bench, tableName: "fase6_tbl" };
}

function maxDiff(a, b) {
  return Math.max(...a.map((value, idx) => Math.abs(value - b[idx])));
}

function validationCell(cell, result, robust, bench, {
  betaTol = TOL_BETA,
  seTol = TOL_SE,
  llTol = TOL_LOGLIK,
} = {}) {
  const maxCoefDiff = maxDiff(result.beta, bench.beta);
  const maxClassicalSeDiff = maxDiff(result.se, bench.se_classical);
  const maxRobustSeDiff = maxDiff(robust.se, bench.se_HC1);
  const logLikDiff = Math.abs(result.logLik - bench.logLik);
  const maxSeDiff = Math.max(maxClassicalSeDiff, maxRobustSeDiff);
  const ok = maxCoefDiff <= betaTol && maxSeDiff <= seTol && logLikDiff <= llTol;
  return {
    cell,
    ok,
    maxCoefDiff,
    maxSeDiff,
    logLikDiff,
    message: ok
      ? "PASS"
      : `beta=${maxCoefDiff} se=${maxSeDiff} logLik=${logLikDiff}`,
  };
}

async function fitCell({
  tableName,
  yCol,
  xCols,
  family,
  dummySQL = {},
}) {
  const result = await runIRLSFromSuffStats({
    tableName,
    yCol,
    xCols,
    family,
    dummySQL,
  });
  if (result.error) throw new Error(result.error);
  const robust = await applyRobustSEToIRLSResult({
    result,
    tableName,
    yCol,
    xCols,
    family,
    dummySQL,
    hcType: "HC1",
  });
  return { result, robust };
}

export async function runFase6NumericalValidation() {
  const { bench, tableName } = await loadFixtureTable();
  const cells = [];

  const logit = await fitCell({
    tableName,
    yCol: "y_logit",
    xCols: ["x1", "x2"],
    family: "logit",
  });
  cells.push(validationCell("logit", logit.result, logit.robust, bench.Logit));

  const probit = await fitCell({
    tableName,
    yCol: "y_probit",
    xCols: ["x1", "x2"],
    family: "probit",
  });
  cells.push(validationCell("probit", probit.result, probit.robust, bench.Probit));

  const poissonDesign = await expandFactors({
    tableName,
    xCols: ["x1", "x2", "factor(id)"],
  });
  const poisson = await fitCell({
    tableName,
    yCol: "y_pois_fe",
    xCols: poissonDesign.xColsExpanded,
    family: "poisson",
    dummySQL: poissonDesign.dummySQL,
  });
  cells.push(validationCell("poisson_fe", poisson.result, poisson.robust, bench.PoissonFE));

  const nPass = cells.filter(result => result.ok).length;
  console.log(`Fase 6: ${nPass}/${cells.length} cells pass`);
  console.table(cells.map(({ cell, ok, maxCoefDiff, maxSeDiff, logLikDiff, message }) => ({
    cell,
    ok,
    coef: maxCoefDiff.toExponential(2),
    se: maxSeDiff.toExponential(2),
    logLik: logLikDiff.toExponential(2),
    message,
  })));
  return cells;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase6 = runFase6NumericalValidation;
}
