import { runSpatialRegression } from "../SpatialRegressionEngine.js";

const BENCH_URL = new URL("./spatialRegressionBenchmarks.json", import.meta.url);
const TOL_BETA = 1e-4;
const TOL_SE = 1e-3;
const TOL_FIT = 1e-4;

async function loadBench() {
  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(BENCH_URL, "utf8"));
  }
  return fetch(BENCH_URL).then(r => r.json());
}

function cell(name, got, want, tol) {
  const diff = Math.abs(got - want);
  return { cell: name, ok: diff <= tol, got, want, diff, tol };
}

function vectorCells(prefix, got, want, tol) {
  return want.map((v, i) => cell(`${prefix}_${i}`, got[i], v, tol));
}

export async function runSpatialRegressionValidation() {
  const bench = await loadBench();
  const { y, x, z, weights } = bench.fixture;
  const X = x.map((v, i) => [v, z[i]]);
  const W = { weights, summary: { n: y.length, links: weights.length, type: "rook", style: "W" } };
  const results = [];

  for (const model of ["SLX", "SAR", "SEM", "SDM"]) {
    const got = runSpatialRegression({ y, X, varNames: ["x", "z"], W, model });
    const want = bench.models[model];
    if (got.error) {
      results.push({ cell: `${model}_fit`, ok: false, got: got.error, want: "no error", diff: Infinity, tol: 0 });
      continue;
    }
    results.push(...vectorCells(`${model}_beta`, got.beta, want.beta, TOL_BETA));
    results.push(...vectorCells(`${model}_se`, got.se, want.se, TOL_SE));
    if (want.rho != null) results.push(cell(`${model}_rho`, got.rho, want.rho, TOL_BETA));
    if (want.lambda != null) results.push(cell(`${model}_lambda`, got.lambda, want.lambda, TOL_BETA));
    if (want.R2 != null) results.push(cell(`${model}_R2`, got.R2, want.R2, TOL_FIT));
    if (want.logLik != null) results.push(cell(`${model}_logLik`, got.logLik, want.logLik, TOL_FIT));
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`spatialReg: ${passed}/${results.length} checks pass`);
  console.table(results.map(r => ({ cell: r.cell, ok: r.ok, diff: r.diff, tol: r.tol })));
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.spatialReg = runSpatialRegressionValidation;
}
